const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

import type { RunState } from "../src/runtime/stream-delivery/run-state";
const {
  buildAllVisibleReplyText,
  buildCurrentSafeReplyText,
  buildReplyText,
  commitPreparedStreamingDelivery,
  findLatestCompletedFinalReplyText,
  findLatestWatchdogVisibleReply,
  findLatestWatchdogVisibleReplyText,
  findStreamingTerminalReplyText,
  hasCompletedFlushTrigger,
  hasNaturalFlushBoundary,
  normalizeWeixinReplyMode,
  prefersFinalOnlyDelivery,
  prefersStreamingDelivery,
  shouldPreserveStreamingBlock,
  shouldScheduleStreamingIdleFlush,
  normalizeDeliveryDelta,
  prepareStreamingDelivery,
}: typeof import("../src/runtime/stream-delivery/delivery-transport") = require("../src/runtime/stream-delivery/delivery-transport");
const {
  collectVisibleItems,
  createRunState,
  upsertStateItem,
}: typeof import("../src/runtime/stream-delivery/run-state") = require("../src/runtime/stream-delivery/run-state");

function createWeixinRunState(threadId: string, turnId: string, weixinReplyMode: string): RunState {
  return createRunState({ threadId, turnId, weixinReplyMode });
}

test("stream delivery transport only prepares streamable items until watchdog force flush", () => {
  const state = createWeixinRunState("thread-1", "turn-1", "stream");
  state.replyTarget = {
    provider: "weixin",
    userId: "user-1",
    contextToken: "ctx-1",
  };

  upsertStateItem(state, {
    itemId: "commentary-1",
    text: "我先去抓日志。",
    completed: true,
    phase: "commentary",
    fragmentKind: "completed_snapshot",
  });
  upsertStateItem(state, {
    itemId: "commentary-2",
    text: "先列两点：\n1. 第一处怀疑点\n2. 第二处怀疑点",
    completed: true,
    phase: "commentary",
    fragmentKind: "completed_snapshot",
  });
  upsertStateItem(state, {
    itemId: "final-1",
    text: "结论已经确认。",
    completed: true,
    phase: "final",
    fragmentKind: "completed_snapshot",
  });
  upsertStateItem(state, {
    itemId: "__watchdog__",
    text: "【系统提示】\n这一轮回复没有正常收尾。",
    completed: true,
    fragmentKind: "completed_snapshot",
  });

  const prepared = prepareStreamingDelivery(state, { completedOnly: false, force: false });
  assert.deepEqual(prepared.deliveredItems.map((item) => item.itemId), ["commentary-1", "final-1"]);
  assert.equal(prepared.safeText, "我先去抓日志。\n\n结论已经确认。");

  const forced = prepareStreamingDelivery(state, { completedOnly: false, force: true });
  assert.ok(forced.safeText.includes("【系统提示】"));
});

test("settled reply assembly keeps only the latest visible reply plus watchdog tail", () => {
  const state = createWeixinRunState("thread-2", "turn-2", "settled");
  state.replyTarget = {
    provider: "weixin",
    userId: "user-2",
    contextToken: "ctx-2",
  };

  upsertStateItem(state, {
    itemId: "commentary-1",
    text: "我先去查一下。",
    completed: true,
    phase: "commentary",
    fragmentKind: "completed_snapshot",
  });
  upsertStateItem(state, {
    itemId: "final-1",
    text: "结论已经确认。",
    completed: true,
    phase: "final",
    fragmentKind: "completed_snapshot",
  });

  assert.equal(
    buildReplyText(state, { completedOnly: false, preferLatestMessage: true, force: false }),
    "结论已经确认。"
  );

  upsertStateItem(state, {
    itemId: "__watchdog__",
    text: "【系统提示】\n这一轮回复没有正常收尾。",
    completed: true,
    fragmentKind: "completed_snapshot",
  });

  assert.equal(
    buildReplyText(state, { completedOnly: false, preferLatestMessage: true, force: true }),
    "结论已经确认。\n\n【系统提示】\n这一轮回复没有正常收尾。"
  );
  assert.equal(normalizeDeliveryDelta("\n\n第二段。", { streaming: true }), "第二段。");
});

test("delivery transport honors final-only policy and duplicate collapse helpers", () => {
  const state = createWeixinRunState("thread-3", "turn-3", "stream");
  state.replyTarget = {
    provider: "system",
    userId: "system-user",
    contextToken: "system-token",
    deliveryPolicy: "final_only",
  } as never;

  upsertStateItem(state, {
    itemId: "commentary-1",
    text: "我先看看。",
    completed: true,
    phase: "commentary",
    fragmentKind: "completed_snapshot",
  });
  upsertStateItem(state, {
    itemId: "final-1",
    text: "SILENT",
    completed: true,
    phase: "final",
    fragmentKind: "completed_snapshot",
  });

  assert.equal(prefersFinalOnlyDelivery(state), true);
  assert.equal(prefersStreamingDelivery(state), false);
  assert.equal(buildReplyText(state, { completedOnly: true }), "SILENT");
  assert.deepEqual(buildCurrentSafeReplyText(state, { completedOnly: true }), "");

  state.replyTarget = {
    provider: "weixin",
    userId: "user-3",
    contextToken: "ctx-3",
  };
  assert.equal(buildAllVisibleReplyText(state, {
    completedOnly: true,
    collapseDuplicateVisibleItems: true,
  }), "我先看看。\n\nSILENT");
});

test("reply lookup helpers ignore watchdog-only tails and find terminal visible replies", () => {
  const state = createWeixinRunState("thread-lookup", "turn-lookup", "stream");
  state.replyTarget = {
    provider: "weixin",
    userId: "user-lookup",
    contextToken: "ctx-lookup",
  };

  upsertStateItem(state, {
    itemId: "__watchdog__",
    text: "【系统提示】\n这一轮回复没有正常收尾。",
    completed: true,
    fragmentKind: "completed_snapshot",
  });
  assert.equal(findLatestCompletedFinalReplyText(state), "");
  assert.equal(findLatestWatchdogVisibleReplyText(state, { completedOnly: true }), "");
  assert.equal(findStreamingTerminalReplyText(collectVisibleItems(state, { completedOnly: true })), null);

  upsertStateItem(state, {
    itemId: "commentary-1",
    text: "我先继续查一下。",
    completed: true,
    phase: "commentary",
    fragmentKind: "completed_snapshot",
  });
  upsertStateItem(state, {
    itemId: "commentary-list",
    text: "先列两点：\n1. 第一处\n2. 第二处",
    completed: false,
    phase: "commentary",
    fragmentKind: "delta",
  });
  upsertStateItem(state, {
    itemId: "final-1",
    text: "最终结论。",
    completed: true,
    phase: "final",
    fragmentKind: "completed_snapshot",
  });

  const visibleItems = collectVisibleItems(state, { completedOnly: false });
  assert.equal(findLatestCompletedFinalReplyText(state), "最终结论。");
  assert.equal(findLatestWatchdogVisibleReply(visibleItems)?.itemId, "final-1");
  assert.equal(findLatestWatchdogVisibleReplyText(state, { completedOnly: false }), "最终结论。");
  assert.equal(findStreamingTerminalReplyText(visibleItems)?.itemId, "commentary-list");
  assert.equal(normalizeWeixinReplyMode("settled"), "settled");
  assert.equal(normalizeWeixinReplyMode("anything-else"), "stream");
});

test("streaming delivery commit and scheduler helpers cover empty and failed delivery cases", () => {
  const state = createWeixinRunState("thread-4", "turn-4", "stream");
  state.replyTarget = {
    provider: "weixin",
    userId: "user-4",
    contextToken: "ctx-4",
  };
  upsertStateItem(state, {
    itemId: "final-1",
    text: "第一句。",
    completed: false,
    phase: "final",
    fragmentKind: "delta",
  });
  const prepared = prepareStreamingDelivery(state, { completedOnly: false, force: false });
  assert.equal(shouldPreserveStreamingBlock(null), false);
  assert.equal(shouldPreserveStreamingBlock({ deliveredItems: [] }), false);
  assert.equal(shouldPreserveStreamingBlock({ deliveredItems: [{}, {}] }), false);
  assert.equal(shouldScheduleStreamingIdleFlush(null), false);
  assert.equal(shouldScheduleStreamingIdleFlush({ deliveredItems: [{ phase: "final" }] }), false);

  commitPreparedStreamingDelivery(undefined, { delivered: true });
  commitPreparedStreamingDelivery({
    ...prepared,
    deliveredItems: [{ ...prepared.deliveredItems[0]!, itemId: "missing-item" }],
  }, { delivered: true });
  commitPreparedStreamingDelivery(prepared, { delivered: false });
  assert.equal(state.items.get("final-1")?.pendingVisibleSuffix, "第一句。");
  commitPreparedStreamingDelivery(prepared, { delivered: true });
  assert.equal(state.items.get("final-1")?.lastDeliveredVisibleText, "第一句。");
  assert.equal(state.items.get("final-1")?.pendingVisibleSuffix, "");
});

test("flush trigger and natural boundary helpers classify terminal and non-terminal text", () => {
  assert.equal(hasCompletedFlushTrigger(null, { REPLY_COMPLETED: "reply.done", TURN_COMPLETED: "turn.done" }), false);
  assert.equal(hasCompletedFlushTrigger({ source: "reply.done" }, { REPLY_COMPLETED: "reply.done", TURN_COMPLETED: "turn.done" }), true);
  assert.equal(hasCompletedFlushTrigger({ source: "finishTurn" }, { REPLY_COMPLETED: "reply.done", TURN_COMPLETED: "turn.done" }), true);
  assert.equal(hasNaturalFlushBoundary(""), false);
  assert.equal(hasNaturalFlushBoundary("还没结束"), false);
  assert.equal(hasNaturalFlushBoundary("换行结束\n"), false);
  assert.equal(hasNaturalFlushBoundary("中文句子。"), true);
  assert.equal(normalizeDeliveryDelta("\n\n保留前缀", { streaming: false }), "\n\n保留前缀");
});
