function buildChannelCommandContext({
  normalized,
  resolveWorkspaceRoot,
  runtimeAdapter,
  threadStateStore,
}) {
  const sessionStore = runtimeAdapter.getSessionStore();
  const bindingKey = sessionStore.buildBindingKey({
    workspaceId: normalized.workspaceId,
    accountId: normalized.accountId,
    senderId: normalized.senderId,
  });
  const workspaceRoot = resolveWorkspaceRoot(bindingKey);
  const threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
  const threadState = threadId ? threadStateStore.getThreadState(threadId) : null;

  return {
    bindingKey,
    sessionStore,
    threadId,
    threadState,
    usage: threadStateStore.getLatestUsage(),
    workspaceRoot,
  };
}

module.exports = {
  buildChannelCommandContext,
};
