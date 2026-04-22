const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

import type { ChannelAdapterLike, SessionStoreLike } from "../src/core/app-service-contract";
import type { DeliveryFailurePayload } from "../src/core/runtime-types";
const { StreamDelivery }: typeof import("../src/runtime/stream-delivery") = require("../src/runtime/stream-delivery");
const {
  finalizeAbandonedStreamTurn,
  finishStreamTurn,
}: typeof import("../src/runtime/stream-delivery/turn-finalize") = require("../src/runtime/stream-delivery/turn-finalize");
const {
  handleStreamDeliveryFailure,
}: typeof import("../src/runtime/stream-delivery/flush-executor") = require("../src/runtime/stream-delivery/flush-executor");
const {
  createRunState,
  upsertStateItem,
}: typeof import("../src/runtime/stream-delivery/run-state") = require("../src/runtime/stream-delivery/run-state");
const {
  advanceTimersAndMicrotasks,
  enableMockTimers,
}: typeof import("./helpers/mock-timers") = require("./helpers/mock-timers.ts");

type StreamDeliveryInstance = import("../src/runtime/stream-delivery").StreamDelivery;

interface SentMessage {
  text: string;
  preserveBlock: boolean | undefined;
}

interface CreateDeliveryOptions {
  weixinReplyMode?: unknown;
  deliveryTraceEnabled?: unknown;
  streamIdleFlushMs?: unknown;
  streamForceFlushChars?: unknown;
  streamBoundaryFlushChars?: unknown;
  channelOperations?: Partial<{
    visibleTextDelivery: boolean;
    visibleTypingDelivery: boolean;
    visibleFileDelivery: boolean;
  }>;
  sendTextImpl?: ((payload: { text: string; preserveBlock?: boolean }) => Promise<void>) | null;
  onDeliveryFailure?: ((payload: DeliveryFailurePayload) => Promise<void> | void) | null;
}

interface DeliveryHarness {
  delivery: StreamDeliveryInstance;
  sent: SentMessage[];
  attach(threadId: string): void;
}

function buildTestChannelDescriptor(
  id: string,
  overrides: Partial<{
    visibleTextDelivery: boolean;
    visibleTypingDelivery: boolean;
    visibleFileDelivery: boolean;
  }> = {},
) {
  return {
    id,
    kind: "channel" as const,
    provider: "test",
    operations: {
      pollUpdates: true,
      login: true,
      resolveAccount: true,
      visibleTextDelivery: overrides.visibleTextDelivery ?? true,
      visibleTypingDelivery: overrides.visibleTypingDelivery ?? true,
      visibleFileDelivery: overrides.visibleFileDelivery ?? true,
    },
  };
}

function createDelivery({
  weixinReplyMode = "stream",
  deliveryTraceEnabled = false,
  streamIdleFlushMs = 5,
  streamForceFlushChars = 12,
  streamBoundaryFlushChars = 6,
  channelOperations = {},
  sendTextImpl = null,
  onDeliveryFailure = null,
}: CreateDeliveryOptions = {}): DeliveryHarness {
  const sent: SentMessage[] = [];
  const channelAdapter: ChannelAdapterLike = {
    describe() {
      return buildTestChannelDescriptor("test-channel", channelOperations);
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
      return message as import("../src/core/runtime-types").NormalizedIncomingMessage | null;
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
    getAvailableModelCatalog() {
      return null;
    },
    getBinding() {
      return null;
    },
    getRuntimeParamsForWorkspace() {
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
  };
  const delivery = new StreamDelivery({
    weixinReplyMode,
    deliveryTraceEnabled,
    streamIdleFlushMs,
    streamForceFlushChars,
    streamBoundaryFlushChars,
    channelAdapter,
    sessionStore,
    onDeliveryFailure,
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

function buildFailingSendTextImpl(message: string): (payload: { text: string; preserveBlock?: boolean }) => Promise<void> {
  return async () => {
    throw new Error(message);
  };
}

async function advanceDelivery(
  context: import("node:test").TestContext,
  delivery: StreamDeliveryInstance,
  sent: SentMessage[],
  {
    ms = 0,
    expectedLength = sent.length,
  }: {
    ms?: number;
    expectedLength?: number;
  } = {},
): Promise<void> {
  await advanceTimersAndMicrotasks(context, ms);
  for (let index = 0; index < 32 && sent.length < expectedLength; index += 1) {
    const runStates = Array.from((
      delivery as StreamDeliveryInstance & {
        stateByRunKey: Map<string, { flushPromise: Promise<void> | null; sendChain: Promise<void> }>;
      }
    ).stateByRunKey.values());
    const pendingFlushes = runStates
      .map((state) => state.flushPromise)
      .filter((promise): promise is Promise<void> => Boolean(promise));
    if (pendingFlushes.length) {
      await Promise.all(pendingFlushes);
    }
    await Promise.all(runStates.map((state) => state.sendChain));
    if (sent.length >= expectedLength) {
      break;
    }
    await advanceTimersAndMicrotasks(context);
  }
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

function attachSystemFinalOnly(delivery: StreamDeliveryInstance, threadId: string): void {
  delivery.queueReplyTargetForThread(threadId, {
    userId: `user-${threadId}`,
    contextToken: `ctx-${threadId}`,
    provider: "system",
    deliveryPolicy: "final_only",
  } as never);
}

test("stream mode does not idle-flush unfinished final fragments", async (t) => {
  enableMockTimers(t);
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

  await advanceDelivery(t, delivery, sent, { ms: 20, expectedLength: 2 });
  assert.deepEqual(sent, []);
});

test("final-only system turns do not deliver commentary before final completion", async (t) => {
  enableMockTimers(t);
  const { delivery, sent } = createDelivery({
    streamForceFlushChars: 1,
    streamBoundaryFlushChars: 1,
  });
  attachSystemFinalOnly(delivery, "thread-system-final-only");
  await startTurn(delivery, "thread-system-final-only", "turn-system-final-only");

  await sendCompleted(delivery, {
    threadId: "thread-system-final-only",
    turnId: "turn-system-final-only",
    itemId: "commentary-1",
    text: "I am thinking through whether to stay silent.",
    phase: "commentary",
  });
  await advanceDelivery(t, delivery, sent, { ms: 20, expectedLength: 1 });
  assert.deepEqual(sent, []);

  await sendCompleted(delivery, {
    threadId: "thread-system-final-only",
    turnId: "turn-system-final-only",
    itemId: "final-1",
    text: "继续这条线吗？",
    phase: "final",
  });
  await completeTurn(delivery, "thread-system-final-only", "turn-system-final-only");
  await advanceDelivery(t, delivery, sent, { ms: 20, expectedLength: 1 });

  assert.deepEqual(sent, [
    { text: "继续这条线吗？", preserveBlock: true },
  ]);
});

test("final-only system turns suppress final SILENT without leaking earlier reasoning", async (t) => {
  enableMockTimers(t);
  const { delivery, sent } = createDelivery({
    streamForceFlushChars: 1,
    streamBoundaryFlushChars: 1,
  });
  attachSystemFinalOnly(delivery, "thread-system-silent");
  await startTurn(delivery, "thread-system-silent", "turn-system-silent");

  await sendCompleted(delivery, {
    threadId: "thread-system-silent",
    turnId: "turn-system-silent",
    itemId: "commentary-1",
    text: "I should probably stay quiet.",
    phase: "commentary",
  });
  await sendCompleted(delivery, {
    threadId: "thread-system-silent",
    turnId: "turn-system-silent",
    itemId: "final-1",
    text: "SILENT",
    phase: "final",
  });
  await completeTurn(delivery, "thread-system-silent", "turn-system-silent");
  await advanceDelivery(t, delivery, sent, { ms: 20, expectedLength: 1 });

  assert.deepEqual(sent, []);
});

test("stream mode streams final items incrementally and turn completion only sends the tail", async (t) => {
  enableMockTimers(t);
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
  await advanceDelivery(t, delivery, sent, { ms: 20, expectedLength: 2 });
  await completeTurn(delivery, "thread-final", "turn-final");
  await advanceTimersAndMicrotasks(t);

  assert.deepEqual(sent, [
    { text: "第一句。", preserveBlock: true },
    { text: "第二句。", preserveBlock: true },
  ]);
});

test("snapshot deltas replace the current item instead of concatenating duplicate prefixes", async (t) => {
  enableMockTimers(t);
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
  await advanceDelivery(t, delivery, sent, { ms: 20, expectedLength: 2 });

  assert.equal(sent.length, 2);
  assert.equal(sent[0]?.text, "先给你一个开头。");
  assert.equal(sent[0]?.preserveBlock, true);
  assert.equal(sent[1]?.text, "再补完整结论。");
  assert.equal(sent[1]?.preserveBlock, true);
});

test("completed snapshots continue from the unseen tail after a snapshot rewrite", async (t) => {
  enableMockTimers(t);
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
  await advanceDelivery(t, delivery, sent, { ms: 20, expectedLength: 2 });

  assert.deepEqual(sent, [
    { text: "第一段。", preserveBlock: true },
    { text: "第二段。\n\n第三段。", preserveBlock: true },
  ]);
});

test("short snapshot rewrites below the old 40-char gate still replace without duplication", async (t) => {
  enableMockTimers(t);
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
  await advanceDelivery(t, delivery, sent, { ms: 20, expectedLength: 2 });

  assert.equal(sent.length, 2);
  assert.equal(sent[0]?.text, "先说。");
  assert.equal(sent[0]?.preserveBlock, true);
  assert.equal(sent[1]?.text, "完整。");
  assert.equal(sent[1]?.preserveBlock, true);
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

test("stream mode idle-flush keeps split English commentary readable", async (t) => {
  enableMockTimers(t);
  const { delivery, sent, attach } = createDelivery({
    streamIdleFlushMs: 5,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 100,
  });
  attach("thread-commentary-english");
  await startTurn(delivery, "thread-commentary-english", "turn-commentary-english");

  await sendDelta(delivery, {
    threadId: "thread-commentary-english",
    turnId: "turn-commentary-english",
    itemId: "commentary-english-1",
    text: "I",
    phase: "commentary",
  });
  await sendDelta(delivery, {
    threadId: "thread-commentary-english",
    turnId: "turn-commentary-english",
    itemId: "commentary-english-1",
    text: "'m",
    phase: "commentary",
  });
  await sendDelta(delivery, {
    threadId: "thread-commentary-english",
    turnId: "turn-commentary-english",
    itemId: "commentary-english-1",
    text: " switching",
    phase: "commentary",
  });
  await sendDelta(delivery, {
    threadId: "thread-commentary-english",
    turnId: "turn-commentary-english",
    itemId: "commentary-english-1",
    text: " to",
    phase: "commentary",
  });
  await sendDelta(delivery, {
    threadId: "thread-commentary-english",
    turnId: "turn-commentary-english",
    itemId: "commentary-english-1",
    text: " English",
    phase: "commentary",
  });
  await sendDelta(delivery, {
    threadId: "thread-commentary-english",
    turnId: "turn-commentary-english",
    itemId: "commentary-english-1",
    text: " now.",
    phase: "commentary",
  });

  await advanceDelivery(t, delivery, sent, { ms: 20, expectedLength: 1 });

  assert.deepEqual(sent, [
    { text: "I'm switching to English now.", preserveBlock: true },
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

test("reply mode setter only affects future turns", async (t) => {
  enableMockTimers(t);
  const { delivery, sent, attach } = createDelivery({
    weixinReplyMode: "stream",
    streamIdleFlushMs: 5,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 1,
  });

  attach("thread-mode");
  await startTurn(delivery, "thread-mode", "turn-before");
  delivery.setWeixinReplyMode("settled");
  await sendDelta(delivery, {
    threadId: "thread-mode",
    turnId: "turn-before",
    itemId: "item-before",
    text: "第一句。",
  });
  await advanceDelivery(t, delivery, sent, { expectedLength: 1 });

  attach("thread-mode");
  await startTurn(delivery, "thread-mode", "turn-after");
  await sendDelta(delivery, {
    threadId: "thread-mode",
    turnId: "turn-after",
    itemId: "item-after",
    text: "第二句。",
  });
  await advanceDelivery(t, delivery, sent, { expectedLength: 1 });
  await completeTurn(delivery, "thread-mode", "turn-after");
  await advanceDelivery(t, delivery, sent, { expectedLength: 2 });

  assert.deepEqual(sent.map((item) => item.text), ["第一句。", "第二句。"]);
});

test("stream mode waits for a natural boundary before sending a final sentence", async (t) => {
  enableMockTimers(t);
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
  await advanceTimersAndMicrotasks(t, 20);
  assert.deepEqual(sent, []);

  await sendDelta(delivery, {
    threadId: "thread-boundary",
    turnId: "turn-boundary",
    itemId: "final-1",
    text: "我先把今天 tracked repos 的提交时间线和你今天的日记对起来，再直接帮你收成一版能回看的时间线，不靠你自己回忆。",
    phase: "final",
  });
  await advanceTimersAndMicrotasks(t, 20);

  assert.deepEqual(sent, [
    {
      text: "我先把今天 tracked repos 的提交时间线和你今天的日记对起来，再直接帮你收成一版能回看的时间线，不靠你自己回忆。",
      preserveBlock: true,
    },
  ]);
});

test("persistent send failure abandons the run and reports delivery degradation", async (t) => {
  enableMockTimers(t);
  const degraded: DeliveryFailurePayload[] = [];
  const { delivery, attach } = createDelivery({
    streamIdleFlushMs: 5,
    streamForceFlushChars: 6,
    streamBoundaryFlushChars: 6,
    sendTextImpl: buildFailingSendTextImpl("sendMessage ret=-2 errcode= errmsg="),
    onDeliveryFailure(payload: DeliveryFailurePayload) {
      degraded.push(payload);
    },
  });
  attach("thread-fail");

  await startTurn(delivery, "thread-fail", "turn-fail");
  await sendDelta(delivery, {
    threadId: "thread-fail",
    turnId: "turn-fail",
    itemId: "final-1",
    text: "这条会失败。",
    phase: "final",
  });
  await advanceTimersAndMicrotasks(t, 20);

  assert.equal(degraded.length, 1);
  const firstDegraded = degraded[0];
  assert.ok(firstDegraded);
  assert.equal(firstDegraded.threadId, "thread-fail");
});

test("unsupported visible text delivery abandons the run before calling sendText", async (t) => {
  enableMockTimers(t);
  const degraded: DeliveryFailurePayload[] = [];
  const sentPayloads: string[] = [];
  const { delivery, attach } = createDelivery({
    channelOperations: { visibleTextDelivery: false },
    sendTextImpl: async (payload) => {
      sentPayloads.push(payload.text);
    },
    onDeliveryFailure(payload) {
      degraded.push(payload);
    },
  });
  attach("thread-unsupported");

  await startTurn(delivery, "thread-unsupported", "turn-unsupported");
  await sendDelta(delivery, {
    threadId: "thread-unsupported",
    turnId: "turn-unsupported",
    itemId: "final-1",
    text: "这条不会真的发出去。",
    phase: "final",
  });
  await advanceTimersAndMicrotasks(t, 20);

  assert.deepEqual(sentPayloads, []);
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0]?.threadId, "thread-unsupported");
  assert.match(String(degraded[0]?.error || ""), /不支持可见文本回传/u);
});

test("stream delivery constructor and utility methods keep fallbacks idempotent", () => {
  const { delivery } = createDelivery({
    weixinReplyMode: "unexpected-mode",
    streamIdleFlushMs: Number.NaN,
    streamForceFlushChars: "not-a-number",
    streamBoundaryFlushChars: Number.POSITIVE_INFINITY,
  });

  assert.equal(delivery.weixinReplyMode, "stream");
  assert.equal(delivery.streamIdleFlushMs, 500);
  assert.equal(delivery.streamForceFlushChars, 100);
  assert.equal(delivery.streamBoundaryFlushChars, 30);

  delivery.disposeRunState("");
  delivery.disposeRunState("missing-run");
  assert.equal(delivery.stateByRunKey.size, 0);

  delivery.logDeliveryTrace("ignored", null);
});

test("delivery trace logging emits both success and failure records when enabled", () => {
  const { delivery } = createDelivery({
    deliveryTraceEnabled: true,
  });
  const logCalls: string[] = [];
  const errorCalls: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts: unknown[]) => {
    logCalls.push(parts.map(String).join(" "));
  };
  console.error = (...parts: unknown[]) => {
    errorCalls.push(parts.map(String).join(" "));
  };
  try {
    const payload = {
      traceId: "trace-1",
      threadId: "thread-trace",
      turnId: "",
      mode: "stream",
      force: false,
      trigger: "",
      relation: "",
      sentCharsBefore: 0,
      safeChars: 2,
      deltaChars: 2,
      deliveredVisibleBeforeChars: 0,
      deliveredVisibleAfterChars: 2,
      safeHash: "safehash",
      deltaHash: "deltahash",
    };
    delivery.logDeliveryTrace("success", payload);
    delivery.logDeliveryTrace("failure", payload, new Error("send failed"));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.equal(logCalls.length, 1);
  assert.match(logCalls[0] || "", /stage=success/u);
  assert.equal(errorCalls.length, 1);
  assert.match(errorCalls[0] || "", /send failed/u);
});

test("turn finalize helper creates a final item and disposes the pending run", async () => {
  const flushed: Array<{ force: boolean; itemId: string; source: string; text: string }> = [];
  const disposed: string[] = [];
  const stateByRunKey = new Map();
  const context = {
    stateByRunKey,
    weixinReplyMode: "stream" as const,
    attachReplyTarget(state: { replyTarget?: unknown }) {
      state.replyTarget = { provider: "weixin", userId: "user-final", contextToken: "ctx-final" };
      return state.replyTarget as never;
    },
    clearScheduledFlush() {},
    disposeRunState(runKey: unknown) {
      disposed.push(String(runKey || ""));
      stateByRunKey.delete(String(runKey || ""));
    },
    async flush(state: { itemOrder: string[]; items: Map<string, { currentText: string }> }, options: { force: boolean; trigger?: { itemId?: string; source?: string } | null }) {
      const itemId = options.trigger?.itemId || "";
      flushed.push({
        force: options.force,
        itemId,
        source: String(options.trigger?.source || ""),
        text: String(state.items.get(itemId)?.currentText || ""),
      });
    },
  };

  await finishStreamTurn(context, {
    threadId: "thread-finish",
    finalText: "最终答复。",
  });
  await finishStreamTurn(context, {
    threadId: "",
    finalText: "不会处理",
  });

  assert.deepEqual(flushed, [{
    force: true,
    itemId: "final",
    source: "finishTurn",
    text: "最终答复。",
  }]);
  assert.deepEqual(disposed, ["thread-finish:pending"]);
  assert.equal(stateByRunKey.size, 0);
});

test("turn finalize helper replaces existing items and marks abandoned turns", async () => {
  const flushed: Array<{ itemId: string; source: string }> = [];
  const cleared: string[] = [];
  const disposed: string[] = [];
  const stateByRunKey = new Map();
  const state = createRunState({
    threadId: "thread-existing",
    turnId: "",
    weixinReplyMode: "stream",
  });
  state.replyTarget = { provider: "weixin", userId: "user-existing", contextToken: "ctx-existing" };
  upsertStateItem(state, {
    itemId: "commentary-1",
    text: "我先看一下。",
    completed: true,
    phase: "commentary",
    fragmentKind: "completed_snapshot",
  });
  upsertStateItem(state, {
    itemId: "final-1",
    text: "旧结论。",
    completed: false,
    phase: "final",
    fragmentKind: "delta",
  });
  stateByRunKey.set(state.runKey, state);
  const context = {
    stateByRunKey,
    weixinReplyMode: "stream" as const,
    attachReplyTarget() {
      return state.replyTarget;
    },
    clearScheduledFlush(target: { runKey: string }) {
      cleared.push(target.runKey);
    },
    disposeRunState(runKey: unknown) {
      disposed.push(String(runKey || ""));
    },
    async flush(_state: unknown, options: { trigger?: { itemId?: string; source?: string } | null }) {
      flushed.push({
        itemId: String(options.trigger?.itemId || ""),
        source: String(options.trigger?.source || ""),
      });
    },
  };

  await finishStreamTurn(context, {
    threadId: "thread-existing",
    finalText: "新结论。",
  });
  assert.equal(state.items.get("final-1")?.currentText, "新结论。");
  assert.equal(state.items.get("commentary-1")?.completed, true);
  assert.equal(disposed.includes("thread-existing:pending"), true);

  await finalizeAbandonedStreamTurn(context, {
    threadId: "thread-existing",
    turnId: "",
    trailingText: "【系统提示】\n这轮没有正常收尾。",
  });
  assert.deepEqual(cleared, ["thread-existing:pending"]);
  assert.equal(state.items.has("__watchdog__"), false);
  assert.equal(state.abandonedAt > 0, true);
  assert.equal(flushed.at(-1)?.itemId, "__watchdog__");

  await finalizeAbandonedStreamTurn(context, {
    threadId: "thread-missing",
    turnId: "turn-missing",
    trailingText: "不会生成新状态",
  });
  assert.equal(stateByRunKey.has("thread-missing:turn-missing"), false);
});

test("delivery failure helper ignores missing run keys and tolerates callback failures", async () => {
  const ignoredRunKeys = new Set<string>();
  const disposed: string[] = [];
  const callbacks: DeliveryFailurePayload[] = [];
  const context = {
    ignoredRunKeys,
    disposeRunState(runKey: unknown) {
      disposed.push(String(runKey || ""));
    },
    async onDeliveryFailure(payload: DeliveryFailurePayload) {
      callbacks.push(payload);
      throw new Error("callback boom");
    },
  } as never;

  handleStreamDeliveryFailure(context, { runKey: "" } as never, new Error("ignored"));
  assert.deepEqual([...ignoredRunKeys], []);
  assert.deepEqual(disposed, []);

  handleStreamDeliveryFailure(context, {
    runKey: "thread-failure:turn-failure",
    threadId: "thread-failure",
    turnId: "turn-failure",
    bindingKey: "binding-failure",
    sentText: "already sent",
    replyTarget: { provider: "weixin", userId: "user", contextToken: "ctx" },
  } as never, new Error("send failed"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual([...ignoredRunKeys], ["thread-failure:turn-failure"]);
  assert.deepEqual(disposed, ["thread-failure:turn-failure"]);
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0]?.threadId, "thread-failure");
});
