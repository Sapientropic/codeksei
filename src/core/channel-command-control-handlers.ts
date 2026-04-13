import {
  findModelByQuery,
  findReasoningEffortByQuery,
  resolveEffectiveModelForEffort,
  type AvailableModelCatalogView,
  type NormalizedModelCatalogEntry,
} from "../adapters/runtime/codex/model-catalog";
import { CheckinConfigStore } from "../state/checkin-config-store";
import {
  formatCheckinRange,
  parseCheckinRangeArgument,
  resolveCheckinConfig,
} from "../state/checkin-config";
import type { AppRuntimeConfig, ChannelAdapterLike, RuntimeAdapterLike, SessionStoreWriterLike } from "./app-service-contract";
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
  getAvailableModelCatalog(): AvailableModelCatalogView | null;
  getCodexParamsForWorkspace(bindingKey: string, workspaceRoot: string): { model?: string; effort?: string };
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
  checkin(normalized: ControlCommandMessage, command: ParsedChannelCommand): Promise<void>;
  effort(normalized: ControlCommandMessage, command: ParsedChannelCommand): Promise<void>;
  help(normalized: ControlCommandMessage, command?: ParsedChannelCommand): Promise<void>;
  model(normalized: ControlCommandMessage, command: ParsedChannelCommand): Promise<void>;
}

function createControlCommandHandlers({
  channelAdapter,
  config,
  resolveWorkspaceRoot,
  runtimeAdapter,
  sessionWriter,
  threadStateStore,
}: {
  channelAdapter: ControlCommandChannelAdapter;
  config: Pick<AppRuntimeConfig, "checkinConfigFile">;
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
      const [modelQuery = "", effortQuery = "", ...rest] = splitCommandArgs(command.args);
      const query = normalizeCommandArgument(modelQuery);
      const catalog = sessionStore.getAvailableModelCatalog();
      const currentParams = sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
      const currentModel = normalizeCommandArgument(currentParams.model);
      const currentEffort = normalizeCommandArgument(currentParams.effort);

      if (!query && !effortQuery && !rest.length) {
        await sendText(channelAdapter, normalized, buildModelInspectText({
          catalog,
          currentEffort,
          currentModel,
        }));
        return;
      }
      if (!query || rest.length) {
        await sendText(channelAdapter, normalized, "用法：/model <id> [effort]");
        return;
      }

      const matched = findModelByQuery(catalog?.models || [], query);
      if (!matched) {
        await sendText(channelAdapter, normalized, `未找到模型：${query}`);
        return;
      }
      const nextEffort = resolveModelEffort({
        currentEffort,
        explicitEffortQuery: effortQuery,
        model: matched,
      });
      if (effortQuery && !nextEffort) {
        await sendText(channelAdapter, normalized, buildUnsupportedEffortText(matched, effortQuery));
        return;
      }

      await sessionWriter.setCodexParamsForWorkspace(bindingKey, workspaceRoot, {
        model: matched.model,
        effort: nextEffort,
      });
      await sendText(channelAdapter, normalized, [
        "已切换模型。",
        "",
        `workspace: ${workspaceRoot}`,
        `model: ${matched.model}`,
        `effort: ${nextEffort || "(default)"}`,
      ].join("\n"));
    },

    async effort(normalized: ControlCommandMessage, command: ParsedChannelCommand): Promise<void> {
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
      const [effortQuery = "", ...rest] = splitCommandArgs(command.args);
      const catalog = sessionStore.getAvailableModelCatalog();
      const currentParams = sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
      const currentModel = normalizeCommandArgument(currentParams.model);
      const currentEffort = normalizeCommandArgument(currentParams.effort);
      const effectiveModel = resolveEffectiveModelForEffort(catalog?.models || [], currentModel);

      if (!effortQuery && !rest.length) {
        await sendText(channelAdapter, normalized, buildEffortInspectText({
          currentEffort,
          currentModel,
          effectiveModel,
        }));
        return;
      }
      if (!effortQuery || rest.length) {
        await sendText(channelAdapter, normalized, "用法：/effort <level>");
        return;
      }
      if (!effectiveModel) {
        await sendText(channelAdapter, normalized, "当前还无法单独设置 effort：先执行 /model，或等待模型列表可用。");
        return;
      }
      const matchedEffort = findReasoningEffortByQuery(effectiveModel.supportedReasoningEfforts, effortQuery);
      if (!matchedEffort) {
        await sendText(channelAdapter, normalized, buildUnsupportedEffortText(effectiveModel, effortQuery));
        return;
      }

      await sessionWriter.setCodexParamsForWorkspace(bindingKey, workspaceRoot, {
        model: effectiveModel.model,
        effort: matchedEffort,
      });
      const lines = [
        "已切换 effort。",
        "",
        `workspace: ${workspaceRoot}`,
        `model: ${effectiveModel.model}`,
        `effort: ${matchedEffort}`,
      ];
      if (!currentModel) {
        lines.push("modelSource: default");
      }
      await sendText(channelAdapter, normalized, lines.join("\n"));
    },

    async checkin(normalized: ControlCommandMessage, command: ParsedChannelCommand): Promise<void> {
      const configFile = normalizeCommandArgument(config.checkinConfigFile);
      if (!configFile) {
        await sendText(channelAdapter, normalized, "当前未配置 checkin config file。");
        return;
      }
      const [firstArg = "", ...rest] = splitCommandArgs(command.args);
      if (!firstArg && !rest.length) {
        await sendText(channelAdapter, normalized, buildCheckinInspectText(configFile));
        return;
      }
      if (rest.length) {
        await sendText(channelAdapter, normalized, "用法：/checkin [3-60 | reset]");
        return;
      }

      const normalizedArg = normalizeCommandArgument(firstArg).toLowerCase();
      const store = new CheckinConfigStore({ filePath: configFile });
      if (normalizedArg === "reset") {
        store.reset();
        await sendText(channelAdapter, normalized, `已重置 checkin 区间。\n\n${buildCheckinInspectText(configFile)}`);
        return;
      }

      const parsedRange = parseCheckinRangeArgument(normalizedArg);
      if (!parsedRange) {
        await sendText(channelAdapter, normalized, "用法：/checkin [3-60 | reset]");
        return;
      }
      store.setConfig(parsedRange);
      await sendText(channelAdapter, normalized, `已更新 checkin 区间。\n\n${buildCheckinInspectText(configFile)}`);
    },

    async help(normalized: ControlCommandMessage): Promise<void> {
      await sendText(channelAdapter, normalized, buildWeixinHelpText());
    },
  };
}

function normalizeCommandArgument(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  createControlCommandHandlers,
};

function buildCheckinInspectText(filePath: string): string {
  const resolved = resolveCheckinConfig({ filePath });
  return [
    `当前 checkin: ${formatCheckinRange(resolved)}`,
    `source: ${mapCheckinSourceLabel(resolved.source)}`,
    "用法：/checkin 3-60 或 /checkin reset",
  ].join("\n");
}

function buildEffortInspectText({
  currentModel,
  currentEffort,
  effectiveModel,
}: {
  currentModel: string;
  currentEffort: string;
  effectiveModel: NormalizedModelCatalogEntry | null;
}): string {
  const lines = [
    `当前模型: ${currentModel || effectiveModel?.model || "(default)"}`,
    `当前 effort: ${currentEffort || "(default)"}`,
  ];
  if (effectiveModel) {
    lines.push(`可用 effort: ${formatEffortList(effectiveModel.supportedReasoningEfforts)}`);
    if (effectiveModel.defaultReasoningEffort) {
      lines.push(`默认 effort: ${effectiveModel.defaultReasoningEffort}`);
    }
  } else {
    lines.push("可用 effort: (未获取到模型列表)");
  }
  return lines.join("\n");
}

function buildModelInspectText({
  catalog,
  currentEffort,
  currentModel,
}: {
  catalog: AvailableModelCatalogView | null;
  currentEffort: string;
  currentModel: string;
}): string {
  const effectiveModel = resolveEffectiveModelForEffort(catalog?.models || [], currentModel);
  const lines = [
    `当前模型: ${currentModel || "(default)"}`,
    `当前 effort: ${currentEffort || "(default)"}`,
  ];
  if (catalog?.models?.length) {
    lines.push(`可用模型: ${catalog.models.map((item) => item.model).join("、")}`);
  } else {
    lines.push("可用模型: (未获取到模型列表)");
  }
  if (effectiveModel) {
    lines.push(`可用 effort: ${formatEffortList(effectiveModel.supportedReasoningEfforts)}`);
    if (effectiveModel.defaultReasoningEffort) {
      lines.push(`默认 effort: ${effectiveModel.defaultReasoningEffort}`);
    }
  }
  return lines.join("\n");
}

function buildUnsupportedEffortText(
  model: Pick<NormalizedModelCatalogEntry, "model" | "supportedReasoningEfforts">,
  effortQuery: string,
): string {
  return `模型 ${model.model} 不支持 effort：${effortQuery}\n可用 effort: ${formatEffortList(model.supportedReasoningEfforts)}`;
}

async function clearPendingApproval(sessionWriter: ControlCommandSessionWriter, threadId: string): Promise<void> {
  if (typeof sessionWriter?.clearPendingApprovalForThread === "function") {
    await sessionWriter.clearPendingApprovalForThread(threadId);
    return;
  }
  if (typeof sessionWriter?.clearApprovalPrompt === "function") {
    await sessionWriter.clearApprovalPrompt(threadId);
  }
}

function formatEffortList(efforts: unknown): string {
  return Array.isArray(efforts) && efforts.length ? efforts.join("、") : "(未获取到 effort 列表)";
}

function mapCheckinSourceLabel(source: "stored" | "env" | "default"): string {
  if (source === "stored") {
    return "stored";
  }
  if (source === "env") {
    return "env";
  }
  return "default";
}

function resolveModelEffort({
  currentEffort,
  explicitEffortQuery,
  model,
}: {
  currentEffort: string;
  explicitEffortQuery: string;
  model: NormalizedModelCatalogEntry;
}): string {
  const explicitEffort = findReasoningEffortByQuery(model.supportedReasoningEfforts, explicitEffortQuery);
  if (explicitEffortQuery) {
    return explicitEffort;
  }
  const persistedEffort = findReasoningEffortByQuery(model.supportedReasoningEfforts, currentEffort);
  if (persistedEffort) {
    return persistedEffort;
  }
  return normalizeCommandArgument(model.defaultReasoningEffort);
}

async function sendText(
  channelAdapter: ControlCommandChannelAdapter,
  normalized: ControlCommandMessage,
  text: string,
): Promise<void> {
  await channelAdapter.sendText({
    userId: normalized.senderId,
    text,
    contextToken: normalized.contextToken,
  });
}

function splitCommandArgs(value: unknown): string[] {
  return normalizeCommandArgument(value).split(/\s+/u).filter(Boolean);
}
