function buildChannelCommandContext({
  normalized,
  resolveWorkspaceRoot,
  runtimeAdapter,
  threadStateStore,
}: any) {
  const sessionStore = runtimeAdapter.getSessionStore();
  const bindingKey = sessionStore.buildBindingKey({
    workspaceId: normalized.workspaceId,
    accountId: normalized.accountId,
    senderId: normalized.senderId,
  });
  const workspaceRoot = resolveWorkspaceRoot(bindingKey);
  const threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
  const inMemoryThreadState = threadId ? threadStateStore.getThreadState(threadId) : null;
  const persistedPendingApproval = threadId && typeof sessionStore.getPendingApprovalForThread === "function"
    ? sessionStore.getPendingApprovalForThread(threadId)
    : null;

  return {
    bindingKey,
    sessionStore,
    threadId,
    threadState: mergeThreadState(inMemoryThreadState, threadId, persistedPendingApproval),
    usage: resolveThreadUsage(threadStateStore, threadId),
    workspaceRoot,
  };
}

function mergeThreadState(threadState: any, threadId: any, pendingApproval: any) {
  if (threadState && (!threadState.pendingApproval || !pendingApproval)) {
    return threadState;
  }
  if (threadState && pendingApproval) {
    return {
      ...threadState,
      status: "waiting_approval",
      pendingApproval,
    };
  }
  if (!threadId || !pendingApproval) {
    return threadState || null;
  }
  return {
    threadId,
    turnId: "",
    status: "waiting_approval",
    lastReplyText: "",
    lastError: "",
    pendingApproval,
    usage: null,
    updatedAt: pendingApproval.promptedAt || "",
  };
}

function resolveThreadUsage(threadStateStore: any, threadId: any) {
  if (!threadId) {
    return null;
  }
  if (typeof threadStateStore?.getUsageForThread === "function") {
    return threadStateStore.getUsageForThread(threadId);
  }
  if (typeof threadStateStore?.getLatestUsage === "function") {
    return threadStateStore.getLatestUsage(threadId);
  }
  return null;
}

module.exports = {
  buildChannelCommandContext,
};

export {};
