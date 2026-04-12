const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { SessionStore }: typeof import("../src/adapters/runtime/codex/session-store") = require("../src/adapters/runtime/codex/session-store");
const { ThreadStateStore }: typeof import("../src/runtime/thread-state-store") = require("../src/runtime/thread-state-store");
const { createControlCommandHandlers }: typeof import("../src/core/channel-command-control-handlers") = require("../src/core/channel-command-control-handlers");
const { RuntimeWatchdogLifecycle }: typeof import("../src/runtime/runtime-watchdog-lifecycle") = require("../src/runtime/runtime-watchdog-lifecycle");
import type {
  ChannelAdapterLike,
  RuntimeAdapterLike,
  StreamDeliveryLike,
} from "../src/core/app-service-contract";

function createSessionStoreFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-approval-"));
  const filePath = path.join(tempRoot, "sessions.json");
  const sessionStore = new SessionStore({ filePath });
  const bindingKey = sessionStore.buildBindingKey({
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
  });
  sessionStore.setThreadIdForWorkspace(bindingKey, "E:/repo/current", "thread-current", {
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
  });
  sessionStore.rememberPendingApprovalForThread("thread-current", {
    requestId: "approval-1",
    reason: "Need shell",
    command: "npm run review:weekly",
    commandTokens: ["npm", "run", "review:weekly"],
  }, {
    signature: "sig-1",
    promptedAt: "2026-04-12T00:00:00.000Z",
  });
  return { bindingKey, sessionStore };
}

test("approval commands still resolve persisted pending approval after a restart", async () => {
  const { sessionStore } = createSessionStoreFixture();
  const threadStateStore = new ThreadStateStore();
  const runtimeCalls: Array<{ requestId: string; decision: "accept" | "decline" }> = [];
  const textCalls: Array<{ text: string }> = [];
  const handlers = createControlCommandHandlers({
    channelAdapter: {
      async sendText(payload: { text?: unknown }) {
        textCalls.push({ text: String(payload.text || "") });
      },
    },
    resolveWorkspaceRoot() {
      return "E:/repo/current";
    },
    runtimeAdapter: {
      getSessionStore() {
        return sessionStore;
      },
      async respondApproval(payload: { requestId: string; decision: "accept" | "decline" }) {
        runtimeCalls.push(payload);
      },
    },
    threadStateStore,
  });

  await handlers.approval({
    provider: "weixin",
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text: "/yes",
  }, {
    name: "yes",
    args: "",
  });

  assert.deepEqual(runtimeCalls, [{
    requestId: "approval-1",
    decision: "accept",
  }]);
  assert.equal(sessionStore.getPendingApprovalForThread("thread-current"), null);
  assert.match(textCalls[textCalls.length - 1].text, /已允许本次请求/u);
});

test("restoreBoundThreadSubscriptions rehydrates persisted approval into thread runtime state", async () => {
  const { bindingKey, sessionStore } = createSessionStoreFixture();
  const threadStateStore = new ThreadStateStore();
  const resumedThreads: string[] = [];
  const streamTargets: Array<{ bindingKey: string; target: unknown }> = [];
  const lifecycle = new RuntimeWatchdogLifecycle({
    buildApprovalPromptSignature() {
      return "";
    },
    buildApprovalPromptText() {
      return "";
    },
    channelAdapter: {
      sendText() {
        return Promise.resolve();
      },
      sendTyping() {
        return Promise.resolve();
      },
    } as unknown as ChannelAdapterLike,
    matchesBuiltInCommandPrefix() {
      return false;
    },
    matchesCommandPrefix() {
      return false;
    },
    normalizeCommandArgument(value) {
      return typeof value === "string" ? value.trim() : "";
    },
    normalizeText(value) {
      return typeof value === "string" ? value.trim() : "";
    },
    resolveReplyTargetForBinding(candidateBindingKey: string) {
      if (candidateBindingKey === bindingKey) {
        return {
          userId: "user-1",
          contextToken: "ctx-1",
          provider: "weixin",
        };
      }
      return null;
    },
    runtimeAdapter: {
      getSessionStore() {
        return sessionStore;
      },
      async resumeThread({ threadId }: { threadId: string }) {
        resumedThreads.push(threadId);
      },
    } as unknown as RuntimeAdapterLike,
    streamDelivery: {
      setReplyTarget(bindingKeyValue: string, target: unknown) {
        streamTargets.push({ bindingKey: bindingKeyValue, target });
      },
    } as unknown as StreamDeliveryLike,
    streamSettlementTimeoutMs: 1000,
    threadStateStore,
    firstRuntimeEventFailureTimeoutMs: 1000,
    firstRuntimeEventNoticeTimeoutMs: 1000,
  });

  await lifecycle.restoreBoundThreadSubscriptions();

  assert.deepEqual(resumedThreads, ["thread-current"]);
  assert.equal(streamTargets.length, 1);
  assert.deepEqual(threadStateStore.getThreadState("thread-current")?.pendingApproval, {
    threadId: "thread-current",
    requestId: "approval-1",
    reason: "Need shell",
    command: "npm run review:weekly",
    commandTokens: ["npm", "run", "review:weekly"],
    signature: "sig-1",
    promptedAt: "2026-04-12T00:00:00.000Z",
  });
});
