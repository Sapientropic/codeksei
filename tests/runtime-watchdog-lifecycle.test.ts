const { normalizeText }: typeof import("../src/core/text-normalization") = require("../src/core/text-normalization");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { RUNTIME_EVENT_TYPES }: typeof import("../src/contracts/runtime-events") = require("../src/contracts/runtime-events");
const { RuntimeWatchdogLifecycle }: typeof import("../src/runtime/runtime-watchdog-lifecycle") = require("../src/runtime/runtime-watchdog-lifecycle");
const { ThreadStateStore }: typeof import("../src/runtime/thread-state-store") = require("../src/runtime/thread-state-store");

function createLifecycleHarness() {
  const textCalls: string[] = [];
  const typingStops: number[] = [];
  const threadStateStore = new ThreadStateStore();
  const lifecycle = new RuntimeWatchdogLifecycle({
    buildApprovalPromptSignature() {
      return "";
    },
    buildApprovalPromptText() {
      return "";
    },
    channelAdapter: {
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
      getSessionStore() {
        return {
          getThreadIdForWorkspace() {
            return "";
          },
        };
      },
    } as never,
    sessionWriter: {
      clearPendingApprovalForThread: async () => undefined,
      rememberApprovalPrefixForWorkspace: async () => [],
      rememberPendingApprovalForThread: async () => undefined,
      rememberWorkspaceBootstrapForThread: async () => undefined,
      setActiveWorkspaceRoot: async () => undefined,
      setCodexParamsForWorkspace: async () => undefined,
      setThreadIdForWorkspace: async () => undefined,
      clearThreadIdForWorkspace: async () => undefined,
    },
    streamDelivery: {} as never,
    streamSettlementTimeoutMs: 1_000,
    threadStateStore,
    firstRuntimeEventFailureTimeoutMs: 20,
    firstRuntimeEventNoticeTimeoutMs: 5,
  });

  return { lifecycle, textCalls, threadStateStore, typingStops };
}

test("first-event watchdog still fires after an earlier turn left a stale turn id", async () => {
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

  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(textCalls.some((entry) => entry.includes("没有返回首个事件")), true);
  assert.equal(typingStops.includes(0), true);
});

test("usage telemetry does not clear the first-event watchdog", async () => {
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

  await new Promise((resolve) => setTimeout(resolve, 40));

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
