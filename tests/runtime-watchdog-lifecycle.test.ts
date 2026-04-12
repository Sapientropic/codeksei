const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { RUNTIME_EVENT_TYPES }: typeof import("../src/contracts/runtime-events") = require("../src/contracts/runtime-events");
const { RuntimeWatchdogLifecycle }: typeof import("../src/runtime/runtime-watchdog-lifecycle") = require("../src/runtime/runtime-watchdog-lifecycle");
const { ThreadStateStore }: typeof import("../src/runtime/thread-state-store") = require("../src/runtime/thread-state-store");

test("first-event watchdog still fires after an earlier turn left a stale turn id", async () => {
  const textCalls: string[] = [];
  const typingStops: number[] = [];
  const threadStateStore = new ThreadStateStore();

  threadStateStore.applyRuntimeEvent({
    type: RUNTIME_EVENT_TYPES.TURN_COMPLETED,
    payload: {
      threadId: "thread-current",
      turnId: "turn-old",
    },
  });

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
    normalizeText(value: unknown) {
      return typeof value === "string" ? value.trim() : "";
    },
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
    streamDelivery: {} as never,
    streamSettlementTimeoutMs: 1_000,
    threadStateStore,
    firstRuntimeEventFailureTimeoutMs: 20,
    firstRuntimeEventNoticeTimeoutMs: 5,
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
