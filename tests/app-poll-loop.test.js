const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatErrorMessage,
  resolveLongPollTimeoutMs,
  runAppPollLoop,
} = require("../src/core/app-poll-loop");

test("app poll loop timeout collapses to min timeout for busy queues and reminder windows", () => {
  assert.equal(resolveLongPollTimeoutMs({
    systemMessageDispatcher: { hasPending: () => true },
    defaultLongPollTimeoutMs: 35_000,
    minLongPollTimeoutMs: 2_000,
  }), 2_000);

  assert.equal(resolveLongPollTimeoutMs({
    activeAccountId: "acct-1",
    timelineScreenshotQueue: { hasPendingForAccount: () => true },
    defaultLongPollTimeoutMs: 35_000,
    minLongPollTimeoutMs: 2_000,
  }), 2_000);

  assert.equal(resolveLongPollTimeoutMs({
    reminderQueue: { peekNextDueAtMs: () => 12_000 },
    defaultLongPollTimeoutMs: 35_000,
    minLongPollTimeoutMs: 2_000,
    now: () => 10_000,
  }), 2_000);

  assert.equal(resolveLongPollTimeoutMs({
    reminderQueue: { peekNextDueAtMs: () => 22_000 },
    defaultLongPollTimeoutMs: 35_000,
    minLongPollTimeoutMs: 2_000,
    now: () => 10_000,
  }), 12_000);
});

test("app poll loop keeps flush ordering around successful getUpdates cycles", async () => {
  const callOrder = [];
  const heartbeatPatches = [];
  const shutdown = { stopped: false };

  await runAppPollLoop({
    account: { accountId: "acct-1" },
    runtimeState: { endpoint: "ws://runtime", workspaceRoot: "E:/repo/current" },
    shutdown,
    channelAdapter: {
      loadSyncBuffer() {
        callOrder.push("loadSyncBuffer");
        return { cursor: "sync-1" };
      },
      async getUpdates() {
        callOrder.push("getUpdates");
        return { ret: 0, msgs: [{ id: "msg-1" }] };
      },
    },
    flushDueReminders: async () => {
      callOrder.push("flushDueReminders");
    },
    flushPendingSystemMessages: async () => {
      callOrder.push("flushPendingSystemMessages");
    },
    flushPendingTimelineScreenshots: async () => {
      callOrder.push("flushPendingTimelineScreenshots");
    },
    resolveLongPollTimeoutMs: () => {
      callOrder.push("resolveLongPollTimeoutMs");
      return 35_000;
    },
    handleIncomingMessage: async () => {
      callOrder.push("handleIncomingMessage");
      shutdown.stopped = true;
    },
    updateBridgeHeartbeat: (patch) => {
      heartbeatPatches.push(patch);
    },
    retryDelayMs: 2_000,
    backoffDelayMs: 30_000,
    maxConsecutiveFailures: 3,
  });

  assert.deepEqual(callOrder, [
    "flushDueReminders",
    "flushPendingSystemMessages",
    "flushPendingTimelineScreenshots",
    "loadSyncBuffer",
    "resolveLongPollTimeoutMs",
    "getUpdates",
    "handleIncomingMessage",
    "flushDueReminders",
    "flushPendingSystemMessages",
    "flushPendingTimelineScreenshots",
  ]);
  assert.equal(heartbeatPatches.length, 2);
  assert.equal(heartbeatPatches[0].status, "running");
  assert.equal(heartbeatPatches[1].status, "running");
  assert.equal(heartbeatPatches[1].lastError, "");
});

test("app poll loop turns session-expired transport failures into the login hint", async () => {
  await assert.rejects(
    () => runAppPollLoop({
      account: { accountId: "acct-1" },
      runtimeState: { endpoint: "ws://runtime", workspaceRoot: "E:/repo/current" },
      shutdown: { stopped: false },
      channelAdapter: {
        loadSyncBuffer() {
          return {};
        },
        async getUpdates() {
          const error = new Error("session expired");
          error.errcode = -14;
          throw error;
        },
      },
      flushDueReminders: async () => {},
      flushPendingSystemMessages: async () => {},
      flushPendingTimelineScreenshots: async () => {},
      resolveLongPollTimeoutMs: () => 35_000,
      handleIncomingMessage: async () => {},
      updateBridgeHeartbeat: () => {},
      retryDelayMs: 2_000,
      backoffDelayMs: 30_000,
      maxConsecutiveFailures: 3,
    }),
    /微信会话已失效，请重新执行 `npm run login`/u
  );
});

test("app poll loop escalates from retry delay to backoff delay after repeated failures", async () => {
  const delays = [];
  const heartbeatPatches = [];
  const shutdown = { stopped: false };

  await runAppPollLoop({
    account: { accountId: "acct-1" },
    runtimeState: { endpoint: "ws://runtime", workspaceRoot: "E:/repo/current" },
    shutdown,
    channelAdapter: {
      loadSyncBuffer() {
        return {};
      },
      async getUpdates() {
        throw new Error("temporary boom");
      },
    },
    flushDueReminders: async () => {},
    flushPendingSystemMessages: async () => {},
    flushPendingTimelineScreenshots: async () => {},
    resolveLongPollTimeoutMs: () => 35_000,
    handleIncomingMessage: async () => {},
    updateBridgeHeartbeat: (patch) => {
      heartbeatPatches.push(patch);
    },
    retryDelayMs: 2_000,
    backoffDelayMs: 30_000,
    maxConsecutiveFailures: 2,
    sleep: async (delayMs) => {
      delays.push(delayMs);
      if (delays.length >= 2) {
        shutdown.stopped = true;
      }
    },
  });

  assert.deepEqual(delays, [2_000, 30_000]);
  assert.equal(heartbeatPatches[1].status, "degraded");
  assert.equal(heartbeatPatches[1].consecutiveFailures, 1);
  assert.equal(heartbeatPatches[3].consecutiveFailures, 2);
});

test("app poll loop error formatter keeps the user-facing login hint", () => {
  const error = new Error("session expired");
  error.errcode = -14;
  assert.equal(formatErrorMessage(error), "微信会话已失效，请重新执行 `npm run login`");
});
