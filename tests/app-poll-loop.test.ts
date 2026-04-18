const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  formatErrorMessage,
  resolveLongPollTimeoutMs,
  runAppPollLoop,
}: typeof import("../src/core/app-poll-loop") = require("../src/core/app-poll-loop");

test("app poll loop timeout collapses to min timeout for busy queues and reminder windows", () => {
  assert.equal(resolveLongPollTimeoutMs({
    systemMessageDispatcher: { hasPending: () => true },
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
  const callOrder: string[] = [];
  const heartbeatPatches: Array<Record<string, unknown>> = [];
  const shutdown = { stopped: false };

  await runAppPollLoop({
    account: { accountId: "acct-1" },
    runtimeState: { endpoint: "ws://runtime", workspaceRoot: "E:/repo/current" },
    shutdown,
    channelAdapter: {
      loadSyncBuffer() {
        callOrder.push("loadSyncBuffer");
        return "sync-1";
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
    "loadSyncBuffer",
    "resolveLongPollTimeoutMs",
    "getUpdates",
    "handleIncomingMessage",
    "flushDueReminders",
    "flushPendingSystemMessages",
  ]);
  assert.equal(heartbeatPatches.length, 2);
  const firstHeartbeat = heartbeatPatches[0];
  const secondHeartbeat = heartbeatPatches[1];
  assert.ok(firstHeartbeat);
  assert.ok(secondHeartbeat);
  assert.equal(firstHeartbeat.status, "running");
  assert.equal(secondHeartbeat.status, "running");
  assert.equal(secondHeartbeat.lastError, "");
});

test("app poll loop turns session-expired transport failures into the login hint", async () => {
  await assert.rejects(
    () => runAppPollLoop({
      account: { accountId: "acct-1" },
      runtimeState: { endpoint: "ws://runtime", workspaceRoot: "E:/repo/current" },
      shutdown: { stopped: false },
      channelAdapter: {
        loadSyncBuffer() {
          return "";
        },
        async getUpdates() {
          const error = new Error("session expired") as Error & { errcode?: number };
          error.errcode = -14;
          throw error;
        },
      },
      flushDueReminders: async () => {},
      flushPendingSystemMessages: async () => {},
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
  const delays: number[] = [];
  const heartbeatPatches: Array<Record<string, unknown>> = [];
  const shutdown = { stopped: false };

  await runAppPollLoop({
    account: { accountId: "acct-1" },
    runtimeState: { endpoint: "ws://runtime", workspaceRoot: "E:/repo/current" },
    shutdown,
    channelAdapter: {
      loadSyncBuffer() {
        return "";
      },
      async getUpdates() {
        throw new Error("temporary boom");
      },
    },
    flushDueReminders: async () => {},
    flushPendingSystemMessages: async () => {},
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
  const degradedHeartbeat = heartbeatPatches[1];
  const backoffHeartbeat = heartbeatPatches[3];
  assert.ok(degradedHeartbeat);
  assert.ok(backoffHeartbeat);
  assert.equal(degradedHeartbeat.status, "degraded");
  assert.equal(degradedHeartbeat.consecutiveFailures, 1);
  assert.equal(backoffHeartbeat.consecutiveFailures, 2);
});

test("app poll loop error formatter keeps the user-facing login hint", () => {
  const error = new Error("session expired") as Error & { errcode?: number };
  error.errcode = -14;
  assert.equal(formatErrorMessage(error), "微信会话已失效，请重新执行 `npm run login`");
});
