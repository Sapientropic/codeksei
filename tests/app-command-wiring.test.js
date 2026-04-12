const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repoRoot = path.resolve(__dirname, "..");
const appModulePath = path.resolve(repoRoot, "src/core/app.js");

function resolveRepoModule(relativePath) {
  return require.resolve(path.resolve(repoRoot, relativePath));
}

function stubModule(relativePath, exports, originals) {
  const resolved = resolveRepoModule(relativePath);
  originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

function restoreModules(originals) {
  for (const [resolved, original] of originals.entries()) {
    if (original) {
      require.cache[resolved] = original;
    } else {
      delete require.cache[resolved];
    }
  }
}

function createAppHarness({
  sendTextTurnImpl = async () => ({ threadId: "thread-1", workspaceBootstrapPending: false }),
} = {}) {
  const originals = new Map();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-app-command-"));
  const sendTextTurnCalls = [];
  const textCalls = [];
  const sessionStore = {
    buildBindingKey({ workspaceId, accountId, senderId }) {
      return `${workspaceId}:${accountId}:${senderId}`;
    },
    getCodexParamsForWorkspace() {
      return { model: "" };
    },
    getActiveWorkspaceRoot() {
      return "";
    },
    getThreadIdForWorkspace() {
      return "";
    },
    findBindingForThreadId() {
      return null;
    },
    listBindings() {
      return [];
    },
  };

  const channelAdapter = {
    getKnownContextTokens() {
      return { "user-1": "ctx-1" };
    },
    sendTyping() {
      return Promise.resolve();
    },
    sendText(payload) {
      textCalls.push(payload);
      return Promise.resolve();
    },
    sendFile() {
      return Promise.resolve();
    },
    normalizeIncomingMessage(message) {
      return message;
    },
    resolveAccount() {
      return { accountId: "acct-1" };
    },
    describe() {
      return {};
    },
    close() {
      return Promise.resolve();
    },
  };

  const runtimeAdapter = {
    getSessionStore() {
      return sessionStore;
    },
    onEvent() {},
    sendTextTurn(payload) {
      sendTextTurnCalls.push(payload);
      return Promise.resolve().then(() => sendTextTurnImpl(payload));
    },
    describe() {
      return {};
    },
    close() {
      return Promise.resolve();
    },
  };

  stubModule("src/adapters/channel/weixin/index.js", {
    createWeixinChannelAdapter() {
      return channelAdapter;
    },
  }, originals);
  stubModule("src/adapters/channel/weixin/media-receive.js", {
    async persistIncomingWeixinAttachments() {
      return { saved: [], failed: [] };
    },
  }, originals);
  stubModule("src/adapters/runtime/codex/index.js", {
    createCodexRuntimeAdapter() {
      return runtimeAdapter;
    },
  }, originals);
  stubModule("src/integrations/timeline/index.js", {
    createTimelineIntegration() {
      return {
        async runSubcommand() {},
        describe() {
          return {};
        },
      };
    },
  }, originals);
  stubModule("src/core/stream-delivery.js", {
    StreamDelivery: class StreamDelivery {
      setReplyTarget() {}
      queueReplyTargetForThread() {}
      close() {}
    },
  }, originals);
  stubModule("src/core/thread-state-store.js", {
    ThreadStateStore: class ThreadStateStore {
      applyRuntimeEvent() {}
      getThreadState() {
        return null;
      }
      getLatestUsage() {
        return null;
      }
      snapshot() {
        return {};
      }
    },
  }, originals);
  stubModule("src/core/system-message-queue-store.js", {
    SystemMessageQueueStore: class SystemMessageQueueStore {
      constructor() {}
      hasPendingForAccount() {
        return false;
      }
    },
  }, originals);
  stubModule("src/core/system-message-dispatcher.js", {
    SystemMessageDispatcher: class SystemMessageDispatcher {},
  }, originals);
  stubModule("src/core/timeline-screenshot-queue-store.js", {
    TimelineScreenshotQueueStore: class TimelineScreenshotQueueStore {
      constructor() {}
      hasPendingForAccount() {
        return false;
      }
    },
  }, originals);
  stubModule("src/core/shared-bridge-heartbeat.js", {
    writeSharedBridgeHeartbeat() {},
  }, originals);
  stubModule("src/adapters/channel/weixin/reminder-queue-store.js", {
    ReminderQueueStore: class ReminderQueueStore {
      constructor() {}
      peekNextDueAtMs() {
        return 0;
      }
    },
  }, originals);
  stubModule("src/app/system-checkin-poller.js", {
    async runSystemCheckinPoller() {},
  }, originals);

  originals.set(appModulePath, require.cache[appModulePath]);
  delete require.cache[appModulePath];
  const { CyberbossApp } = require(appModulePath);

  const app = new CyberbossApp({
    stateDir: tempRoot,
    workspaceRoot: path.join(tempRoot, "workspace"),
    workspaceId: "workspace-1",
    codexAccessMode: "",
    weixinReplyMode: "stream",
    weixinDeliveryTrace: false,
    systemMessageQueueFile: path.join(tempRoot, "system-message-queue.json"),
    systemMessageDeadLetterFile: path.join(tempRoot, "system-message-dead-letter.json"),
    timelineScreenshotQueueFile: path.join(tempRoot, "timeline-screenshot-queue.json"),
    reminderQueueFile: path.join(tempRoot, "reminder-queue.json"),
  });
  app.runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog = () => {};
  app.runtimeWatchdogLifecycle.queuePendingWorkspaceBootstrap = () => {};

  return {
    app,
    restore() {
      delete require.cache[appModulePath];
      restoreModules(originals);
    },
    sendTextTurnCalls,
    textCalls,
  };
}

function buildIncomingMessage(text) {
  return {
    provider: "wechat",
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    messageId: "msg-1",
    receivedAt: "2026-04-12T12:00:00.000Z",
    text,
    attachments: [],
  };
}

test("handlePreparedMessage lets the command router intercept slash commands", async () => {
  const harness = createAppHarness();
  const routerCalls = [];
  harness.app.channelCommandRouter.maybeDispatchCommand = async (normalized) => {
    routerCalls.push(normalized.text);
    return true;
  };
  harness.app.runtimeTurnLifecycle.prepareIncomingMessageForRuntime = async () => {
    throw new Error("should not prepare");
  };

  try {
    const result = await harness.app.handlePreparedMessage(buildIncomingMessage("/help"), {
      allowCommands: true,
    });

    assert.equal(result, undefined);
    assert.deepEqual(routerCalls, ["/help"]);
    assert.deepEqual(harness.sendTextTurnCalls, []);
  } finally {
    harness.restore();
  }
});

test("handlePreparedMessage still sends ordinary messages through the runtime when router returns false", async () => {
  const harness = createAppHarness();
  let routerCalls = 0;
  harness.app.channelCommandRouter.maybeDispatchCommand = async () => {
    routerCalls += 1;
    return false;
  };
  harness.app.runtimeTurnLifecycle.prepareIncomingMessageForRuntime = async (normalized) => ({
    ...normalized,
    text: "prepared message",
  });

  try {
    const result = await harness.app.handlePreparedMessage(buildIncomingMessage("hello"), {
      allowCommands: true,
    });

    assert.equal(routerCalls, 1);
    assert.equal(result.status, "sent");
    assert.equal(harness.sendTextTurnCalls.length, 1);
  } finally {
    harness.restore();
  }
});
