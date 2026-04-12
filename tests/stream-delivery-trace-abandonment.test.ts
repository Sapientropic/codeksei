const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildSettledWeixinDeliveryKey,
  disposeSupersededAbandonedRuns,
  rememberRecentDelivery,
  resolveLateRewriteDelta,
  wasRecentlyDelivered,
} = require("../src/runtime/stream-delivery/trace-abandonment");

test("trace dedupe keys stay scoped to settled weixin deliveries and expire by ttl", () => {
  const state = {
    threadId: "thread-1",
    replyTarget: {
      provider: "weixin",
      userId: "user-1",
      contextToken: "ctx-1",
    },
    weixinReplyMode: "settled",
  };
  const key = buildSettledWeixinDeliveryKey(state, "结论已经确认。");
  const recent = new Map();

  assert.equal(key, "thread-1|user-1|ctx-1|结论已经确认。");
  assert.equal(wasRecentlyDelivered(recent, key, 1_000), false);
  rememberRecentDelivery(recent, key, 1_000);
  assert.equal(wasRecentlyDelivered(recent, key, 1_100), true);
  assert.equal(wasRecentlyDelivered(recent, key, 32_000), false);
});

test("late rewrite fallback upgrades an abandoned rewrite into a terminal resend", () => {
  const result = resolveLateRewriteDelta({
    state: {
      abandonedAt: Date.now(),
      sentText: "旧内容。",
    },
    delta: "",
    deltaResult: {
      delta: "",
      relation: "rewrite_without_extension",
      deliveredVisibleBefore: "旧内容。",
      deliveredVisibleAfter: "旧内容。",
    },
    force: true,
    safeText: "新内容。",
    streamPrepared: null,
  });

  assert.deepEqual(result, {
    delta: "新内容。",
    deltaResult: {
      delta: "新内容。",
      relation: "late_rewrite",
      deliveredVisibleBefore: "旧内容。",
      deliveredVisibleAfter: "新内容。",
    },
  });
});

test("abandonment cleanup only disposes superseded abandoned runs on the same thread", () => {
  const stateByRunKey = new Map([
    ["thread-1:turn-old", { runKey: "thread-1:turn-old", threadId: "thread-1", turnId: "turn-old", abandonedAt: 1 }],
    ["thread-1:turn-active", { runKey: "thread-1:turn-active", threadId: "thread-1", turnId: "turn-active", abandonedAt: 2 }],
    ["thread-1:turn-live", { runKey: "thread-1:turn-live", threadId: "thread-1", turnId: "turn-live", abandonedAt: 0 }],
    ["thread-2:turn-old", { runKey: "thread-2:turn-old", threadId: "thread-2", turnId: "turn-old", abandonedAt: 3 }],
  ]);
  const ignoredRunKeys = new Set();
  const disposed: string[] = [];

  disposeSupersededAbandonedRuns({
    stateByRunKey,
    ignoredRunKeys,
    threadId: "thread-1",
    activeTurnId: "turn-active",
    onDisposeRunKey(runKey: string) {
      disposed.push(runKey);
    },
  });

  assert.deepEqual(disposed, ["thread-1:turn-old"]);
  assert.deepEqual([...ignoredRunKeys], ["thread-1:turn-old"]);
});
