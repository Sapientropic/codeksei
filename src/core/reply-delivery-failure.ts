import {
  normalizeCommandArgument,
  normalizeTrimmedText,
} from "./approval-command-policy";

interface RuntimeAdapterLike {
  getSessionStore(): {
    findBindingForThreadId(threadId: string): { workspaceRoot?: unknown } | null;
    clearPendingApprovalForThread?(threadId: string): void;
    clearApprovalPrompt?(threadId: string): void;
  };
}

interface ThreadStateStoreLike {
  markTurnFailed(threadId: string, turnId: string, deliveryFailureText: string): void;
}

interface DeliveryFailurePayload {
  threadId: unknown;
  turnId?: unknown;
  error: unknown;
  sentText?: unknown;
}

interface DeliveryFailureContext {
  runtimeAdapter: RuntimeAdapterLike;
  threadStateStore: ThreadStateStoreLike;
  clearRuntimeEventWatchdog(threadId: string): void;
  clearTurnSettlementWatchdog(threadId: string, turnId: string): void;
  stopTypingForThread(threadId: string): Promise<void>;
}

async function handleReplyDeliveryFailure({
  threadId,
  turnId = "",
  error,
  sentText = "",
}: DeliveryFailurePayload, {
  runtimeAdapter,
  threadStateStore,
  clearRuntimeEventWatchdog,
  clearTurnSettlementWatchdog,
  stopTypingForThread,
}: DeliveryFailureContext): Promise<void> {
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
  const workspaceRoot = normalizeTrimmedText(linked?.workspaceRoot);

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

function isPersistentWeixinSendFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("sendMessage ret=-2");
}

function clearPendingApproval(
  sessionStore: ReturnType<RuntimeAdapterLike["getSessionStore"]>,
  threadId: string,
): void {
  if (typeof sessionStore?.clearPendingApprovalForThread === "function") {
    sessionStore.clearPendingApprovalForThread(threadId);
    return;
  }
  if (typeof sessionStore?.clearApprovalPrompt === "function") {
    sessionStore.clearApprovalPrompt(threadId);
  }
}

export {
  handleReplyDeliveryFailure,
};
