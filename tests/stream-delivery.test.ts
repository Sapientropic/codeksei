const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

import type { ChannelAdapterLike, SessionStoreLike } from "../src/core/app-service-contract";
import type { DeliveryFailurePayload } from "../src/core/runtime-types";
const { StreamDelivery }: typeof import("../src/runtime/stream-delivery") = require("../src/runtime/stream-delivery");

type StreamDeliveryInstance = import("../src/runtime/stream-delivery").StreamDelivery;

interface SentMessage {
  text: string;
  preserveBlock: boolean | undefined;
}

interface CreateDeliveryOptions {
  weixinReplyMode?: "stream" | "settled";
  streamIdleFlushMs?: number;
  streamForceFlushChars?: number;
  streamBoundaryFlushChars?: number;
  sendTextImpl?: ((payload: { text: string; preserveBlock?: boolean }) => Promise<void>) | null;
}

interface DeliveryHarness {
  delivery: StreamDeliveryInstance;
  sent: SentMessage[];
  attach(threadId: string): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDelivery({
  weixinReplyMode = "stream",
  streamIdleFlushMs = 5,
  streamForceFlushChars = 12,
  streamBoundaryFlushChars = 6,
  sendTextImpl = null,
}: CreateDeliveryOptions = {}): DeliveryHarness {
  const sent: SentMessage[] = [];
  const channelAdapter: ChannelAdapterLike = {
    describe() {
      return { id: "test-channel" };
    },
    getKnownContextTokens() {
      return {};
    },
    async getUpdates() {
      return { ret: 0, msgs: [] };
    },
    loadSyncBuffer() {
      return "";
    },
    async login() {},
    normalizeIncomingMessage(message) {
      return message;
    },
    printAccounts() {},
    resolveAccount() {
      return { accountId: "acct-1", baseUrl: "http://127.0.0.1" };
    },
    async sendFile() {
      return undefined;
    },
    async sendText(payload) {
      sent.push({
        text: payload.text,
        preserveBlock: payload.preserveBlock,
      });
      if (typeof sendTextImpl === "function") {
        await sendTextImpl(payload);
      }
      return undefined;
    },
    async sendTyping() {
      return undefined;
    },
  };
  const sessionStore: SessionStoreLike = {
    buildBindingKey() {
      return "";
    },
    findBindingForThreadId(threadId) {
      return { bindingKey: `binding-${threadId}`, workspaceRoot: "" };
    },
    getActiveWorkspaceRoot() {
      return "";
    },
    getApprovalCommandAllowlistForWorkspace() {
      return [];
    },
    getBinding() {
      return null;
    },
    getCodexParamsForWorkspace() {
      return { model: "" };
    },
    getPendingApprovalForThread() {
      return null;
    },
    getThreadIdForWorkspace() {
      return "";
    },
    listBindings() {
      return [];
    },
    listPendingApprovals() {
      return [];
    },
    rememberPendingApprovalForThread() {
      return null;
    },
    rememberWorkspaceBootstrapForThread() {},
  };
  const delivery = new StreamDelivery({
    weixinReplyMode,
    streamIdleFlushMs,
    streamForceFlushChars,
    streamBoundaryFlushChars,
    channelAdapter,
    sessionStore,
  });

  function attach(threadId: string): void {
    delivery.queueReplyTargetForThread(threadId, {
      userId: `user-${threadId}`,
      contextToken: `ctx-${threadId}`,
      provider: "weixin",
    });
  }

  return { delivery, sent, attach };
}

async function startTurn(delivery: StreamDeliveryInstance, threadId: string, turnId: string): Promise<void> {
  await delivery.handleRuntimeEvent({
    type: "runtime.turn.started",
    payload: { threadId, turnId },
  });
}

async function sendDelta(delivery: StreamDeliveryInstance, {
  threadId,
  turnId,
  itemId,
  text,
  phase = "final",
  fragmentKind = "delta",
}: {
  threadId: string;
  turnId: string;
  itemId: string;
  text: string;
  phase?: string;
  fragmentKind?: string;
}): Promise<void> {
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.delta",
    payload: { threadId, turnId, itemId, text, phase, fragmentKind },
  });
}

async function sendCompleted(delivery: StreamDeliveryInstance, {
  threadId,
  turnId,
  itemId,
  text,
  phase = "final",
}: {
  threadId: string;
  turnId: string;
  itemId: string;
  text: string;
  phase?: string;
}): Promise<void> {
  await delivery.handleRuntimeEvent({
    type: "runtime.reply.completed",
    payload: { threadId, turnId, itemId, text, phase },
  });
}

async function completeTurn(delivery: StreamDeliveryInstance, threadId: string, turnId: string): Promise<void> {
  await delivery.handleRuntimeEvent({
    type: "runtime.turn.completed",
    payload: { threadId, turnId },
  });
}

test("stream mode does not idle-flush unfinished final fragments", async () => {
  const { delivery, sent, attach } = createDelivery({
    streamIdleFlushMs: 5,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 100,
  });
  attach("thread-idle");
  await startTurn(delivery, "thread-idle", "turn-idle");

  await sendDelta(delivery, {
    threadId: "thread-idle",
    turnId: "turn-idle",
    itemId: "final-1",
    text: "还在查",
    phase: "final",
  });
  assert.equal(sent.length, 0);

  await sleep(20);
  assert.deepEqual(sent, []);
});

test("stream mode streams final items incrementally and turn completion only sends the tail", async () => {
  const { delivery, sent, attach } = createDelivery({
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 1,
  });
  attach("thread-final");
  await startTurn(delivery, "thread-final", "turn-final");

  await sendDelta(delivery, {
    threadId: "thread-final",
    turnId: "turn-final",
    itemId: "final-1",
    text: "第一句。",
  });
  await sendDelta(delivery, {
    threadId: "thread-final",
    turnId: "turn-final",
    itemId: "final-1",
    text: "第二句。",
  });
  await sleep(20);
  await completeTurn(delivery, "thread-final", "turn-final");

  assert.deepEqual(sent, [
    { text: "第一句。", preserveBlock: true },
    { text: "第二句。", preserveBlock: true },
  ]);
});

test("snapshot deltas replace the current item instead of concatenating duplicate prefixes", async () => {
  const { delivery, sent, attach } = createDelivery({
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 1,
  });
  attach("thread-snapshot");
  await startTurn(delivery, "thread-snapshot", "turn-snapshot");

  await sendDelta(delivery, {
    threadId: "thread-snapshot",
    turnId: "turn-snapshot",
    itemId: "final-1",
    text: "先给你一个开头。",
  });
  await sendDelta(delivery, {
    threadId: "thread-snapshot",
    turnId: "turn-snapshot",
    itemId: "final-1",
    text: "先给你一个开头。\n\n再补完整结论。",
    fragmentKind: "snapshot",
  });
  await sleep(20);

  assert.deepEqual(sent, [
    { text: "先给你一个开头。", preserveBlock: true },
    { text: "再补完整结论。", preserveBlock: true },
  ]);
});

test("completed snapshots continue from the unseen tail after a snapshot rewrite", async () => {
  const { delivery, sent, attach } = createDelivery({
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 1,
  });
  attach("thread-completed");
  await startTurn(delivery, "thread-completed", "turn-completed");

  await sendDelta(delivery, {
    threadId: "thread-completed",
    turnId: "turn-completed",
    itemId: "final-1",
    text: "第一段。",
  });
  await sendDelta(delivery, {
    threadId: "thread-completed",
    turnId: "turn-completed",
    itemId: "final-1",
    text: "第一段。\n\n第二段。",
    fragmentKind: "snapshot",
  });
  await sendCompleted(delivery, {
    threadId: "thread-completed",
    turnId: "turn-completed",
    itemId: "final-1",
    text: "第一段。\n\n第二段。\n\n第三段。",
  });
  await sleep(20);

  assert.deepEqual(sent, [
    { text: "第一段。", preserveBlock: true },
    { text: "第二段。\n\n第三段。", preserveBlock: true },
  ]);
});

test("short snapshot rewrites below the old 40-char gate still replace without duplication", async () => {
  const { delivery, sent, attach } = createDelivery({
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 1,
  });
  attach("thread-short-snapshot");
  await startTurn(delivery, "thread-short-snapshot", "turn-short-snapshot");

  await sendDelta(delivery, {
    threadId: "thread-short-snapshot",
    turnId: "turn-short-snapshot",
    itemId: "final-1",
    text: "先说。",
  });
  await sendDelta(delivery, {
    threadId: "thread-short-snapshot",
    turnId: "turn-short-snapshot",
    itemId: "final-1",
    text: "先说完整。",
    fragmentKind: "snapshot",
  });
  await sleep(20);

  assert.deepEqual(sent, [
    { text: "先说。", preserveBlock: true },
    { text: "完整。", preserveBlock: true },
  ]);
});

test("stream mode only emits brief natural-language commentary in real time", async () => {
  const { delivery, sent, attach } = createDelivery();
  attach("thread-commentary");
  await startTurn(delivery, "thread-commentary", "turn-commentary");

  await sendDelta(delivery, {
    threadId: "thread-commentary",
    turnId: "turn-commentary",
    itemId: "commentary-1",
    text: "我先去抓日志。",
    phase: "commentary",
  });
  await sendDelta(delivery, {
    threadId: "thread-commentary",
    turnId: "turn-commentary",
    itemId: "commentary-2",
    text: "先列两点：\n1. 第一处怀疑点\n2. 第二处怀疑点",
    phase: "commentary",
  });
  await sendDelta(delivery, {
    threadId: "thread-commentary",
    turnId: "turn-commentary",
    itemId: "commentary-3",
    text: "```js\nconsole.log('still thinking')\n```",
    phase: "commentary",
  });

  assert.deepEqual(sent, [
    { text: "我先去抓日志。", preserveBlock: true },
  ]);
});

test("stream mode keeps paragraph boundaries in final output", async () => {
  const { delivery, sent, attach } = createDelivery({
    streamForceFlushChars: 12,
    streamBoundaryFlushChars: 6,
  });
  attach("thread-paragraphs");
  await startTurn(delivery, "thread-paragraphs", "turn-paragraphs");

  await sendCompleted(delivery, {
    threadId: "thread-paragraphs",
    turnId: "turn-paragraphs",
    itemId: "final-1",
    text: "第一段。\n\n第二段。\n\n第三段。",
  });

  assert.deepEqual(sent, [
    { text: "第一段。\n\n第二段。\n\n第三段。", preserveBlock: true },
  ]);
});

test("watchdog late completion only sends the unseen tail in stream mode", async () => {
  const { delivery, sent, attach } = createDelivery();
  attach("thread-watchdog");
  await startTurn(delivery, "thread-watchdog", "turn-watchdog");

  await sendCompleted(delivery, {
    threadId: "thread-watchdog",
    turnId: "turn-watchdog",
    itemId: "commentary-1",
    text: "我先把已确认的范围告诉你。",
    phase: "commentary",
  });
  await sendDelta(delivery, {
    threadId: "thread-watchdog",
    turnId: "turn-watchdog",
    itemId: "final-1",
    text: "这一段还在等工具结果，",
    phase: "final",
  });

  await delivery.finalizeAbandonedTurn({
    threadId: "thread-watchdog",
    turnId: "turn-watchdog",
    trailingText: "【系统提示】\n这一轮回复没有正常收尾。",
  });

  await sendCompleted(delivery, {
    threadId: "thread-watchdog",
    turnId: "turn-watchdog",
    itemId: "final-1",
    text: "这一段还在等工具结果，现在结果已经回来，可以继续给你完整结论。",
    phase: "final",
  });
  await completeTurn(delivery, "thread-watchdog", "turn-watchdog");

  assert.deepEqual(sent, [
    { text: "我先把已确认的范围告诉你。", preserveBlock: true },
    { text: "这一段还在等工具结果，\n\n【系统提示】\n这一轮回复没有正常收尾。", preserveBlock: false },
    { text: "现在结果已经回来，可以继续给你完整结论。", preserveBlock: true },
  ]);
});

test("settled mode waits for turn completion and only sends the latest visible reply", async () => {
  const { delivery, sent, attach } = createDelivery({
    weixinReplyMode: "settled",
  });
  attach("thread-settled");
  await startTurn(delivery, "thread-settled", "turn-settled");

  await sendCompleted(delivery, {
    threadId: "thread-settled",
    turnId: "turn-settled",
    itemId: "commentary-1",
    text: "我先去查一下。",
    phase: "commentary",
  });
  await sendCompleted(delivery, {
    threadId: "thread-settled",
    turnId: "turn-settled",
    itemId: "final-1",
    text: "结论已经确认。",
    phase: "final",
  });
  assert.equal(sent.length, 0);

  await completeTurn(delivery, "thread-settled", "turn-settled");
  assert.deepEqual(sent, [
    { text: "结论已经确认。", preserveBlock: true },
  ]);
});

test("stream mode waits for a natural boundary before sending a final sentence", async () => {
  const { delivery, sent, attach } = createDelivery({
    streamIdleFlushMs: 5,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 6,
  });
  attach("thread-boundary");
  await startTurn(delivery, "thread-boundary", "turn-boundary");

  await sendDelta(delivery, {
    threadId: "thread-boundary",
    turnId: "turn-boundary",
    itemId: "final-1",
    text: "我先把今天 tracked repos 的提交时间线和你今天的日记对起来，再直接帮你收成一版能回看的时间",
    phase: "final",
  });
  await sleep(20);
  assert.deepEqual(sent, []);

  await sendDelta(delivery, {
    threadId: "thread-boundary",
    turnId: "turn-boundary",
    itemId: "final-1",
    text: "我先把今天 tracked repos 的提交时间线和你今天的日记对起来，再直接帮你收成一版能回看的时间线，不靠你自己回忆。",
    phase: "final",
  });
  await sleep(20);

  assert.deepEqual(sent, [
    {
      text: "我先把今天 tracked repos 的提交时间线和你今天的日记对起来，再直接帮你收成一版能回看的时间线，不靠你自己回忆。",
      preserveBlock: true,
    },
  ]);
});

test("persistent send failure abandons the run and reports delivery degradation", async () => {
  const degraded: DeliveryFailurePayload[] = [];
  const delivery = new StreamDelivery({
    weixinReplyMode: "stream",
    streamIdleFlushMs: 5,
    streamForceFlushChars: 6,
    streamBoundaryFlushChars: 6,
    channelAdapter: {
      describe() {
        return { id: "test-channel" };
      },
      getKnownContextTokens() {
        return {};
      },
      async getUpdates() {
        return { ret: 0, msgs: [] };
      },
      loadSyncBuffer() {
        return "";
      },
      async login() {},
      normalizeIncomingMessage(message) {
        return message;
      },
      printAccounts() {},
      resolveAccount() {
        return { accountId: "acct-1", baseUrl: "http://127.0.0.1" };
      },
      async sendFile() {
        return undefined;
      },
      async sendText() {
        throw new Error("sendMessage ret=-2 errcode= errmsg=");
      },
      async sendTyping() {
        return undefined;
      },
    },
    sessionStore: {
      buildBindingKey() {
        return "";
      },
      findBindingForThreadId(threadId) {
        return { bindingKey: `binding-${threadId}`, workspaceRoot: "" };
      },
      getActiveWorkspaceRoot() {
        return "";
      },
      getApprovalCommandAllowlistForWorkspace() {
        return [];
      },
      getBinding() {
        return null;
      },
      getCodexParamsForWorkspace() {
        return { model: "" };
      },
      getPendingApprovalForThread() {
        return null;
      },
      getThreadIdForWorkspace() {
        return "";
      },
      listBindings() {
        return [];
      },
      listPendingApprovals() {
        return [];
      },
      rememberPendingApprovalForThread() {
        return null;
      },
      rememberWorkspaceBootstrapForThread() {},
    },
    onDeliveryFailure(payload: DeliveryFailurePayload) {
      degraded.push(payload);
    },
  });

  delivery.queueReplyTargetForThread("thread-fail", {
    userId: "user-thread-fail",
    contextToken: "ctx-thread-fail",
    provider: "weixin",
  });

  await startTurn(delivery, "thread-fail", "turn-fail");
  await sendDelta(delivery, {
    threadId: "thread-fail",
    turnId: "turn-fail",
    itemId: "final-1",
    text: "这条会失败。",
    phase: "final",
  });
  await sleep(20);

  assert.equal(degraded.length, 1);
  const firstDegraded = degraded[0];
  assert.ok(firstDegraded);
  assert.equal(firstDegraded.threadId, "thread-fail");
});
