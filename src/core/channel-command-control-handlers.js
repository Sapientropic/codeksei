const { findModelByQuery } = require("../adapters/runtime/codex/model-catalog");
const { buildWeixinHelpText } = require("./command-registry");
const { buildChannelCommandContext } = require("./channel-command-context");

function createControlCommandHandlers({
  channelAdapter,
  resolveWorkspaceRoot,
  runtimeAdapter,
  threadStateStore,
}) {
  return {
    async approval(normalized, command) {
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
      const approval = threadState?.pendingApproval || null;
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
      sessionStore.clearApprovalPrompt(threadId);
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

    async model(normalized, command) {
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

    async help(normalized) {
      await channelAdapter.sendText({
        userId: normalized.senderId,
        text: buildWeixinHelpText(),
        contextToken: normalized.contextToken,
      });
    },
  };
}

function normalizeCommandArgument(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  createControlCommandHandlers,
};
