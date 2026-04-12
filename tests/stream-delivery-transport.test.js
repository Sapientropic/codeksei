const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildReplyText,
  normalizeDeliveryDelta,
  prepareStreamingDelivery,
} = require("../src/core/stream-delivery/delivery-transport");
const {
  createRunState,
  upsertStateItem,
} = require("../src/core/stream-delivery/run-state");

test("stream delivery transport only prepares streamable items until watchdog force flush", () => {
  const state = createRunState({
    threadId: "thread-1",
    turnId: "turn-1",
    weixinReplyMode: "stream",
  });
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
  const state = createRunState({
    threadId: "thread-2",
    turnId: "turn-2",
    weixinReplyMode: "settled",
  });
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
