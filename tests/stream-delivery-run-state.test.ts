const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildRunKey,
  collectVisibleItems,
  createRunState,
  ensureRunState,
  findRunState,
  removeStateItem,
  replaceStateItemText,
  upsertStateItem,
} = require("../src/runtime/stream-delivery/run-state");
const {
  applyRuntimeEventToStream,
}: typeof import("../src/runtime/stream-delivery/runtime-event-apply") = require("../src/runtime/stream-delivery/runtime-event-apply");
const {
  RUNTIME_EVENT_TYPES,
}: typeof import("../src/contracts/runtime-events") = require("../src/contracts/runtime-events");

test("run state reuses keyed runs and resolves pending turn fallback", () => {
  const stateByRunKey = new Map();
  const exact = ensureRunState(stateByRunKey, {
    threadId: "thread-1",
    turnId: "turn-1",
    weixinReplyMode: "stream",
  });
  const pending = ensureRunState(stateByRunKey, {
    threadId: "thread-1",
    turnId: "",
    weixinReplyMode: "stream",
  });
  pending.turnId = "turn-pending";

  assert.equal(buildRunKey("thread-1", "turn-1"), "thread-1:turn-1");
  assert.equal(buildRunKey("thread-1"), "thread-1:pending");
  assert.equal(ensureRunState(stateByRunKey, {
    threadId: "thread-1",
    turnId: "turn-1",
    weixinReplyMode: "stream",
  }), exact);
  assert.equal(findRunState(stateByRunKey, "thread-1", "turn-1"), exact);
  assert.equal(findRunState(stateByRunKey, "thread-1", "turn-pending"), pending);
});

test("run state item helpers normalize visible items without leaking markdown wrappers", () => {
  const state = createRunState({
    threadId: "thread-2",
    turnId: "turn-2",
    weixinReplyMode: "stream",
  });

  upsertStateItem(state, {
    itemId: "commentary-1",
    text: "**我先去查日志。**",
    completed: true,
    phase: "commentary",
    fragmentKind: "completed_snapshot",
  });
  upsertStateItem(state, {
    itemId: "final-1",
    text: "结论已经确认，`OK`。",
    completed: true,
    phase: "final",
    fragmentKind: "completed_snapshot",
  });

  assert.deepEqual(
    collectVisibleItems(state, { completedOnly: false }).map((item: {
      itemId: string;
      text: string;
      phase: string;
      completed: boolean;
    }) => ({
      itemId: item.itemId,
      text: item.text,
      phase: item.phase,
      completed: item.completed,
    })),
    [
      {
        itemId: "commentary-1",
        text: "我先去查日志。",
        phase: "commentary",
        completed: true,
      },
      {
        itemId: "final-1",
        text: "结论已经确认，OK。",
        phase: "final",
        completed: true,
      },
    ]
  );

  replaceStateItemText(state, "final-1", "最终版本。", true);
  removeStateItem(state, "commentary-1");

  assert.deepEqual(
    collectVisibleItems(state, { completedOnly: false }).map((item: { text: string }) => item.text),
    ["最终版本。"]
  );
});

test("runtime event stream ignores missing and explicitly ignored runs until terminal events", async () => {
  const disposed: string[] = [];
  const scheduled: string[] = [];
  const flushed: Array<{ force: boolean; source: string }> = [];
  const stateByRunKey = new Map();
  const ignoredRunKeys = new Set<string>(["thread-ignored:turn-ignored"]);
  const context = {
    ignoredRunKeys,
    stateByRunKey,
    weixinReplyMode: "stream" as const,
    attachReplyTarget() {
      return null;
    },
    clearScheduledFlush() {},
    disposeRunState(runKey: unknown) {
      disposed.push(String(runKey || ""));
      stateByRunKey.delete(String(runKey || ""));
    },
    async finishTurn() {},
    async flush(_state: unknown, options: { force: boolean; trigger?: { source?: string } | null }) {
      flushed.push({ force: options.force, source: String(options.trigger?.source || "") });
    },
    scheduleStreamingFlush(_state: unknown, options?: { trigger?: { source?: string } | null }) {
      scheduled.push(String(options?.trigger?.source || ""));
    },
  };

  await applyRuntimeEventToStream(context, {
    type: RUNTIME_EVENT_TYPES.REPLY_DELTA,
    payload: { text: "no thread" },
  });
  await applyRuntimeEventToStream(context, {
    type: RUNTIME_EVENT_TYPES.REPLY_DELTA,
    payload: { threadId: "thread-ignored", turnId: "turn-ignored", text: "ignored" },
  });
  assert.deepEqual(scheduled, []);
  assert.equal(ignoredRunKeys.has("thread-ignored:turn-ignored"), true);

  await applyRuntimeEventToStream(context, {
    type: RUNTIME_EVENT_TYPES.TURN_COMPLETED,
    payload: { threadId: "thread-ignored", turnId: "turn-ignored" },
  });
  assert.equal(ignoredRunKeys.has("thread-ignored:turn-ignored"), false);

  await applyRuntimeEventToStream(context, {
    type: RUNTIME_EVENT_TYPES.TURN_FAILED,
    payload: { threadId: "thread-failed", turnId: "turn-failed" },
  });
  assert.deepEqual(disposed, ["thread-failed:turn-failed"]);

  await applyRuntimeEventToStream(context, {
    type: "runtime.unknown" as never,
    payload: { threadId: "thread-unknown", turnId: "turn-unknown" },
  });
  assert.deepEqual(flushed, []);
});

test("runtime event stream starts turns, schedules deltas, and force-flushes completion", async () => {
  const disposed: string[] = [];
  const scheduled: Array<{ itemId: string; relation: string; source: string }> = [];
  const flushed: Array<{ force: boolean; source: string }> = [];
  const abandonedState = createRunState({
    threadId: "thread-1",
    turnId: "old",
    weixinReplyMode: "stream",
  });
  abandonedState.abandonedAt = 1;
  const stateByRunKey = new Map([
    [abandonedState.runKey, abandonedState],
  ]);
  const context = {
    ignoredRunKeys: new Set<string>(),
    stateByRunKey,
    weixinReplyMode: "stream" as const,
    attachReplyTarget(state: { replyTarget?: unknown }) {
      state.replyTarget = { provider: "weixin", userId: "user-1", contextToken: "ctx-1" };
      return state.replyTarget as never;
    },
    clearScheduledFlush() {},
    disposeRunState(runKey: unknown) {
      disposed.push(String(runKey || ""));
      stateByRunKey.delete(String(runKey || ""));
    },
    async finishTurn() {},
    async flush(_state: unknown, options: { force: boolean; trigger?: { source?: string } | null }) {
      flushed.push({ force: options.force, source: String(options.trigger?.source || "") });
    },
    scheduleStreamingFlush(_state: unknown, options?: { trigger?: { itemId?: string; fragmentRelation?: string; source?: string } | null }) {
      scheduled.push({
        itemId: String(options?.trigger?.itemId || ""),
        relation: String(options?.trigger?.fragmentRelation || ""),
        source: String(options?.trigger?.source || ""),
      });
    },
  };

  await applyRuntimeEventToStream(context, {
    type: RUNTIME_EVENT_TYPES.TURN_STARTED,
    payload: { threadId: "thread-1", turnId: "turn-1" },
  });
  assert.deepEqual(disposed, ["thread-1:old"]);

  await applyRuntimeEventToStream(context, {
    type: RUNTIME_EVENT_TYPES.REPLY_DELTA,
    payload: { threadId: "thread-1", turnId: "turn-1", itemId: "", text: "第一句。", phase: "final" },
  });
  assert.deepEqual(scheduled, [{
    itemId: "item-1",
    relation: "append",
    source: RUNTIME_EVENT_TYPES.REPLY_DELTA,
  }]);

  await applyRuntimeEventToStream(context, {
    type: RUNTIME_EVENT_TYPES.REPLY_COMPLETED,
    payload: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", text: "第一句。", phase: "final" },
  });
  assert.deepEqual(flushed[0], { force: false, source: RUNTIME_EVENT_TYPES.REPLY_COMPLETED });

  await applyRuntimeEventToStream(context, {
    type: RUNTIME_EVENT_TYPES.TURN_COMPLETED,
    payload: { threadId: "thread-1", turnId: "turn-1" },
  });
  assert.deepEqual(flushed[1], { force: true, source: RUNTIME_EVENT_TYPES.TURN_COMPLETED });
  assert.equal(disposed.includes("thread-1:turn-1"), true);
});
