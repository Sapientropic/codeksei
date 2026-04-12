import { findModelByQuery } from "../adapters/runtime/codex/model-catalog";
import type { ChannelAdapterLike, RuntimeAdapterLike } from "./app-service-contract";
import type {
  ChannelCommandRuntimeAdapter,
  ChannelCommandSessionStore,
  ChannelCommandThreadStateStore,
} from "./channel-command-context";
import { buildWeixinHelpText } from "./command-registry";
import { buildChannelCommandContext } from "./channel-command-context";
import type { ParsedChannelCommand } from "./channel-command-router";
import type { NormalizedIncomingMessage, PendingApprovalState } from "./runtime-types";

interface AvailableModelCatalogView {
  models: Array<{ model: string }>;
}

interface ControlCommandSessionStore extends ChannelCommandSessionStore {
  clearApprovalPrompt?(threadId: unknown): void;
  clearPendingApprovalForThread?(threadId: unknown): void;
  getAvailableModelCatalog(): AvailableModelCatalogView | null;
  getCodexParamsForWorkspace(bindingKey: string, workspaceRoot: string): { model?: string };
  rememberApprovalPrefixForWorkspace(workspaceRoot: string, commandTokens: string[]): unknown;
  setCodexParamsForWorkspace(bindingKey: string, workspaceRoot: string, params: { model: string }): unknown;
}

interface ControlCommandRuntimeAdapter extends Pick<RuntimeAdapterLike, "respondApproval">, ChannelCommandRuntimeAdapter {
  getSessionStore(): ControlCommandSessionStore;
}

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
  threadStateStore,
}: {
  channelAdapter: ControlCommandChannelAdapter;
  resolveWorkspaceRoot(bindingKey: string): string;
  runtimeAdapter: ControlCommandRuntimeAdapter;
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
      clearPendingApproval(sessionStore, threadId);
      console.log(
        `[codeksei] approval response delivered thread=${threadId} requestId=${approval.requestId} decision=${decision}`
      );
      if (command.name === "always" && decision === "accept") {
        sessionStore.rememberApprovalPrefixForWorkspace(workspaceRoot, approval.commandTokens);
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

      sessionStore.setCodexParamsForWorkspace(bindingKey, workspaceRoot, {
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

function clearPendingApproval(sessionStore: ControlCommandSessionStore, threadId: string): void {
  if (typeof sessionStore?.clearPendingApprovalForThread === "function") {
    sessionStore.clearPendingApprovalForThread(threadId);
    return;
  }
  if (typeof sessionStore?.clearApprovalPrompt === "function") {
    sessionStore.clearApprovalPrompt(threadId);
  }
}
