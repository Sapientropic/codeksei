// @ts-nocheck
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { SessionStore } = require("../src/adapters/runtime/codex/session-store");
const { ThreadStateStore } = require("../src/core/thread-state-store");
const { createControlCommandHandlers } = require("../src/core/channel-command-control-handlers");
const { RuntimeWatchdogLifecycle } = require("../src/core/runtime-watchdog-lifecycle");

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
  const runtimeCalls = [];
  const textCalls = [];
  const handlers = createControlCommandHandlers({
    channelAdapter: {
      async sendText(payload) {
        textCalls.push(payload);
      },
    },
    resolveWorkspaceRoot() {
      return "E:/repo/current";
    },
    runtimeAdapter: {
      getSessionStore() {
        return sessionStore;
      },
      async respondApproval(payload) {
        runtimeCalls.push(payload);
      },
    },
    threadStateStore,
  });

  await handlers.approval({
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
  }, {
    name: "yes",
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
  const resumedThreads = [];
  const streamTargets = [];
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
    },
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
    resolveReplyTargetForBinding(candidateBindingKey) {
      if (candidateBindingKey === bindingKey) {
        return {
          userId: "user-1",
          contextToken: "ctx-1",
        };
      }
      return null;
    },
    runtimeAdapter: {
      getSessionStore() {
        return sessionStore;
      },
      async resumeThread({ threadId }) {
        resumedThreads.push(threadId);
      },
    },
    streamDelivery: {
      setReplyTarget(bindingKeyValue, target) {
        streamTargets.push({ bindingKey: bindingKeyValue, target });
      },
    },
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
