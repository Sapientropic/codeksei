import { findModelByQuery } from "../adapters/runtime/codex/model-catalog";
import type { NormalizedModelCatalogEntry } from "../adapters/runtime/codex/model-catalog";
import type { ChannelAdapterLike, RuntimeAdapterLike, SessionStoreWriterLike } from "./app-service-contract";
import type {
  ChannelCommandRuntimeAdapter,
  ChannelCommandSessionStore,
  ChannelCommandThreadStateStore,
} from "./channel-command-context";
import { buildWeixinHelpText } from "./command-registry";
import { buildChannelCommandContext } from "./channel-command-context";
import type { ParsedChannelCommand } from "./channel-command-router";
import type { NormalizedIncomingMessage, PendingApprovalState } from "./runtime-types";

interface ControlCommandSessionStore extends ChannelCommandSessionStore {
  getAvailableModelCatalog(): {
    models: Array<Pick<NormalizedModelCatalogEntry, "model">>;
  } | null;
  getCodexParamsForWorkspace(bindingKey: string, workspaceRoot: string): { model?: string };
}

interface ControlCommandRuntimeAdapter extends Pick<RuntimeAdapterLike, "respondApproval">, ChannelCommandRuntimeAdapter {
  getSessionStore(): ControlCommandSessionStore;
}

type ControlCommandSessionWriter = Pick<
  SessionStoreWriterLike,
  "clearApprovalPrompt" | "clearPendingApprovalForThread" | "rememberApprovalPrefixForWorkspace" | "setCodexParamsForWorkspace"
>;

interface ControlCommandThreadStateStore extends ChannelCommandThreadStateStore {
  resolveApproval(threadId: string, status?: string): unknown;
}

type ControlCommandMessage = Pick<
  NormalizedIncomingMessage,
  "accountId" | "contextToken" | "provider" | "senderId" | "text" | "workspaceId"
>;

type ControlCommandChannelAdapter = Pick<ChannelAdapterLike, "sendText">;

interface ControlCommandHandlers {
  approval(normalized: ControlCommandMessage, command: ParsedChannelCommand): Promise<void>;
  help(normalized: ControlCommandMessage, command?: ParsedChannelCommand): Promise<void>;
  model(normalized: ControlCommandMessage, command: ParsedChannelCommand): Promise<void>;
}

function createControlCommandHandlers({
  channelAdapter,
  resolveWorkspaceRoot,
  runtimeAdapter,
  sessionWriter,
  threadStateStore,
}: {
  channelAdapter: ControlCommandChannelAdapter;
  resolveWorkspaceRoot(bindingKey: string): string;
  runtimeAdapter: ControlCommandRuntimeAdapter;
  sessionWriter: ControlCommandSessionWriter;
  threadStateStore: ControlCommandThreadStateStore;
}): ControlCommandHandlers {
  return {
    async approval(normalized: ControlCommandMessage, command: ParsedChannelCommand): Promise<void> {
      const {
        sessionStore,
        threadId,
        threadState,
        workspaceRoot,
      } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      const approval: PendingApprovalState | null = threadState?.pendingApproval || null;
      if (!threadId || approval?.requestId == null || String(approval.requestId).trim() === "") {
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: "当前没有待处理的授权请求。",
          contextToken: normalized.contextToken,
        });
        return;
      }

      const decision = command.name === "no" ? "decline" : "accept";
      console.log(
        `[codeksei] approval response requested thread=${threadId} requestId=${approval.requestId} decision=${decision} workspace=${workspaceRoot}`
      );
      await runtimeAdapter.respondApproval({
        requestId: approval.requestId,
        decision,
      });
      await clearPendingApproval(sessionWriter, threadId);
      console.log(
        `[codeksei] approval response delivered thread=${threadId} requestId=${approval.requestId} decision=${decision}`
      );
      if (command.name === "always" && decision === "accept") {
        await sessionWriter.rememberApprovalPrefixForWorkspace(workspaceRoot, approval.commandTokens);
      }
      threadStateStore.resolveApproval(threadId, "running");
      const text = command.name === "always"
        ? "已记住该命令前缀，当前项目后续相同命令将自动放行。"
        : (command.name === "yes" ? "已允许本次请求。" : "已拒绝本次请求。");
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text,
        contextToken: normalized.contextToken,
      });
    },

    async model(normalized: ControlCommandMessage, command: ParsedChannelCommand): Promise<void> {
      const {
        bindingKey,
        sessionStore,
        workspaceRoot,
      } = buildChannelCommandContext({
        normalized,
        resolveWorkspaceRoot,
        runtimeAdapter,
        threadStateStore,
      });
      const query = normalizeCommandArgument(command.args);
      const catalog = sessionStore.getAvailableModelCatalog();
      const currentModel = sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot).model;

      if (!query) {
        const lines = [
          `当前模型: ${currentModel || "(default)"}`,
        ];
        if (catalog?.models?.length) {
          lines.push(`可用模型: ${catalog.models.map((item) => item.model).join("、")}`);
        } else {
          lines.push("可用模型: (未获取到模型列表)");
        }
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: lines.join("\n"),
          contextToken: normalized.contextToken,
        });
        return;
      }

      const matched = findModelByQuery(catalog?.models || [], query);
      if (!matched) {
        await channelAdapter.sendText({
          userId: normalized.senderId,
          text: `未找到模型：${query}`,
          contextToken: normalized.contextToken,
        });
        return;
      }

      await sessionWriter.setCodexParamsForWorkspace(bindingKey, workspaceRoot, {
        model: matched.model,
      });
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text: `已切换模型。\n\nworkspace: ${workspaceRoot}\nmodel: ${matched.model}`,
        contextToken: normalized.contextToken,
      });
    },

    async help(normalized: ControlCommandMessage): Promise<void> {
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text: buildWeixinHelpText(),
        contextToken: normalized.contextToken,
      });
    },
  };
}

function normalizeCommandArgument(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  createControlCommandHandlers,
};

async function clearPendingApproval(sessionWriter: ControlCommandSessionWriter, threadId: string): Promise<void> {
  if (typeof sessionWriter?.clearPendingApprovalForThread === "function") {
    await sessionWriter.clearPendingApprovalForThread(threadId);
    return;
  }
  if (typeof sessionWriter?.clearApprovalPrompt === "function") {
    await sessionWriter.clearApprovalPrompt(threadId);
  }
}
