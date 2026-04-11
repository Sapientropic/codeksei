const test = require("node:test");
const assert = require("node:assert/strict");

const { StreamDelivery } = require("../src/core/stream-delivery");

test("finalizeAbandonedTurn flushes partial text and ignores late terminal events", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "settled",
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
    weixinReplyMode: "settled",
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

test("weixin stream delivery sends completed assistant items before turn completion", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "stream",
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-stream" };
      },
    },
  });

  delivery.queueReplyTargetForThread("thread-stream", {
    userId: "user-stream",
    contextToken: "ctx-stream",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-stream",
      turnId: "turn-stream",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.delta",
    payload: {
      threadId: "thread-stream",
      turnId: "turn-stream",
      itemId: "item-1",
      text: "我先看一眼，",
    },
  });
  assert.equal(sent.length, 0);
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream",
      turnId: "turn-stream",
      itemId: "item-1",
      text: "我先看一眼，再继续。",
      phase: "commentary",
    },
  });
  assert.deepEqual(
    sent.map((payload) => ({ text: payload.text, preserveBlock: payload.preserveBlock })),
    [
      { text: "我先看一眼，再继续。", preserveBlock: false },
    ]
  );
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.delta",
    payload: {
      threadId: "thread-stream",
      turnId: "turn-stream",
      itemId: "item-2",
      text: "下面给你最后总结：",
    },
  });
  assert.equal(sent.length, 1);
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream",
      turnId: "turn-stream",
      itemId: "item-2",
      text: "下面给你最后总结：问题已经定位，改动也已经落好。",
      phase: "final",
    },
  });
  assert.equal(sent.length, 1);
  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-stream",
      turnId: "turn-stream",
    },
  });

  assert.deepEqual(
    sent.map((payload) => ({ text: payload.text, preserveBlock: payload.preserveBlock })),
    [
      { text: "我先看一眼，再继续。", preserveBlock: false },
      { text: "下面给你最后总结：问题已经定位，改动也已经落好。", preserveBlock: false },
    ]
  );
});

test("weixin stream delivery suppresses duplicate completed assistant blocks within one turn", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "stream",
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-stream-dedupe" };
      },
    },
  });

  delivery.queueReplyTargetForThread("thread-stream-dedupe", {
    userId: "user-stream-dedupe",
    contextToken: "ctx-stream-dedupe",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-stream-dedupe",
      turnId: "turn-stream-dedupe",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream-dedupe",
      turnId: "turn-stream-dedupe",
      itemId: "item-1",
      text: "但你刚刚那个“一字一蹦”，说明现在的新问题更像是流式切得太碎。",
      phase: "commentary",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream-dedupe",
      turnId: "turn-stream-dedupe",
      itemId: "item-2",
      text: "但你刚刚那个“一字一蹦”，说明现在的新问题更像是流式切得太碎。",
      phase: "commentary",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream-dedupe",
      turnId: "turn-stream-dedupe",
      itemId: "item-3",
      text: "下一步我会把流式窗口收成按条发送，最后总结再单独收尾。",
      phase: "commentary",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-stream-dedupe",
      turnId: "turn-stream-dedupe",
    },
  });

  assert.deepEqual(
    sent.map((payload) => ({ text: payload.text, preserveBlock: payload.preserveBlock })),
    [
      { text: "但你刚刚那个“一字一蹦”，说明现在的新问题更像是流式切得太碎。", preserveBlock: false },
      { text: "下一步我会把流式窗口收成按条发送，最后总结再单独收尾。", preserveBlock: false },
    ]
  );
});

test("weixin stream delivery holds long commentary and only flushes the final summary block on completion", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "stream",
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-stream-hybrid" };
      },
    },
  });

  delivery.queueReplyTargetForThread("thread-stream-hybrid", {
    userId: "user-stream-hybrid",
    contextToken: "ctx-stream-hybrid",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-stream-hybrid",
      turnId: "turn-stream-hybrid",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream-hybrid",
      turnId: "turn-stream-hybrid",
      itemId: "item-1",
      text: "我先去抓一下这轮的发送事件。",
      phase: "commentary",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream-hybrid",
      turnId: "turn-stream-hybrid",
      itemId: "item-2",
      text: "```任务卡片\n【继续任务】\n先查事件链\n\n【当前状态】\n正在分析 stream 模式为什么把 commentary 也整块发出来。\n```",
      phase: "commentary",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream-hybrid",
      turnId: "turn-stream-hybrid",
      itemId: "item-3",
      text: "结论：问题不是模型复读，而是 stream 模式把长 commentary 也当成了该实时发的消息块。我已经改成只流短进度，最终总结等 turn 完成后整块发。",
      phase: "final",
    },
  });

  assert.deepEqual(
    sent.map((payload) => ({ text: payload.text, preserveBlock: payload.preserveBlock })),
    [
      { text: "我先去抓一下这轮的发送事件。", preserveBlock: false },
    ]
  );

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-stream-hybrid",
      turnId: "turn-stream-hybrid",
    },
  });

  assert.deepEqual(
    sent.map((payload) => ({ text: payload.text, preserveBlock: payload.preserveBlock })),
    [
      { text: "我先去抓一下这轮的发送事件。", preserveBlock: false },
      { text: "结论：问题不是模型复读，而是 stream 模式把长 commentary 也当成了该实时发的消息块。我已经改成只流短进度，最终总结等 turn 完成后整块发。", preserveBlock: false },
    ]
  );
});

test("weixin stream delivery treats final_answer as terminal and waits for turn completion", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "stream",
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-stream-final-answer" };
      },
    },
  });

  delivery.queueReplyTargetForThread("thread-stream-final-answer", {
    userId: "user-stream-final-answer",
    contextToken: "ctx-stream-final-answer",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-stream-final-answer",
      turnId: "turn-stream-final-answer",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream-final-answer",
      turnId: "turn-stream-final-answer",
      itemId: "item-1",
      text: "已经修好了。",
      phase: "final_answer",
    },
  });

  assert.equal(sent.length, 0);

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-stream-final-answer",
      turnId: "turn-stream-final-answer",
    },
  });

  assert.deepEqual(
    sent.map((payload) => ({ text: payload.text, preserveBlock: payload.preserveBlock })),
    [
      { text: "已经修好了。", preserveBlock: false },
    ]
  );
});

test("weixin stream delivery holds a terminal brief block without phase until another item proves it is progress", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "stream",
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-stream-missing-phase" };
      },
    },
  });

  delivery.queueReplyTargetForThread("thread-stream-missing-phase", {
    userId: "user-stream-missing-phase",
    contextToken: "ctx-stream-missing-phase",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-stream-missing-phase",
      turnId: "turn-stream-missing-phase",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream-missing-phase",
      turnId: "turn-stream-missing-phase",
      itemId: "item-1",
      text: "我先查一下。",
    },
  });

  assert.equal(sent.length, 0);

  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-stream-missing-phase",
      turnId: "turn-stream-missing-phase",
      itemId: "item-2",
      text: "已经修好了。",
      phase: "final_answer",
    },
  });

  assert.deepEqual(
    sent.map((payload) => ({ text: payload.text, preserveBlock: payload.preserveBlock })),
    [
      { text: "我先查一下。", preserveBlock: false },
    ]
  );

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-stream-missing-phase",
      turnId: "turn-stream-missing-phase",
    },
  });

  assert.deepEqual(
    sent.map((payload) => ({ text: payload.text, preserveBlock: payload.preserveBlock })),
    [
      { text: "我先查一下。", preserveBlock: false },
      { text: "已经修好了。", preserveBlock: false },
    ]
  );
});

test("persistent send failure abandons the run and reports delivery degradation", async () => {
  const failures = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "settled",
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
    weixinReplyMode: "settled",
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
    weixinReplyMode: "settled",
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

test("weixin settled delivery keeps only the latest assistant message in one turn", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "settled",
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
      text: "我先去对一下页面和仓库状态。",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-collapse",
      turnId: "turn-collapse",
      itemId: "item-2",
      text: "我已经定位到两处页面确实旧了。",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-collapse",
      turnId: "turn-collapse",
      itemId: "item-3",
      text: "我已经把两处旧页面都更新好了，接下来只剩最后一遍通读。",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: {
      threadId: "thread-collapse",
      turnId: "turn-collapse",
    },
  });

  assert.deepEqual(sent, ["我已经把两处旧页面都更新好了，接下来只剩最后一遍通读。"]);
});

test("watchdog settled delivery keeps only the latest safe visible text and appends the watchdog tail", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "settled",
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-watchdog-latest" };
      },
    },
  });

  delivery.queueReplyTargetForThread("thread-watchdog-latest", {
    userId: "user-watchdog-latest",
    contextToken: "ctx-watchdog-latest",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-watchdog-latest",
      turnId: "turn-watchdog-latest",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-watchdog-latest",
      turnId: "turn-watchdog-latest",
      itemId: "item-1",
      text: "第一段已经确认完仓库状态。",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-watchdog-latest",
      turnId: "turn-watchdog-latest",
      itemId: "item-2",
      text: "第二段已经确认到两处页面都旧了。",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.delta",
    payload: {
      threadId: "thread-watchdog-latest",
      turnId: "turn-watchdog-latest",
      itemId: "item-3",
      text: "第三段还没收尾，但已经开始改第一处页面，",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.delta",
    payload: {
      threadId: "thread-watchdog-latest",
      turnId: "turn-watchdog-latest",
      itemId: "item-3",
      text: "第二处也准备一起改。",
    },
  });

  await delivery.finalizeAbandonedTurn({
    threadId: "thread-watchdog-latest",
    turnId: "turn-watchdog-latest",
    trailingText: "【系统提示】\n这一轮回复没有正常收尾。",
  });

  assert.deepEqual(sent, ["第三段还没收尾，但已经开始改第一处页面，第二处也准备一起改。\n\n【系统提示】\n这一轮回复没有正常收尾。"]);
});

test("watchdog settled delivery drops long commentary blocks instead of leaking them to WeChat", async () => {
  const sent = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "settled",
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload.text);
      },
    },
    sessionStore: {
      findBindingForThreadId() {
        return { bindingKey: "binding-watchdog-commentary" };
      },
    },
  });

  delivery.queueReplyTargetForThread("thread-watchdog-commentary", {
    userId: "user-watchdog-commentary",
    contextToken: "ctx-watchdog-commentary",
    provider: "weixin",
  });

  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: {
      threadId: "thread-watchdog-commentary",
      turnId: "turn-watchdog-commentary",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-watchdog-commentary",
      turnId: "turn-watchdog-commentary",
      itemId: "item-1",
      text: "我先去核一下发送链。",
      phase: "commentary",
    },
  });
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-watchdog-commentary",
      turnId: "turn-watchdog-commentary",
      itemId: "item-2",
      text: "1. 先把 stream / settled 两条链都过一遍。\n2. 再核对 watchdog 为什么会把中间施工说明整块发到微信。\n3. 如果确认是历史回退，再补测试把这类结构化 commentary 压住。",
      phase: "commentary",
    },
  });

  await delivery.finalizeAbandonedTurn({
    threadId: "thread-watchdog-commentary",
    turnId: "turn-watchdog-commentary",
    trailingText: "【系统提示】\n这一轮回复没有正常收尾。",
  });

  assert.deepEqual(sent, ["我先去核一下发送链。\n\n【系统提示】\n这一轮回复没有正常收尾。"]);
});
