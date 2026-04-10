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
