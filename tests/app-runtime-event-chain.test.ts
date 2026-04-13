const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { CodekseiApp }: typeof import("../src/core/app") = require("../src/core/app");

type RuntimeEventListener = (event: Record<string, unknown>) => void;

test("runtime event chain keeps later events alive after an earlier handler failure", async () => {
  let runtimeEventListener: RuntimeEventListener | null = null;
  const appliedEvents: string[] = [];
  const observedEvents: string[] = [];
  const handledEvents: string[] = [];
  const loggedFailures: string[] = [];

  const originalConsoleError = console.error;
  console.error = (...parts: unknown[]) => {
    loggedFailures.push(parts.map((part) => String(part)).join(" "));
  };

  try {
    const app = new CodekseiApp({
      sharedBridgeHeartbeatFile: "",
      stateDir: "C:/tmp",
      workspaceRoot: "C:/workspace",
    } as never, {
      createAppServices() {
        return {
          backstageTaskLifecycle: {
            dispatchSystemMessage: async () => ({ status: "sent", reason: "" }),
            flushDueReminders: async () => undefined,
            flushPendingSystemMessages: async () => undefined,
            flushPendingTimelineScreenshots: async () => undefined,
          },
          channelAdapter: {
            describe: () => ({ id: "test-channel" }),
            getKnownContextTokens: () => ({}),
            loadSyncBuffer: () => "",
            normalizeIncomingMessage: (message: unknown) => message,
            printAccounts: () => undefined,
            resolveAccount: () => ({ accountId: "acct-1", baseUrl: "http://127.0.0.1" }),
          },
          channelCommandRouter: {
            maybeDispatchCommand: async () => false,
          },
          reminderQueue: {},
          runtimeAdapter: {
            close: async () => undefined,
            describe: () => ({ id: "test-runtime" }),
            getSessionStore: () => ({
              getActiveWorkspaceRoot: () => "",
              getBinding: () => null,
            }),
            initialize: async () => ({ endpoint: "ws://127.0.0.1", models: [] }),
            onEvent(listener: RuntimeEventListener) {
              runtimeEventListener = listener;
            },
          },
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
          runtimeTurnLifecycle: {
            handlePreparedMessage: async () => undefined,
            prepareIncomingMessageForRuntime: async () => undefined,
            sendLocalFileToCurrentChat: async () => undefined,
            sendPreparedMessageToRuntime: async () => ({ status: "sent" }),
            sendTimelineScreenshot: async () => undefined,
            withUserTyping: async (_payload: unknown, work: () => Promise<unknown>) => work(),
          },
          runtimeWatchdogLifecycle: {
            clearRuntimeEventWatchdog: () => undefined,
            clearTurnSettlementWatchdog: () => undefined,
            confirmPendingWorkspaceBootstrap: async () => undefined,
            handleRuntimeEvent: async (event: Record<string, unknown>) => {
              const eventId = String((event.payload as { id?: unknown })?.id || "");
              handledEvents.push(eventId);
              if (eventId === "first") {
                throw new Error("first event failed");
              }
            },
            observeRuntimeEvent: (event: Record<string, unknown>) => {
              observedEvents.push(String((event.payload as { id?: unknown })?.id || ""));
            },
            queuePendingWorkspaceBootstrap: () => undefined,
            refreshTurnSettlementWatchdog: () => undefined,
            restoreBoundThreadSubscriptions: async () => undefined,
            scheduleRuntimeEventWatchdog: () => undefined,
            sendApprovalPrompt: async () => undefined,
            sendFailureToThread: async () => undefined,
            stopTypingForThread: async () => undefined,
          },
          streamDelivery: {},
          systemMessageDispatcherState: { current: null },
          systemMessageQueue: {},
          threadStateStore: {
            applyRuntimeEvent(event: Record<string, unknown>) {
              appliedEvents.push(String((event.payload as { id?: unknown })?.id || ""));
            },
            snapshot: () => ({}),
          },
          timelineIntegration: {
            describe: () => ({ id: "test-timeline" }),
          },
          timelineScreenshotQueue: {},
        } as never;
      },
    });

    assert.ok(runtimeEventListener);
    const emitRuntimeEvent = runtimeEventListener as RuntimeEventListener;
    emitRuntimeEvent({ type: "turn/started", payload: { id: "first" } });
    emitRuntimeEvent({ type: "turn/completed", payload: { id: "second" } });

    await app.runtimeEventChain;

    assert.deepEqual(observedEvents, ["first", "second"]);
    assert.deepEqual(appliedEvents, ["first", "second"]);
    assert.deepEqual(handledEvents, ["first", "second"]);
    assert.equal(loggedFailures.some((entry) => entry.includes("first event failed")), true);
  } finally {
    console.error = originalConsoleError;
  }
});
