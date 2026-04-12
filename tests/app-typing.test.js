const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  repoRoot,
  resolveRepoRuntimeModule,
  resolveRepoRuntimePath,
} = require("./helpers/runtime-paths");
const appModulePath = resolveRepoRuntimePath("src/core/app.js");

function resolveRepoModule(relativePath) {
  return resolveRepoRuntimeModule(relativePath);
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
  sendFileImpl = async () => ({ kind: "file" }),
  sendTextTurnImpl = async () => ({ threadId: "thread-1", workspaceBootstrapPending: false }),
  runTimelineSubcommandImpl = async () => undefined,
} = {}) {
  const originals = new Map();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-app-typing-"));
  const typingCalls = [];
  const textCalls = [];
  const fileCalls = [];
  const callOrder = [];
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
    sendTyping(payload) {
      typingCalls.push(payload);
      callOrder.push(`typing:${payload.status}`);
      return Promise.resolve();
    },
    sendText(payload) {
      textCalls.push(payload);
      callOrder.push(`text:${payload.text}`);
      return Promise.resolve();
    },
    sendFile(payload) {
      fileCalls.push(payload);
      callOrder.push(`file:${path.basename(payload.filePath)}`);
      return Promise.resolve().then(() => sendFileImpl(payload));
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
      callOrder.push("sendTextTurn");
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
  stubModule("src/adapters/runtime/codex/model-catalog.js", {
    findModelByQuery() {
      return null;
    },
  }, originals);
  stubModule("src/integrations/timeline/index.js", {
    createTimelineIntegration() {
      return {
        runSubcommand(command, args) {
          return runTimelineSubcommandImpl(command, args);
        },
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
      snapshot() {
        return {};
      }
    },
  }, originals);
  stubModule("src/core/system-message-queue-store.js", {
    SystemMessageQueueStore: class SystemMessageQueueStore {
      constructor() {}
      enqueue(message) {
        return message;
      }
      takeReadyForAccount() {
        return [];
      }
      hasPendingForAccount() {
        return false;
      }
      defer() {
        return { status: "deferred" };
      }
      deadLetter() {
        return { status: "dead_letter" };
      }
    },
  }, originals);
  stubModule("src/core/system-message-dispatcher.js", {
    SystemMessageDispatcher: class SystemMessageDispatcher {},
  }, originals);
  stubModule("src/core/timeline-screenshot-queue-store.js", {
    TimelineScreenshotQueueStore: class TimelineScreenshotQueueStore {
      constructor() {}
      drainForAccount() {
        return [];
      }
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
      listDue() {
        return [];
      }
      peekNextDueAtMs() {
        return 0;
      }
      enqueue(reminder) {
        return reminder;
      }
    },
  }, originals);
  stubModule("src/app/system-checkin-poller.js", {
    async runSystemCheckinPoller() {},
  }, originals);

  originals.set(appModulePath, require.cache[appModulePath]);
  delete require.cache[appModulePath];
  const { CodekseiApp } = require(appModulePath);

  const app = new CodekseiApp({
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
    callOrder,
    fileCalls,
    originals,
    restore() {
      delete require.cache[appModulePath];
      restoreModules(originals);
    },
    tempRoot,
    textCalls,
    typingCalls,
  };
}

function buildIncomingMessage() {
  return {
    provider: "wechat",
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    messageId: "msg-1",
    receivedAt: "2026-04-12T12:00:00.000Z",
    text: "hello",
    attachments: [],
  };
}

test("sendTimelineScreenshot clears typing when screenshot generation fails", async () => {
  const harness = createAppHarness({
    async runTimelineSubcommandImpl() {
      throw new Error("screenshot boom");
    },
  });

  try {
    await assert.rejects(
      () => harness.app.sendTimelineScreenshot({
        senderId: "user-1",
        args: ["--selector", "main"],
        outputFile: path.join(harness.tempRoot, "timeline.png"),
      }),
      /screenshot boom/
    );
    assert.deepEqual(harness.typingCalls.map((entry) => entry.status), [1, 0]);
  } finally {
    harness.restore();
  }
});

test("sendLocalFileToCurrentChat clears typing when file delivery fails", async () => {
  const harness = createAppHarness({
    async sendFileImpl() {
      throw new Error("file boom");
    },
  });
  const filePath = path.join(harness.tempRoot, "payload.txt");
  fs.writeFileSync(filePath, "payload", "utf8");

  try {
    await assert.rejects(
      () => harness.app.sendLocalFileToCurrentChat({
        senderId: "user-1",
        filePath,
      }),
      /file boom/
    );
    assert.deepEqual(harness.typingCalls.map((entry) => entry.status), [1, 0]);
  } finally {
    harness.restore();
  }
});

test("handlePreparedMessage clears typing before sending the visible error when sendTextTurn throws", async () => {
  const harness = createAppHarness({
    async sendTextTurnImpl() {
      throw new Error("runtime boom");
    },
  });
  harness.app.runtimeTurnLifecycle.prepareIncomingMessageForRuntime = async (normalized) => ({
    ...normalized,
    text: "prepared message",
  });

  try {
    const result = await harness.app.handlePreparedMessage(buildIncomingMessage(), {
      allowCommands: false,
    });

    assert.equal(result.status, "retryable_error");
    assert.deepEqual(harness.typingCalls.map((entry) => entry.status), [1, 0]);
    assert.equal(harness.textCalls.length, 1);
    assert.equal(harness.textCalls[0].text, "处理失败：runtime boom");
    assert.deepEqual(harness.callOrder.slice(0, 4), [
      "typing:1",
      "sendTextTurn",
      "typing:0",
      "text:处理失败：runtime boom",
    ]);
  } finally {
    harness.restore();
  }
});

test("handlePreparedMessage keeps typing open on the successful sendTextTurn path", async () => {
  const harness = createAppHarness();
  harness.app.runtimeTurnLifecycle.prepareIncomingMessageForRuntime = async (normalized) => ({
    ...normalized,
    text: "prepared message",
  });

  try {
    const result = await harness.app.handlePreparedMessage(buildIncomingMessage(), {
      allowCommands: false,
    });

    assert.equal(result.status, "sent");
    assert.deepEqual(harness.typingCalls.map((entry) => entry.status), [1]);
    assert.equal(harness.textCalls.length, 0);
  } finally {
    harness.restore();
  }
});
