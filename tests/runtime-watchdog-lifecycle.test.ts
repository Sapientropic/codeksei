const { normalizeText }: typeof import("../src/core/text-normalization") = require("../src/core/text-normalization");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { RUNTIME_EVENT_TYPES }: typeof import("../src/contracts/runtime-events") = require("../src/contracts/runtime-events");
const { RuntimeWatchdogLifecycle }: typeof import("../src/runtime/runtime-watchdog-lifecycle") = require("../src/runtime/runtime-watchdog-lifecycle");
const { ThreadStateStore }: typeof import("../src/runtime/thread-state-store") = require("../src/runtime/thread-state-store");
const {
  advanceTimersAndMicrotasks,
  enableMockTimers,
}: typeof import("./helpers/mock-timers") = require("./helpers/mock-timers.ts");

function buildTestChannelDescriptor(overrides: Partial<{
  visibleTextDelivery: boolean;
  visibleTypingDelivery: boolean;
}> = {}) {
  return {
    id: "test-channel",
    kind: "channel" as const,
    provider: "test",
    operations: {
      pollUpdates: true,
      login: true,
      resolveAccount: true,
      visibleTextDelivery: overrides.visibleTextDelivery ?? true,
      visibleTypingDelivery: overrides.visibleTypingDelivery ?? true,
      visibleFileDelivery: true,
    },
  };
}

function buildTestRuntimeDescriptor(overrides: Partial<{
  resumeThread: boolean;
}> = {}) {
  return {
    id: "test-runtime",
    kind: "runtime" as const,
    provider: "test",
    operations: {
      initialize: true,
      interactiveTurn: true,
      refreshThreadInstructions: true,
      respondApproval: true,
      resumeThread: overrides.resumeThread ?? true,
      cancelTurn: true,
    },
  };
}

function createLifecycleHarness({
  channelOperations = {},
  runtimeOperations = {},
}: {
  channelOperations?: Partial<{
    visibleTextDelivery: boolean;
    visibleTypingDelivery: boolean;
  }>;
  runtimeOperations?: Partial<{
    resumeThread: boolean;
  }>;
} = {}) {
  const textCalls: string[] = [];
  const typingStops: number[] = [];
  const resumedThreads: string[] = [];
  const threadStateStore = new ThreadStateStore();
  const lifecycle = new RuntimeWatchdogLifecycle({
    buildApprovalPromptSignature() {
      return "";
    },
    buildApprovalPromptText() {
      return "";
    },
    channelAdapter: {
      describe() {
        return buildTestChannelDescriptor(channelOperations);
      },
      async sendText(payload: { text?: unknown }) {
        textCalls.push(String(payload.text || ""));
      },
      async sendTyping(payload: { status?: unknown }) {
        typingStops.push(Number(payload.status || 0));
      },
    } as never,
    matchesBuiltInCommandPrefix() {
      return false;
    },
    matchesCommandPrefix() {
      return false;
    },
    normalizeCommandArgument(value: unknown) {
      return typeof value === "string" ? value.trim() : "";
    },
    normalizeText,
    resolveReplyTargetForBinding() {
      return null;
    },
    runtimeAdapter: {
      describe() {
        return buildTestRuntimeDescriptor(runtimeOperations);
      },
      getSessionStore() {
        return {
          listBindings() {
            return [];
          },
          listPendingApprovals() {
            return [];
          },
          findBindingForThreadId() {
            return null;
          },
          getThreadIdForWorkspace() {
            return "";
          },
        };
      },
      async resumeThread(payload: { threadId: string; workspaceRoot?: string }) {
        resumedThreads.push(payload.threadId);
      },
    } as never,
    sessionWriter: {
      clearPendingApprovalForThread: async () => undefined,
      rememberApprovalPrefixForWorkspace: async () => [],
      rememberPendingApprovalForThread: async () => undefined,
      rememberWorkspaceBootstrapForThread: async () => undefined,
      setActiveWorkspaceRoot: async () => undefined,
      setRuntimeParamsForWorkspace: async () => undefined,
      setThreadIdForWorkspace: async () => undefined,
      clearThreadIdForWorkspace: async () => undefined,
    },
    streamDelivery: {} as never,
    streamSettlementTimeoutMs: 1_000,
    threadStateStore,
    firstRuntimeEventFailureTimeoutMs: 20,
    firstRuntimeEventNoticeTimeoutMs: 5,
  });

  return { lifecycle, resumedThreads, textCalls, threadStateStore, typingStops };
}

test("first-event watchdog still fires after an earlier turn left a stale turn id", async (t) => {
  enableMockTimers(t);
  const { lifecycle, textCalls, threadStateStore, typingStops } = createLifecycleHarness();

  threadStateStore.applyRuntimeEvent({
    type: RUNTIME_EVENT_TYPES.TURN_COMPLETED,
    payload: {
      threadId: "thread-current",
      turnId: "turn-old",
    },
  });

  lifecycle.scheduleRuntimeEventWatchdog({
    bindingKey: "binding-current",
    workspaceRoot: "E:/repo/current",
    threadId: "thread-current",
    normalized: {
      senderId: "user-1",
      contextToken: "ctx-1",
      provider: "weixin",
    } as never,
  });

  await advanceTimersAndMicrotasks(t, 40);

  assert.equal(textCalls.some((entry) => entry.includes("没有返回首个事件")), true);
  assert.equal(typingStops.includes(0), true);
});

test("usage telemetry does not clear the first-event watchdog", async (t) => {
  enableMockTimers(t);
  const { lifecycle, textCalls } = createLifecycleHarness();

  lifecycle.scheduleRuntimeEventWatchdog({
    bindingKey: "binding-current",
    workspaceRoot: "E:/repo/current",
    threadId: "thread-current",
    normalized: {
      senderId: "user-1",
      contextToken: "ctx-1",
      provider: "weixin",
    } as never,
  });
  lifecycle.observeRuntimeEvent({
    type: RUNTIME_EVENT_TYPES.USAGE_UPDATED,
    payload: {
      threadId: "thread-current",
    },
  } as never);

  await advanceTimersAndMicrotasks(t, 40);

  assert.equal(textCalls.some((entry) => entry.includes("没有返回首个事件")), true);
});

test("real first-progress events clear the first-event watchdog", () => {
  const variants = [
    RUNTIME_EVENT_TYPES.TURN_STARTED,
    RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED,
    RUNTIME_EVENT_TYPES.TURN_FAILED,
  ];

  for (const eventType of variants) {
    const { lifecycle } = createLifecycleHarness();
    lifecycle.scheduleRuntimeEventWatchdog({
      bindingKey: "binding-current",
      workspaceRoot: "E:/repo/current",
      threadId: "thread-current",
      normalized: {
        senderId: "user-1",
        contextToken: "ctx-1",
        provider: "weixin",
      } as never,
    });

    lifecycle.observeRuntimeEvent({
      type: eventType,
      payload: {
        threadId: "thread-current",
        turnId: "turn-current",
        requestId: "approval-1",
      },
    } as never);

    assert.equal(lifecycle.pendingRuntimeEventWatchdogs.size, 0, `${eventType} should clear the watchdog`);
  }
});

test("first-event watchdog skips visible recovery when the host cannot deliver text or typing", async (t) => {
  enableMockTimers(t);
  const { lifecycle, textCalls, typingStops } = createLifecycleHarness({
    channelOperations: {
      visibleTextDelivery: false,
      visibleTypingDelivery: false,
    },
  });

  lifecycle.scheduleRuntimeEventWatchdog({
    bindingKey: "binding-current",
    workspaceRoot: "E:/repo/current",
    threadId: "thread-current",
    normalized: {
      senderId: "user-1",
      contextToken: "ctx-1",
      provider: "weixin",
    } as never,
  });

  await advanceTimersAndMicrotasks(t, 40);

  assert.deepEqual(textCalls, []);
  assert.deepEqual(typingStops, []);
});

test("restoreBoundThreadSubscriptions skips runtime resume when the host descriptor marks it unsupported", async () => {
  const { lifecycle, resumedThreads } = createLifecycleHarness({
    runtimeOperations: { resumeThread: false },
  });

  await lifecycle.restoreBoundThreadSubscriptions();

  assert.deepEqual(resumedThreads, []);
});
