const test = require("node:test");
const assert = require("node:assert/strict");

const { handleReplyDeliveryFailure } = require("../src/core/reply-delivery-failure");

test("reply delivery failure clears local turn state when weixin send stays broken", async () => {
  const calls = [];
  await handleReplyDeliveryFailure({
    threadId: "thread-1",
    turnId: "turn-1",
    error: new Error("sendMessage ret=-2"),
    sentText: "partial text",
  }, {
    runtimeAdapter: {
      getSessionStore() {
        return {
          findBindingForThreadId(threadId) {
            calls.push(["findBindingForThreadId", threadId]);
            return { workspaceRoot: "E:/repo/current" };
          },
          clearPendingApprovalForThread(threadId) {
            calls.push(["clearPendingApprovalForThread", threadId]);
          },
        };
      },
    },
    threadStateStore: {
      markTurnFailed(threadId, turnId, text) {
        calls.push(["markTurnFailed", threadId, turnId, text]);
      },
    },
    clearRuntimeEventWatchdog(threadId) {
      calls.push(["clearRuntimeEventWatchdog", threadId]);
    },
    clearTurnSettlementWatchdog(threadId, turnId) {
      calls.push(["clearTurnSettlementWatchdog", threadId, turnId]);
    },
    stopTypingForThread: async (threadId) => {
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
