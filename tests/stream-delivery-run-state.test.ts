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
