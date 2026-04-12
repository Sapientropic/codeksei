// @ts-check

const {
  normalizeCommandArgument,
  normalizeText,
} = require("./approval-command-policy");

async function handleReplyDeliveryFailure({
  threadId,
  turnId = "",
  error,
  sentText = "",
}, {
  runtimeAdapter,
  threadStateStore,
  clearRuntimeEventWatchdog,
  clearTurnSettlementWatchdog,
  stopTypingForThread,
}) {
  const normalizedThreadId = normalizeCommandArgument(threadId);
  const normalizedTurnId = normalizeCommandArgument(turnId);
  if (!normalizedThreadId) {
    return;
  }

  const messageText = error instanceof Error ? error.message : String(error || "unknown error");
  const deliveryFailureText = isPersistentWeixinSendFailure(error)
    ? "微信发送层连续失败（sendMessage ret=-2），本地已停止继续投递这轮回复。"
    : `回复投递失败：${messageText}`;
  const sessionStore = runtimeAdapter.getSessionStore();
  const linked = sessionStore.findBindingForThreadId(normalizedThreadId);
  const workspaceRoot = normalizeText(linked?.workspaceRoot);

  console.error(
    `[codeksei] reply delivery degraded `
    + `thread=${normalizedThreadId} turn=${normalizedTurnId || "(pending)"} `
    + `workspace=${workspaceRoot || "(unknown)"} `
    + `sentChars=${String(sentText || "").length} `
    + `reason=${messageText}`
  );

  clearRuntimeEventWatchdog(normalizedThreadId);
  if (normalizedTurnId) {
    clearTurnSettlementWatchdog(normalizedThreadId, normalizedTurnId);
  }
  // Delivery failure is a local terminal state even if Codex later finishes
  // the turn, otherwise the bridge UI keeps showing a ghost "still replying".
  clearPendingApproval(sessionStore, normalizedThreadId);
  threadStateStore.markTurnFailed(normalizedThreadId, normalizedTurnId, deliveryFailureText);
  await stopTypingForThread(normalizedThreadId);
}

function isPersistentWeixinSendFailure(error) {
  const message = String(error?.message || error || "");
  return message.includes("sendMessage ret=-2");
}

function clearPendingApproval(sessionStore, threadId) {
  if (typeof sessionStore?.clearPendingApprovalForThread === "function") {
    sessionStore.clearPendingApprovalForThread(threadId);
    return;
  }
  if (typeof sessionStore?.clearApprovalPrompt === "function") {
    sessionStore.clearApprovalPrompt(threadId);
  }
}

module.exports = {
  handleReplyDeliveryFailure,
};
