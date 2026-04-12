const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  createFlushScheduler,
}: {
  createFlushScheduler: (options: {
    flushNow(state: RunState, options: FlushCall): Promise<void>;
    runtimeEventTypes: typeof RUNTIME_EVENT_TYPES;
    streamIdleFlushMs: number;
    streamForceFlushChars: number;
    streamBoundaryFlushChars: number;
  }) => {
    clearScheduledFlush(state: RunState): void;
    flush(state: RunState, options: FlushCall): Promise<void>;
    scheduleStreamingFlush(
      state: RunState,
      options?: {
        force?: boolean;
        trigger?: StreamingTrigger | null;
      },
    ): void;
    serializeSend(state: RunState, sendOperation: () => Promise<void>): Promise<void>;
  };
} = require("../src/core/stream-delivery/flush-scheduler");
const {
  createRunState,
  upsertStateItem,
}: {
  createRunState(args: { threadId: string; turnId?: string; weixinReplyMode: string }): RunState;
  upsertStateItem(
    state: RunState,
    item: {
      itemId: string;
      text: string;
      completed: boolean;
      phase: string;
      fragmentKind: string;
    },
  ): void;
} = require("../src/core/stream-delivery/run-state");

const RUNTIME_EVENT_TYPES = {
  REPLY_COMPLETED: "runtime.reply.completed",
  TURN_COMPLETED: "runtime.turn.completed",
} as const;

interface StreamingTrigger {
  source?: string;
  itemId?: string;
  phase?: string;
  fragmentKind?: string;
}

interface RunState {
  replyTarget: {
    userId: string;
    contextToken: string;
    provider: string;
  } | null;
  scheduledFlushTimer: NodeJS.Timeout | null;
  flushPromise: Promise<void> | null;
  sendChain: Promise<void>;
}

interface FlushCall {
  force?: boolean;
  trigger?: StreamingTrigger | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createStreamingState({
  threadId = "thread-1",
  turnId = "turn-1",
}: {
  threadId?: string;
  turnId?: string;
} = {}): RunState {
  const state = createRunState({
    threadId,
    turnId,
    weixinReplyMode: "stream",
  });
  state.replyTarget = {
    userId: `user-${threadId}`,
    contextToken: `ctx-${threadId}`,
    provider: "weixin",
  };
  return state;
}

test("flush scheduler only keeps idle timers for commentary-style streaming updates", async () => {
  const flushCalls: FlushCall[] = [];
  const scheduler = createFlushScheduler({
    flushNow: async (_state: RunState, options: FlushCall) => {
      flushCalls.push(options);
    },
    runtimeEventTypes: RUNTIME_EVENT_TYPES,
    streamIdleFlushMs: 5,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 100,
  });
  const state = createStreamingState();
  upsertStateItem(state, {
    itemId: "commentary-1",
    text: "我先去抓日志",
    completed: false,
    phase: "commentary",
    fragmentKind: "delta",
  });

  scheduler.scheduleStreamingFlush(state, {
    trigger: {
      source: "runtime.reply.delta",
      itemId: "commentary-1",
      phase: "commentary",
      fragmentKind: "delta",
    },
  });
  const firstTimer = state.scheduledFlushTimer;
  scheduler.scheduleStreamingFlush(state, {
    trigger: {
      source: "runtime.reply.delta",
      itemId: "commentary-1",
      phase: "commentary",
      fragmentKind: "delta",
    },
  });

  assert.equal(flushCalls.length, 0);
  assert.ok(firstTimer);
  assert.equal(state.scheduledFlushTimer, firstTimer);

  await sleep(20);

  assert.equal(flushCalls.length, 1);
  assert.equal(flushCalls[0].trigger?.source, "scheduled_stream_flush");
  assert.equal(state.scheduledFlushTimer, null);
});

test("flush scheduler skips idle timers for unfinished final fragments", async () => {
  const flushCalls: FlushCall[] = [];
  const scheduler = createFlushScheduler({
    flushNow: async (_state: RunState, options: FlushCall) => {
      flushCalls.push(options);
    },
    runtimeEventTypes: RUNTIME_EVENT_TYPES,
    streamIdleFlushMs: 5,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 100,
  });
  const state = createStreamingState({ threadId: "thread-no-idle-final" });
  upsertStateItem(state, {
    itemId: "final-1",
    text: "还在查",
    completed: false,
    phase: "final",
    fragmentKind: "delta",
  });

  scheduler.scheduleStreamingFlush(state, {
    trigger: {
      source: "runtime.reply.delta",
      itemId: "final-1",
      phase: "final",
      fragmentKind: "delta",
    },
  });

  await sleep(20);

  assert.equal(flushCalls.length, 0);
  assert.equal(state.scheduledFlushTimer, null);
});

test("flush scheduler triggers immediate boundary flush without leaving an idle timer behind", async () => {
  const flushCalls: FlushCall[] = [];
  const scheduler = createFlushScheduler({
    flushNow: async (_state: RunState, options: FlushCall) => {
      flushCalls.push(options);
    },
    runtimeEventTypes: RUNTIME_EVENT_TYPES,
    streamIdleFlushMs: 50,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 1,
  });
  const state = createStreamingState({ threadId: "thread-boundary" });
  upsertStateItem(state, {
    itemId: "final-1",
    text: "第一句。",
    completed: false,
    phase: "final",
    fragmentKind: "delta",
  });

  scheduler.scheduleStreamingFlush(state, {
    trigger: {
      source: "runtime.reply.delta",
      itemId: "final-1",
      phase: "final",
      fragmentKind: "delta",
    },
  });
  await nextTick();

  assert.equal(flushCalls.length, 1);
  assert.equal(flushCalls[0].trigger?.source, "runtime.reply.delta");
  assert.equal(state.scheduledFlushTimer, null);
});

test("flush scheduler clears an existing idle timer before a force flush", async () => {
  const flushCalls: FlushCall[] = [];
  const scheduler = createFlushScheduler({
    flushNow: async (_state: RunState, options: FlushCall) => {
      flushCalls.push(options);
    },
    runtimeEventTypes: RUNTIME_EVENT_TYPES,
    streamIdleFlushMs: 20,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 100,
  });
  const state = createStreamingState({ threadId: "thread-force" });
  upsertStateItem(state, {
    itemId: "commentary-1",
    text: "我先去抓日志",
    completed: false,
    phase: "commentary",
    fragmentKind: "delta",
  });

  scheduler.scheduleStreamingFlush(state, {
    trigger: {
      source: "runtime.reply.delta",
      itemId: "commentary-1",
      phase: "commentary",
      fragmentKind: "delta",
    },
  });
  assert.ok(state.scheduledFlushTimer);

  scheduler.scheduleStreamingFlush(state, {
    force: true,
    trigger: {
      source: "finishTurn",
      itemId: "final-1",
      fragmentKind: "completed_snapshot",
    },
  });
  await sleep(30);

  assert.equal(flushCalls.length, 1);
  assert.equal(flushCalls[0].force, true);
  assert.equal(state.scheduledFlushTimer, null);
});

test("flush scheduler serializes flush calls through flushPromise", async () => {
  const order: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let callIndex = 0;
  const scheduler = createFlushScheduler({
    flushNow: async () => {
      callIndex += 1;
      order.push(`start-${callIndex}`);
      if (callIndex === 1) {
        await firstGate;
      }
      order.push(`end-${callIndex}`);
    },
    runtimeEventTypes: RUNTIME_EVENT_TYPES,
    streamIdleFlushMs: 5,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 100,
  });
  const state = createStreamingState({ threadId: "thread-flush-queue" });

  const first = scheduler.flush(state, { force: false, trigger: null });
  const second = scheduler.flush(state, { force: true, trigger: { source: "finishTurn" } });
  await nextTick();

  assert.deepEqual(order, ["start-1"]);

  releaseFirst();
  await first;
  await second;

  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  assert.equal(state.flushPromise, null);
});

test("flush scheduler serializes sends and keeps later sends alive after a failure", async () => {
  const scheduler = createFlushScheduler({
    flushNow: async () => {},
    runtimeEventTypes: RUNTIME_EVENT_TYPES,
    streamIdleFlushMs: 5,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 100,
  });
  const state = createStreamingState({ threadId: "thread-send-chain" });
  const order: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = scheduler.serializeSend(state, async () => {
    order.push("send-1-start");
    await firstGate;
    order.push("send-1-end");
  });
  const second = scheduler.serializeSend(state, async () => {
    order.push("send-2-start");
    throw new Error("boom");
  });
  const third = scheduler.serializeSend(state, async () => {
    order.push("send-3-start");
    order.push("send-3-end");
  });
  await nextTick();

  assert.deepEqual(order, ["send-1-start"]);

  releaseFirst();
  await first;
  await assert.rejects(second, /boom/u);
  await third;

  assert.deepEqual(order, [
    "send-1-start",
    "send-1-end",
    "send-2-start",
    "send-3-start",
    "send-3-end",
  ]);
});

test("flush scheduler clearScheduledFlush cancels pending idle work", async () => {
  const flushCalls: FlushCall[] = [];
  const scheduler = createFlushScheduler({
    flushNow: async (_state: RunState, options: FlushCall) => {
      flushCalls.push(options);
    },
    runtimeEventTypes: RUNTIME_EVENT_TYPES,
    streamIdleFlushMs: 5,
    streamForceFlushChars: 100,
    streamBoundaryFlushChars: 100,
  });
  const state = createStreamingState({ threadId: "thread-clear" });
  upsertStateItem(state, {
    itemId: "commentary-1",
    text: "我先去抓日志",
    completed: false,
    phase: "commentary",
    fragmentKind: "delta",
  });

  scheduler.scheduleStreamingFlush(state, {
    trigger: {
      source: "runtime.reply.delta",
      itemId: "commentary-1",
      phase: "commentary",
      fragmentKind: "delta",
    },
  });
  scheduler.clearScheduledFlush(state);

  await sleep(20);

  assert.equal(flushCalls.length, 0);
  assert.equal(state.scheduledFlushTimer, null);
});
