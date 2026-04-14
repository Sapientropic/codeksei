const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { handleReplyDeliveryFailure } = require("../src/core/reply-delivery-failure");

test("reply delivery failure clears local turn state when weixin send stays broken", async () => {
  const calls: Array<[string, ...string[]]> = [];
  await handleReplyDeliveryFailure({
    threadId: "thread-1",
    turnId: "turn-1",
    error: new Error("sendMessage ret=-2"),
    sentText: "partial text",
  }, {
    runtimeAdapter: {
      getSessionStore() {
        return {
          findBindingForThreadId(threadId: string) {
            calls.push(["findBindingForThreadId", threadId]);
            return { workspaceRoot: "E:/repo/current" };
          },
        };
      },
    },
    sessionWriter: {
      async clearPendingApprovalForThread(threadId: string) {
        calls.push(["clearPendingApprovalForThread", threadId]);
      },
      async rememberApprovalPrefixForWorkspace() {
        return [];
      },
      async rememberPendingApprovalForThread() {
        return null;
      },
      async rememberWorkspaceBootstrapForThread() {
        return null;
      },
      async setActiveWorkspaceRoot() {
        return null;
      },
      async setRuntimeParamsForWorkspace() {
        return null;
      },
      async setThreadIdForWorkspace() {
        return null;
      },
      async clearThreadIdForWorkspace() {
        return null;
      },
    },
    threadStateStore: {
      markTurnFailed(threadId: string, turnId: string, text: string) {
        calls.push(["markTurnFailed", threadId, turnId, text]);
      },
    },
    clearRuntimeEventWatchdog(threadId: string) {
      calls.push(["clearRuntimeEventWatchdog", threadId]);
    },
    clearTurnSettlementWatchdog(threadId: string, turnId: string) {
      calls.push(["clearTurnSettlementWatchdog", threadId, turnId]);
    },
    stopTypingForThread: async (threadId: string) => {
      calls.push(["stopTypingForThread", threadId]);
    },
  });

  assert.deepEqual(calls, [
    ["findBindingForThreadId", "thread-1"],
    ["clearRuntimeEventWatchdog", "thread-1"],
    ["clearTurnSettlementWatchdog", "thread-1", "turn-1"],
    ["clearPendingApprovalForThread", "thread-1"],
    ["markTurnFailed", "thread-1", "turn-1", "微信发送层连续失败（sendMessage ret=-2），本地已停止继续投递这轮回复。"],
    ["stopTypingForThread", "thread-1"],
  ]);
});

test("reply delivery failure ignores empty thread ids", async () => {
  let touched = false;
  await handleReplyDeliveryFailure({
    threadId: "   ",
    error: new Error("boom"),
  }, {
    runtimeAdapter: {
      getSessionStore() {
        touched = true;
        return {};
      },
    },
    sessionWriter: {
      async rememberApprovalPrefixForWorkspace() {
        touched = true;
        return [];
      },
      async rememberPendingApprovalForThread() {
        touched = true;
        return null;
      },
      async rememberWorkspaceBootstrapForThread() {
        touched = true;
        return null;
      },
      async setActiveWorkspaceRoot() {
        touched = true;
        return null;
      },
      async setRuntimeParamsForWorkspace() {
        touched = true;
        return null;
      },
      async setThreadIdForWorkspace() {
        touched = true;
        return null;
      },
      async clearThreadIdForWorkspace() {
        touched = true;
        return null;
      },
    },
    threadStateStore: {
      markTurnFailed() {
        touched = true;
      },
    },
    clearRuntimeEventWatchdog() {
      touched = true;
    },
    clearTurnSettlementWatchdog() {
      touched = true;
    },
    stopTypingForThread: async () => {
      touched = true;
    },
  });

  assert.equal(touched, false);
});
