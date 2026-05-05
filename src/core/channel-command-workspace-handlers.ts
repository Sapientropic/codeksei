import * as fs from "node:fs";
import * as path from "node:path";
import { formatCheckinRange, resolveCheckinConfig } from "../state/checkin-config";
import {
  buildPageArtifactUri,
  formatWeixinPageMessage,
  type PageArtifactStore,
} from "../state/page-artifacts";
import type {
  AppRuntimeConfig,
  ChannelAdapterLike,
  RuntimeAdapterLike,
  SessionStoreWriterLike,
  StreamDeliveryLike,
} from "./app-service-contract";
import type {
  ChannelCommandRuntimeAdapter,
  ChannelCommandSessionStore,
  ChannelCommandThreadState,
  ChannelCommandThreadStateStore,
} from "./channel-command-context";
import { buildChannelCommandContext } from "./channel-command-context";
import type { ParsedChannelCommand } from "./channel-command-router";
import { ignoreBestEffortError } from "./error-handling";
import type { NormalizedIncomingMessage, ThreadBindingRef } from "./runtime-types";

const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:\//;
const WINDOWS_DRIVE_ROOT_RE = /^[A-Za-z]:\/$/;
const WINDOWS_UNC_PREFIX_RE = /^\/\/\?\//;

type WorkspaceCommandMessage = Pick<
  NormalizedIncomingMessage,
  "accountId" | "contextToken" | "provider" | "senderId" | "text" | "workspaceId"
>;

type WorkspaceCommandChannelAdapter = Pick<ChannelAdapterLike, "sendText" | "sendFile">;
type WorkspaceCommandConfig = Pick<AppRuntimeConfig, "checkinConfigFile" | "runtimeAccessMode" | "workspaceRoot">;

interface WorkspaceCommandSessionStore extends ChannelCommandSessionStore {
  findBindingForThreadId(threadId: string): ThreadBindingRef | null;
  getRuntimeParamsForWorkspace(bindingKey: string, workspaceRoot: string): { model?: string; effort?: string };
}

interface WorkspaceCommandRuntimeAdapter extends Pick<
  RuntimeAdapterLike,
  "cancelTurn" | "compactThread" | "describe" | "refreshThreadInstructions" | "resumeThread" | "startFreshThreadDraft"
>, ChannelCommandRuntimeAdapter {
  getSessionStore(): WorkspaceCommandSessionStore;
}

interface WorkspaceCommandThreadStateStore extends ChannelCommandThreadStateStore {
  getThreadState(threadId: string): ChannelCommandThreadState | null;
}

type WorkspaceCommandStreamDelivery = Pick<StreamDeliveryLike, "queueReplyTargetForThread">;
type WorkspaceCommandSessionWriter = Pick<
  SessionStoreWriterLike,
  "clearThreadIdForWorkspace" | "setActiveWorkspaceRoot" | "setPendingThreadIdForWorkspace" | "setThreadIdForWorkspace"
>;

interface WorkspaceCommandHandlers {
  bind(normalized: WorkspaceCommandMessage, command: ParsedChannelCommand): Promise<void>;
  compact(normalized: WorkspaceCommandMessage): Promise<void>;
  hasActivePagePointer(normalized: WorkspaceCommandMessage): Promise<boolean>;
  new: (normalized: WorkspaceCommandMessage) => Promise<void>;
  page(normalized: WorkspaceCommandMessage, command: ParsedChannelCommand): Promise<void>;
  reread(normalized: WorkspaceCommandMessage): Promise<void>;
  status(normalized: WorkspaceCommandMessage): Promise<void>;
  stop(normalized: WorkspaceCommandMessage): Promise<void>;
  switch(normalized: WorkspaceCommandMessage, command: ParsedChannelCommand): Promise<void>;
}

interface ScheduleRuntimeEventWatchdogPayload {
  bindingKey: string;
  normalized: WorkspaceCommandMessage;
  threadId?: string;
  workspaceRoot: string;
}

function createWorkspaceCommandHandlers({
  channelAdapter,
  config,
  pageArtifactStore = null,
  resolveWorkspaceRoot,
  runtimeAdapter,
  scheduleRuntimeEventWatchdog,
  sessionWriter,
  streamDelivery,
  threadStateStore,
}: {
  channelAdapter: WorkspaceCommandChannelAdapter;
  config: WorkspaceCommandConfig;
  pageArtifactStore?: PageArtifactStore | null;
  resolveWorkspaceRoot(bindingKey: string): string;
  runtimeAdapter: WorkspaceCommandRuntimeAdapter;
  scheduleRuntimeEventWatchdog(payload: ScheduleRuntimeEventWatchdogPayload): void;
  sessionWriter: WorkspaceCommandSessionWriter;
  streamDelivery: WorkspaceCommandStreamDelivery;
  threadStateStore: WorkspaceCommandThreadStateStore;
}): WorkspaceCommandHandlers {
  return {
    async bind(normalized: WorkspaceCommandMessage, command: ParsedChannelCommand): Promise<void> {
      const workspaceRoot = resolveBindWorkspaceRoot(command.args, config.workspaceRoot);
      if (!workspaceRoot) {
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: "用法：/bind [绝对路径]",
          contextToken: normalized.contextToken,
        });
        return;
      }

      if (!isAbsoluteWorkspacePath(workspaceRoot)) {
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: "只支持绝对路径绑定。",
          contextToken: normalized.contextToken,
        });
        return;
      }

      const stats = await fs.promises.stat(workspaceRoot).catch(() => null);
      if (!stats?.isDirectory()) {
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: `项目不存在：${workspaceRoot}`,
          contextToken: normalized.contextToken,
        });
        return;
      }

      // Bind the canonical real path so junction aliases do not fork
      // thread/model state across multiple workspace keys on Windows.
      const canonicalWorkspaceRoot = normalizeWorkspacePath(
        await fs.promises.realpath(workspaceRoot).catch(() => workspaceRoot)
      ) || workspaceRoot;
      const { bindingKey, sessionStore } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      void sessionStore;
      pageArtifactStore?.clearActivePointer(bindingKey);
      await sessionWriter.setActiveWorkspaceRoot(bindingKey, canonicalWorkspaceRoot);
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text: `已绑定项目。\n\nworkspace: ${canonicalWorkspaceRoot}\n下一条普通消息会按当前 workspace 检查是否需要补读稳定入口。`,
        contextToken: normalized.contextToken,
      });
    },

    async status(normalized: WorkspaceCommandMessage): Promise<void> {
      const {
        bindingKey,
        sessionStore,
        threadId,
        threadState,
        usage,
        workspaceRoot,
      } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      const lines = [
        `workspace: ${workspaceRoot}`,
        `thread: ${threadId || "(none)"}`,
        `status: ${threadState?.status || "idle"}`,
      ];
      const runtimeDescriptor = runtimeAdapter.describe();
      if (runtimeDescriptor.provider) {
        lines.push(`runtime: ${runtimeDescriptor.provider}`);
      }
      const runtimeParams = sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
      lines.push(`model: ${runtimeParams.model || runtimeDescriptor.model || "(default)"}`);
      if (runtimeDescriptor.provider !== "claudecode" || runtimeParams.effort) {
        lines.push(`effort: ${runtimeParams.effort || "(default)"}`);
      }
      const checkinConfigFile = normalizeCommandArgument(config.checkinConfigFile);
      if (checkinConfigFile) {
        const checkinConfig = resolveCheckinConfig({ filePath: checkinConfigFile });
        lines.push(`checkin: ${formatCheckinRange(checkinConfig)} [${checkinConfig.source}]`);
      }
      if (threadState?.lastError) {
        lines.push(`lastError: ${threadState.lastError}`);
      }
      if (usage) {
        const modelContextWindow = Number(usage.modelContextWindow || 0);
        const lastTotalTokens = Number(usage.lastTotalTokens || 0);
        const primaryUsedPercent = Number(usage.primaryUsedPercent || 0);
        const secondaryUsedPercent = Number(usage.secondaryUsedPercent || 0);
        const usageParts = [];
        if (modelContextWindow > 0 && lastTotalTokens > 0) {
          usageParts.push(`last ${formatCompactNumber(lastTotalTokens)}/${formatCompactNumber(modelContextWindow)}`);
        } else if (lastTotalTokens > 0) {
          usageParts.push(`last ${formatCompactNumber(lastTotalTokens)}`);
        }
        if (primaryUsedPercent > 0) {
          usageParts.push(`5h ${primaryUsedPercent}%`);
        }
        if (secondaryUsedPercent > 0) {
          usageParts.push(`7d ${secondaryUsedPercent}%`);
        }
        if (usageParts.length) {
          lines.push(`usage: ${usageParts.join(" | ")}`);
        }
      }
      const activePagePointer = pageArtifactStore?.getActivePointer(bindingKey) || null;
      if (activePagePointer) {
        const activeArtifact = pageArtifactStore?.getArtifact(activePagePointer.artifactId);
        if (activeArtifact) {
          lines.push(`page: active ${activePagePointer.page}/${activeArtifact.totalPages}`);
        }
      }
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text: lines.join("\n"),
        contextToken: normalized.contextToken,
      });
    },

    new: async (normalized: WorkspaceCommandMessage): Promise<void> => {
      const { bindingKey, sessionStore, workspaceRoot } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      void sessionStore;
      if (typeof runtimeAdapter.startFreshThreadDraft === "function") {
        await runtimeAdapter.startFreshThreadDraft({ workspaceRoot });
      }
      pageArtifactStore?.clearActivePointer(bindingKey);
      await sessionWriter.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text: `已切到新线程草稿。\n\nworkspace: ${workspaceRoot}\n下一条普通消息会先按当前 workspace 重建上下文入口。`,
        contextToken: normalized.contextToken,
      });
    },

    async compact(normalized: WorkspaceCommandMessage): Promise<void> {
      const {
        threadId,
        workspaceRoot,
      } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      if (!threadId) {
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: "当前还没有可用线程，先发一条普通消息开始。",
          contextToken: normalized.contextToken,
        });
        return;
      }
      const operations = runtimeAdapter.describe().operations;
      if (!operations.compactThread || typeof runtimeAdapter.compactThread !== "function") {
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: "当前 runtime 不支持 /compact。",
          contextToken: normalized.contextToken,
        });
        return;
      }
      await runtimeAdapter.compactThread({ threadId, workspaceRoot });
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text: `已发送 compact 请求。\n\nthread: ${threadId}`,
        contextToken: normalized.contextToken,
      });
    },

    async hasActivePagePointer(normalized: WorkspaceCommandMessage): Promise<boolean> {
      if (!pageArtifactStore) {
        return false;
      }
      const { bindingKey } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      return Boolean(pageArtifactStore.getActivePointer(bindingKey));
    },

    async page(normalized: WorkspaceCommandMessage, command: ParsedChannelCommand): Promise<void> {
      const { bindingKey } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      if (!pageArtifactStore) {
        await sendWorkspaceText(channelAdapter, normalized, "当前没有可继续翻页的内容。");
        return;
      }
      const pointer = pageArtifactStore.getActivePointer(bindingKey);
      if (!pointer) {
        await sendWorkspaceText(channelAdapter, normalized, "当前没有可继续翻页的内容。");
        return;
      }
      const artifact = pageArtifactStore.getArtifact(pointer.artifactId);
      if (!artifact) {
        pageArtifactStore.clearActivePointer(bindingKey);
        await sendWorkspaceText(channelAdapter, normalized, "这段分页内容已经过期，请重新触发。");
        return;
      }

      const commandName = normalizeCommandArgument(command.name).toLowerCase();
      if (commandName === "done") {
        pageArtifactStore.clearActivePointer(bindingKey);
        await sendWorkspaceText(channelAdapter, normalized, "已收起分页内容。");
        return;
      }
      if (commandName === "full") {
        const filePath = pageArtifactStore.writeFullTextFile(artifact.id);
        if (filePath && typeof channelAdapter.sendFile === "function") {
          await channelAdapter.sendFile({
            userId: normalized.senderId,
            filePath,
            contextToken: normalized.contextToken,
          });
          return;
        }
        await sendWorkspaceText(channelAdapter, normalized, "当前通道不支持文件发送，可以继续用 /more 翻页。");
        return;
      }

      const targetPage = resolveTargetPage(commandName, command.args, pointer.page, artifact.totalPages);
      if (!targetPage) {
        await sendWorkspaceText(channelAdapter, normalized, `用法：/more、/prev、/page <1-${artifact.totalPages}>、/full、/done`);
        return;
      }
      const result = pageArtifactStore.readTextResourcePage(buildPageArtifactUri(artifact.id, targetPage));
      if (!result) {
        await sendWorkspaceText(channelAdapter, normalized, `没有第 ${targetPage} 页，当前共有 ${artifact.totalPages} 页。`);
        return;
      }
      pageArtifactStore.activatePointer(bindingKey, artifact.id, targetPage);
      await sendWorkspaceText(channelAdapter, normalized, formatWeixinPageMessage(result));
    },

    async reread(normalized: WorkspaceCommandMessage): Promise<void> {
      const {
        bindingKey,
        sessionStore,
        threadId,
        workspaceRoot,
      } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      if (!threadId) {
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: "当前还没有可用线程，先发一条普通消息开始。",
          contextToken: normalized.contextToken,
        });
        return;
      }

      try {
        streamDelivery.queueReplyTargetForThread(threadId, {
          userId: normalized.senderId,
          contextToken: normalized.contextToken,
          provider: normalized.provider,
        });
        scheduleRuntimeEventWatchdog({
          bindingKey,
          workspaceRoot,
          normalized,
          threadId,
        });
        const refreshArgs = {
          bindingKey,
          threadId,
          workspaceRoot,
          accessMode: config.runtimeAccessMode,
        } as {
          bindingKey: string;
          threadId: string;
          workspaceRoot: string;
          model?: string;
          effort?: string;
          accessMode?: string;
        };
        const runtimeParams = sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
        const model = runtimeParams.model;
        if (model) {
          refreshArgs.model = model;
        }
        if (runtimeParams.effort) {
          refreshArgs.effort = runtimeParams.effort;
        }
        if (!refreshArgs.accessMode) {
          delete refreshArgs.accessMode;
        }
        await runtimeAdapter.refreshThreadInstructions(refreshArgs);
      } catch (error) {
        // This notice is only a courtesy. If the chat send itself also fails,
        // we still want the next normal message to retry reread naturally.
        await ignoreBestEffortError(channelAdapter.sendText({
          userId: normalized.senderId,
          text: `重读失败：${error instanceof Error ? error.message : String(error || "unknown error")}`,
          contextToken: normalized.contextToken,
        }), {
          label: "workspace reread failure notice",
          reason: "the main reread failure already determines the user-visible outcome",
        });
      }
    },

    async switch(normalized: WorkspaceCommandMessage, command: ParsedChannelCommand): Promise<void> {
      const targetThreadId = normalizeCommandArgument(command.args);
      if (!targetThreadId) {
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: "用法：/switch <threadId>",
          contextToken: normalized.contextToken,
        });
        return;
      }

      const {
        bindingKey,
        sessionStore,
        workspaceRoot: currentWorkspaceRoot,
      } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      // A thread carries its own workspace continuity contract. If we switch
      // back to a known old thread but keep today's active workspace, the next
      // message would inject the wrong workspace bootstrap and silently
      // redirect context.
      const knownTarget = sessionStore.findBindingForThreadId(targetThreadId);
      const workspaceRoot = knownTarget?.workspaceRoot || currentWorkspaceRoot;
      await runtimeAdapter.resumeThread({ threadId: targetThreadId, workspaceRoot });
      pageArtifactStore?.clearActivePointer(bindingKey);
      if (runtimeAdapter.describe().provider === "claudecode" && typeof sessionWriter.setPendingThreadIdForWorkspace === "function") {
        await sessionWriter.setPendingThreadIdForWorkspace(bindingKey, workspaceRoot, targetThreadId);
      } else {
        await sessionWriter.setThreadIdForWorkspace(bindingKey, workspaceRoot, targetThreadId);
      }
      const switchedWorkspaceNotice = workspaceRoot !== currentWorkspaceRoot
        ? "\n已跟随这条 thread 的已知 workspace。"
        : "";
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text: `已切换线程。\n\nworkspace: ${workspaceRoot}\nthread: ${targetThreadId}${switchedWorkspaceNotice}\n下一条普通消息会按当前 workspace 检查是否需要补读稳定入口。`,
        contextToken: normalized.contextToken,
      });
    },

    async stop(normalized: WorkspaceCommandMessage): Promise<void> {
      const {
        threadId,
        threadState,
      } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      const cancellableStatus = threadState?.status === "running" || threadState?.status === "waiting_approval";
      if (!threadId || !threadState?.turnId || !cancellableStatus) {
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: "当前没有正在运行的线程。",
          contextToken: normalized.contextToken,
        });
        return;
      }

      await runtimeAdapter.cancelTurn({
        threadId,
        turnId: threadState.turnId,
      });
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text: `已发送停止请求。\n\nthread: ${threadId}`,
        contextToken: normalized.contextToken,
      });
    },
  };
}

function formatCompactNumber(value: unknown): string {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return "0";
  }
  if (normalized >= 1_000_000) {
    return `${Math.round(normalized / 100_000) / 10}m`;
  }
  if (normalized >= 1_000) {
    return `${Math.round(normalized / 100) / 10}k`;
  }
  return String(Math.round(normalized));
}

function resolveTargetPage(commandName: string, args: unknown, currentPage: number, totalPages: number): number {
  if (commandName === "more" || commandName === "next") {
    return Math.min(totalPages, currentPage + 1);
  }
  if (commandName === "prev") {
    return Math.max(1, currentPage - 1);
  }
  if (commandName === "page") {
    const requested = Number.parseInt(normalizeCommandArgument(args), 10);
    return Number.isInteger(requested) && requested >= 1 && requested <= totalPages ? requested : 0;
  }
  return 0;
}

async function sendWorkspaceText(
  channelAdapter: WorkspaceCommandChannelAdapter,
  normalized: WorkspaceCommandMessage,
  text: string,
): Promise<void> {
  await channelAdapter.sendText({
    userId: normalized.senderId,
    text,
    contextToken: normalized.contextToken,
  });
}

function normalizeCommandArgument(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWorkspacePath(value: unknown): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  const fromFileUri = extractPathFromFileUri(normalized);
  const rawPath = fromFileUri || normalized;
  // WeChat + Chinese IME can turn Windows paths into mixed-width punctuation.
  // Normalize them here so `/bind E:\foo`, `/bind E：＼foo`, and file URIs
  // all converge before we decide whether the path is absolute.
  const canonicalWindowsPath = rawPath
    .replace(/[：﹕]/g, ":")
    .replace(/[＼]/g, "\\")
    .replace(/[／]/g, "/");
  const withForwardSlashes = canonicalWindowsPath.replace(/\\/g, "/").replace(WINDOWS_UNC_PREFIX_RE, "");
  const normalizedDrivePrefix = /^\/[A-Za-z]:\//.test(withForwardSlashes)
    ? withForwardSlashes.slice(1)
    : withForwardSlashes;

  if (WINDOWS_DRIVE_ROOT_RE.test(normalizedDrivePrefix)) {
    return normalizedDrivePrefix;
  }
  if (WINDOWS_DRIVE_PATH_RE.test(normalizedDrivePrefix)) {
    return normalizedDrivePrefix.replace(/\/+$/g, "");
  }
  return normalizedDrivePrefix.replace(/\/+$/g, "");
}

function isAbsoluteWorkspacePath(value: unknown): boolean {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) {
    return false;
  }
  if (WINDOWS_DRIVE_PATH_RE.test(normalized)) {
    return true;
  }
  return path.posix.isAbsolute(normalized);
}

function resolveBindWorkspaceRoot(value: unknown, defaultWorkspaceRoot: unknown): string {
  const normalizedArg = normalizeCommandArgument(value);
  if (!normalizedArg || isDefaultWorkspaceAlias(normalizedArg)) {
    return normalizeWorkspacePath(defaultWorkspaceRoot);
  }
  return normalizeWorkspacePath(value);
}

function isDefaultWorkspaceAlias(value: unknown): boolean {
  const normalized = normalizeCommandArgument(value);
  return normalized === "."
    || normalized === "here"
    || normalized === "default"
    || normalized === "当前项目"
    || normalized === "本项目"
    || normalized === "这里";
}

function extractPathFromFileUri(value: unknown): string {
  const input = String(value || "").trim();
  if (!/^file:\/\//i.test(input)) {
    return "";
  }

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "file:") {
      return "";
    }
    const pathname = decodeURIComponent(parsed.pathname || "");
    const withHost = parsed.host && parsed.host !== "localhost"
      ? `//${parsed.host}${pathname}`
      : pathname;
    return withHost;
  } catch {
    return "";
  }
}

export {
  createWorkspaceCommandHandlers,
  extractPathFromFileUri,
  isAbsoluteWorkspacePath,
  normalizeWorkspacePath,
  resolveBindWorkspaceRoot,
};
