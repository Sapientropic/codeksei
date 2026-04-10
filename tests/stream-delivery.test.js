const test = require("node:test");
const assert = require("node:assert/strict");

const { StreamDelivery } = require("../src/core/stream-delivery");

test("finalizeAbandonedTurn flushes partial text and ignores late terminal events", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-1" };
      },
    },
  });

  delivery.queueReplyTargetForThread("thread-1", {
    userId: "user-1",
    contextToken: "ctx-1",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.delta",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      text: "第一段还没正式收尾",
    },
  });

  await delivery.finalizeAbandonedTurn({
    threadId: "thread-1",
    turnId: "turn-1",
    trailingText: "【系统提示】\n这一轮回复没有正常收尾。",
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0], /第一段还没正式收尾/);
  assert.match(sent[0], /这一轮回复没有正常收尾/);

  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      text: "第一段正式收尾",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });

  assert.equal(sent.length, 1);
});

test("weixin replies wait until turn completion before sending", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-1" };
      },
    },
  });

  delivery.queueReplyTargetForThread("thread-buffered", {
    userId: "user-buffered",
    contextToken: "ctx-buffered",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-buffered",
      turnId: "turn-buffered",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-buffered",
      turnId: "turn-buffered",
      itemId: "item-1",
      text: "这条回复要等整轮完成后再发。",
    },
  });

  assert.equal(sent.length, 0);

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-buffered",
      turnId: "turn-buffered",
    },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "这条回复要等整轮完成后再发。");
  assert.equal(sent[0].preserveBlock, true);
});

test("persistent send failure abandons the run and reports delivery degradation", async () => {
  const failures = [];
  const delivery = new StreamDelivery({
    channelAdapter: {
      async sendText() {
        throw new Error("sendMessage ret=-2 errcode= errmsg=");
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-1" };
      },
    },
    onDeliveryFailure(payload) {
      failures.push(payload);
    },
  });

  delivery.queueReplyTargetForThread("thread-2", {
    userId: "user-2",
    contextToken: "ctx-2",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-2",
      turnId: "turn-2",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-2",
      turnId: "turn-2",
      itemId: "item-1",
      text: "这段内容会在投递时失败",
    },
  });

  assert.equal(failures.length, 0);

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-2",
      turnId: "turn-2",
    },
  });

  assert.equal(failures.length, 1);
  assert.equal(failures[0].threadId, "thread-2");
  assert.match(String(failures[0].error?.message || ""), /ret=-2/);
  assert.equal(delivery.findRunState("thread-2", "turn-2"), null);

  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-2",
      turnId: "turn-2",
      itemId: "item-1",
      text: "晚到的完成事件不该再继续发",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-2",
      turnId: "turn-2",
    },
  });

  assert.equal(failures.length, 1);
});

test("watchdog does not resurrect an already-disposed exact turn", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-1" };
      },
    },
  });

  await delivery.finalizeAbandonedTurn({
    threadId: "thread-gone",
    turnId: "turn-gone",
    trailingText: "这段 watchdog 尾巴不该被单独补发。",
  });

  assert.deepEqual(sent, []);
});

test("settled weixin delivery suppresses the same text twice on one thread", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-dup" };
      },
    },
  });

  delivery.setReplyTarget("binding-dup", {
    userId: "user-dup",
    contextToken: "ctx-dup",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-dup",
      turnId: "turn-1",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-dup",
      turnId: "turn-1",
      itemId: "item-1",
      text: "同一条完整回复不该马上连发两遍。",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-dup",
      turnId: "turn-1",
    },
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-dup",
      turnId: "turn-2",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-dup",
      turnId: "turn-2",
      itemId: "item-1",
      text: "同一条完整回复不该马上连发两遍。",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-dup",
      turnId: "turn-2",
    },
  });

  assert.deepEqual(sent, ["同一条完整回复不该马上连发两遍。"]);
});

test("weixin settled delivery collapses consecutive duplicate completed items within one turn", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-collapse" };
      },
    },
  });

  delivery.queueReplyTargetForThread("thread-collapse", {
    userId: "user-collapse",
    contextToken: "ctx-collapse",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-collapse",
      turnId: "turn-collapse",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-collapse",
      turnId: "turn-collapse",
      itemId: "item-1",
      text: "这是同一段完整回复。",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-collapse",
      turnId: "turn-collapse",
      itemId: "item-2",
      text: "这是同一段完整回复。",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-collapse",
      turnId: "turn-collapse",
      itemId: "item-3",
      text: "这是后续新增的一段。",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-collapse",
      turnId: "turn-collapse",
    },
  });

  assert.deepEqual(sent, ["这是同一段完整回复。\n\n这是后续新增的一段。"]);
});
