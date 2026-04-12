const test = require("node:test");
const assert = require("node:assert/strict");

const { ThreadStateStore } = require("../src/core/thread-state-store");
const { buildChannelCommandContext } = require("../src/core/channel-command-context");

test("channel command context only exposes usage for the current thread", () => {
  const threadStateStore = new ThreadStateStore();
  threadStateStore.applyRuntimeEvent({
    type: "runtime.usage.updated",
    payload: {
      threadId: "thread-a",
      turnId: "turn-a",
      lastTotalTokens: 111,
    },
  });
  threadStateStore.applyRuntimeEvent({
    type: "runtime.usage.updated",
    payload: {
      threadId: "thread-b",
      turnId: "turn-b",
      lastTotalTokens: 222,
    },
  });

  const sessionStore = {
    buildBindingKey() {
      return "workspace-1:acct-1:user-1";
    },
    getThreadIdForWorkspace() {
      return "thread-a";
    },
    getPendingApprovalForThread() {
      return null;
    },
  };

  const context = buildChannelCommandContext({
    normalized: {
      workspaceId: "workspace-1",
      accountId: "acct-1",
      senderId: "user-1",
    },
    resolveWorkspaceRoot() {
      return "E:/repo/current";
    },
    runtimeAdapter: {
      getSessionStore() {
        return sessionStore;
      },
    },
    threadStateStore,
  });

  assert.equal(context.threadId, "thread-a");
  assert.equal(context.usage.lastTotalTokens, 111);
  assert.equal(threadStateStore.getUsageForThread("thread-b").lastTotalTokens, 222);
});
