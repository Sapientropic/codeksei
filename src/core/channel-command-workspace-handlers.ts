import * as fs from "node:fs";
import * as path from "node:path";
import { formatCheckinRange, resolveCheckinConfig } from "../state/checkin-config";
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

type WorkspaceCommandChannelAdapter = Pick<ChannelAdapterLike, "sendText">;
type WorkspaceCommandConfig = Pick<AppRuntimeConfig, "checkinConfigFile" | "codexAccessMode" | "workspaceRoot">;

interface WorkspaceCommandSessionStore extends ChannelCommandSessionStore {
  findBindingForThreadId(threadId: string): ThreadBindingRef | null;
  getCodexParamsForWorkspace(bindingKey: string, workspaceRoot: string): { model?: string; effort?: string };
}

interface WorkspaceCommandRuntimeAdapter extends Pick<
  RuntimeAdapterLike,
  "cancelTurn" | "refreshThreadInstructions" | "resumeThread"
>, ChannelCommandRuntimeAdapter {
  getSessionStore(): WorkspaceCommandSessionStore;
}

interface WorkspaceCommandThreadStateStore extends ChannelCommandThreadStateStore {
  getThreadState(threadId: string): ChannelCommandThreadState | null;
}

type WorkspaceCommandStreamDelivery = Pick<StreamDeliveryLike, "queueReplyTargetForThread">;
type WorkspaceCommandSessionWriter = Pick<
  SessionStoreWriterLike,
  "clearThreadIdForWorkspace" | "setActiveWorkspaceRoot" | "setThreadIdForWorkspace"
>;

interface WorkspaceCommandHandlers {
  bind(normalized: WorkspaceCommandMessage, command: ParsedChannelCommand): Promise<void>;
  new: (normalized: WorkspaceCommandMessage) => Promise<void>;
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
  resolveWorkspaceRoot,
  runtimeAdapter,
  scheduleRuntimeEventWatchdog,
  sessionWriter,
  streamDelivery,
  threadStateStore,
}: {
  channelAdapter: WorkspaceCommandChannelAdapter;
  config: WorkspaceCommandConfig;
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
      const codexParams = sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
      lines.push(`model: ${codexParams.model || "(default)"}`);
      lines.push(`effort: ${codexParams.effort || "(default)"}`);
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
      await sessionWriter.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text: `已切到新线程草稿。\n\nworkspace: ${workspaceRoot}\n下一条普通消息会先按当前 workspace 重建上下文入口。`,
        contextToken: normalized.contextToken,
      });
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
          accessMode: config.codexAccessMode,
        } as {
          bindingKey: string;
          threadId: string;
          workspaceRoot: string;
          model?: string;
          effort?: string;
          accessMode?: string;
        };
        const codexParams = sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
        const model = codexParams.model;
        if (model) {
          refreshArgs.model = model;
        }
        if (codexParams.effort) {
          refreshArgs.effort = codexParams.effort;
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
      await runtimeAdapter.resumeThread({ threadId: targetThreadId });
      await sessionWriter.setThreadIdForWorkspace(bindingKey, workspaceRoot, targetThreadId);
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
      if (!threadId || !threadState?.turnId || threadState.status !== "running") {
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
