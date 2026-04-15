const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const { normalizeText } = require("../src/core/text-normalization");
const { RuntimeTurnLifecycle } = require("../src/runtime/runtime-turn-lifecycle");

function buildTestChannelDescriptor(overrides: Partial<{
  visibleTextDelivery: boolean;
  visibleTypingDelivery: boolean;
  visibleFileDelivery: boolean;
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
      visibleFileDelivery: overrides.visibleFileDelivery ?? true,
    },
  };
}

function buildTestRuntimeDescriptor(overrides: Partial<{
  interactiveTurn: boolean;
}> = {}) {
  return {
    id: "test-runtime",
    kind: "runtime" as const,
    provider: "test",
    operations: {
      initialize: true,
      interactiveTurn: overrides.interactiveTurn ?? true,
      refreshThreadInstructions: true,
      respondApproval: true,
      resumeThread: true,
      cancelTurn: true,
    },
  };
}

function buildIncomingMessage(overrides: Record<string, unknown> = {}) {
  return {
    provider: "weixin",
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    chatId: "chat-1",
    threadKey: "thread:user-1",
    command: "message",
    messageId: "msg-1",
    receivedAt: "2026-04-14T14:00:00+08:00",
    text: "hello",
    attachments: [],
    ...overrides,
  };
}

function createLifecycle({
  codexParams = { model: "", effort: "" },
  defaultTerminalUser = "user-1",
  sendTextTurnImpl = async () => ({ threadId: "thread-1", workspaceBootstrapPending: false }),
  persistIncomingWeixinAttachmentsImpl = async () => ({ saved: [], failed: [] }),
  buildRuntimeInboundTextImpl = (normalized: { text?: string }) => String(normalized.text || "").trim(),
  channelOperations = {},
  knownContextTokens = { "user-1": "ctx-1" },
  runtimeOperations = {},
}: {
  codexParams?: { model?: string; effort?: string };
  defaultTerminalUser?: string;
  sendTextTurnImpl?: (payload: Record<string, unknown>) => Promise<{ threadId: string; workspaceBootstrapPending: boolean }>;
  persistIncomingWeixinAttachmentsImpl?: (args: Record<string, unknown>) => Promise<{ saved: unknown[]; failed: Array<{ reason: string }> }>;
  buildRuntimeInboundTextImpl?: (normalized: Record<string, unknown>, persisted: Record<string, unknown>) => string;
  channelOperations?: Partial<{
    visibleTextDelivery: boolean;
    visibleTypingDelivery: boolean;
    visibleFileDelivery: boolean;
  }>;
  knownContextTokens?: Record<string, string>;
  runtimeOperations?: Partial<{
    interactiveTurn: boolean;
  }>;
} = {}) {
  const sendFileCalls: Array<{ filePath: string }> = [];
  const sendTextCalls: Array<{ text: string }> = [];
  const sendTypingCalls: Array<{ status: number }> = [];
  const sendTextTurnCalls: Record<string, unknown>[] = [];
  const bootstrapCalls: Record<string, unknown>[] = [];
  const timelineCalls: Array<{ command: string; args: string[] }> = [];
  const watchdogCalls: Record<string, unknown>[] = [];

  const runtimeAdapter = {
    describe() {
      return buildTestRuntimeDescriptor(runtimeOperations);
    },
    getSessionStore() {
      return {
        buildBindingKey({ workspaceId, accountId, senderId }: { workspaceId: string; accountId: string; senderId: string }) {
          return `${workspaceId}:${accountId}:${senderId}`;
        },
        getRuntimeParamsForWorkspace() {
          return codexParams;
        },
      };
    },
    async sendTextTurn(payload: Record<string, unknown>) {
      sendTextTurnCalls.push(payload);
      return sendTextTurnImpl(payload);
    },
  };

  const lifecycle = new RuntimeTurnLifecycle({
    channelAdapter: {
      describe() {
        return buildTestChannelDescriptor(channelOperations);
      },
      getKnownContextTokens() {
        return knownContextTokens;
      },
      async sendFile(payload: { filePath: string }) {
        sendFileCalls.push(payload);
      },
      async sendText(payload: { text: string }) {
        sendTextCalls.push(payload);
      },
      async sendTyping(payload: { status: number }) {
        sendTypingCalls.push(payload);
      },
    },
    config: {
      stateDir: "E:/state",
      workspaceId: "workspace-1",
      workspaceRoot: "E:/repo/current",
      sessionsFile: "E:/state/sessions.json",
      runtimeAccessMode: "workspace-write",
      weixinCdnBaseUrl: "https://cdn.example.com",
    },
    formatErrorMessage(error: unknown) {
      return error instanceof Error ? error.message : String(error || "unknown");
    },
    maybeDispatchCommand: async () => false,
    normalizeText,
    persistIncomingWeixinAttachments: persistIncomingWeixinAttachmentsImpl,
    queuePendingWorkspaceBootstrap(payload: Record<string, unknown>) {
      bootstrapCalls.push(payload);
    },
    resolveDefaultTerminalUser() {
      return defaultTerminalUser;
    },
    resolveTimelineScreenshotOutput() {
      return "E:/repo/current/shots/capture.png";
    },
    resolveWorkspaceRoot() {
      return "E:/repo/current";
    },
    runtimeAdapter,
    scheduleRuntimeEventWatchdog(payload: Record<string, unknown>) {
      watchdogCalls.push(payload);
    },
    streamDelivery: {
      queueReplyTargetForThread() {},
      setReplyTarget() {},
    },
    timelineIntegration: {
      async runSubcommand(command: string, args: string[]) {
        timelineCalls.push({ command, args });
      },
    },
    buildRuntimeInboundText: buildRuntimeInboundTextImpl,
  });

  return {
    bootstrapCalls,
    fileCalls: sendFileCalls,
    lifecycle,
    sendTextCalls,
    sendTextTurnCalls,
    sendTypingCalls,
    timelineCalls,
    watchdogCalls,
  };
}

test("prepareIncomingMessageForRuntime notifies the user when attachment-only intake fails", async () => {
  const harness = createLifecycle({
    persistIncomingWeixinAttachmentsImpl: async () => ({
      saved: [],
      failed: [{ reason: "download failed" }],
    }),
    buildRuntimeInboundTextImpl: () => "",
  });

  const prepared = await harness.lifecycle.prepareIncomingMessageForRuntime(buildIncomingMessage({
    text: "",
    attachments: [{ kind: "file", fileName: "payload.txt" }],
  }), "E:/repo/current");

  assert.equal(prepared, null);
  assert.equal(harness.sendTextCalls.length, 1);
  assert.ok(harness.sendTextCalls[0]);
  assert.match(harness.sendTextCalls[0].text, /附件接收失败|download failed/u);
});

test("sendTimelineScreenshot runs timeline capture and delivers the file to the current chat", async () => {
  const harness = createLifecycle();

  const result = await harness.lifecycle.sendTimelineScreenshot({
    senderId: "user-1",
    args: ["--selector", "timeline"],
  });

  assert.deepEqual(result, {
    userId: "user-1",
    filePath: "E:/repo/current/shots/capture.png",
  });
  assert.deepEqual(harness.timelineCalls, [{
    command: "screenshot",
    args: ["--selector", "timeline"],
  }]);
  assert.deepEqual(harness.fileCalls, [{
    userId: "user-1",
    filePath: "E:/repo/current/shots/capture.png",
    contextToken: "ctx-1",
  }]);
  assert.deepEqual(harness.sendTypingCalls.map((entry) => entry.status), [1, 0]);
});

test("sendTimelineScreenshot fails when the target user has no known context token", async () => {
  const harness = createLifecycle({
    defaultTerminalUser: "user-missing",
    knownContextTokens: {},
  });

  await assert.rejects(
    () => harness.lifecycle.sendTimelineScreenshot({
      args: ["--selector", "timeline"],
    }),
    /context token/u,
  );
  assert.deepEqual(harness.timelineCalls, []);
  assert.deepEqual(harness.fileCalls, []);
});

test("sendLocalFileToCurrentChat sends the resolved file path to the active chat", async (t) => {
  const harness = createLifecycle();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-runtime-turn-"));
  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const filePath = path.join(tempRoot, "report.txt");
  const expectedPath = path.resolve(filePath);
  fs.writeFileSync(filePath, "report", "utf8");

  const result = await harness.lifecycle.sendLocalFileToCurrentChat({
    senderId: "user-1",
    filePath,
  });

  assert.deepEqual(result, {
    userId: "user-1",
    filePath: expectedPath,
  });
  assert.deepEqual(harness.fileCalls, [{
    userId: "user-1",
    filePath: expectedPath,
    contextToken: "ctx-1",
  }]);
  assert.deepEqual(harness.sendTypingCalls.map((entry) => entry.status), [1, 0]);
});

test("sendLocalFileToCurrentChat fails when no sender can be resolved", async () => {
  const harness = createLifecycle({
    defaultTerminalUser: "",
  });

  await assert.rejects(
    () => harness.lifecycle.sendLocalFileToCurrentChat({
      senderId: "",
      filePath: "E:/repo/current/report.txt",
    }),
    /无法确定文件要发送给哪个微信用户/u,
  );
  assert.deepEqual(harness.fileCalls, []);
});

test("sendPreparedMessageToRuntime forwards model effort and access mode, then schedules bootstrap/watchdog", async () => {
  const harness = createLifecycle({
    codexParams: { model: "gpt-5", effort: "high" },
    sendTextTurnImpl: async () => ({ threadId: "thread-77", workspaceBootstrapPending: true }),
  });

  const result = await harness.lifecycle.sendPreparedMessageToRuntime({
    bindingKey: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
    normalized: buildIncomingMessage(),
    prepared: {
      ...buildIncomingMessage(),
      originalText: "hello",
      text: "prepared message",
      attachments: [],
      attachmentFailures: [],
      workspaceRoot: "E:/repo/current",
    },
  });

  assert.deepEqual(result, { status: "sent", threadId: "thread-77" });
  assert.deepEqual(harness.sendTypingCalls.map((entry) => entry.status), [1]);
  assert.deepEqual(harness.sendTextTurnCalls, [{
    bindingKey: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
    text: "prepared message",
    model: "gpt-5",
    effort: "high",
    accessMode: "workspace-write",
    metadata: {
      workspaceId: "workspace-1",
      accountId: "acct-1",
      senderId: "user-1",
    },
  }]);
  assert.deepEqual(harness.bootstrapCalls, [{
    bindingKey: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
    threadId: "thread-77",
  }]);
  assert.deepEqual(harness.watchdogCalls, [{
    bindingKey: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
    normalized: {
      ...buildIncomingMessage(),
      originalText: "hello",
      text: "prepared message",
      attachments: [],
      attachmentFailures: [],
      workspaceRoot: "E:/repo/current",
    },
    threadId: "thread-77",
  }]);
});

test("sendPreparedMessageToRuntime forwards structured system metadata for checkin wakes", async () => {
  const harness = createLifecycle();

  await harness.lifecycle.sendPreparedMessageToRuntime({
    bindingKey: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
    normalized: buildIncomingMessage({
      provider: "system",
      systemMessageKind: "checkin",
      checkinTriggerId: "trigger-77",
    }),
    prepared: {
      ...buildIncomingMessage({
        provider: "system",
        systemMessageKind: "checkin",
        checkinTriggerId: "trigger-77",
      }),
      originalText: "wake",
      text: "prepared wake",
      attachments: [],
      attachmentFailures: [],
      workspaceRoot: "E:/repo/current",
    },
  });

  assert.deepEqual(harness.sendTextTurnCalls[0]?.metadata, {
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    systemMessage: {
      kind: "checkin",
      messageId: "msg-1",
      checkinTriggerId: "trigger-77",
    },
  });
});

test("handlePreparedMessage can throw retryable runtime failures without sending a user notice", async () => {
  const harness = createLifecycle();
  harness.lifecycle.prepareIncomingMessageForRuntime = async () => ({
    ...buildIncomingMessage(),
    originalText: "hello",
    text: "prepared message",
    attachments: [],
    attachmentFailures: [],
    workspaceRoot: "E:/repo/current",
  });
  harness.lifecycle.sendPreparedMessageToRuntime = async () => ({
    status: "retryable_error",
    reason: "runtime boom",
    error: new Error("runtime boom"),
  });

  await assert.rejects(
    () => harness.lifecycle.handlePreparedMessage(buildIncomingMessage(), {
      allowCommands: false,
      reportFailureToUser: false,
      throwOnFailure: true,
    }),
    /runtime boom/u,
  );
  assert.deepEqual(harness.sendTextCalls, []);
});

test("handlePreparedMessage returns skipped when preparation produces no runtime payload", async () => {
  const harness = createLifecycle();
  harness.lifecycle.prepareIncomingMessageForRuntime = async () => null;

  const result = await harness.lifecycle.handlePreparedMessage(buildIncomingMessage(), {
    allowCommands: false,
  });

  assert.deepEqual(result, { status: "skipped", reason: "not_prepared" });
  assert.deepEqual(harness.sendTextTurnCalls, []);
});

test("handlePreparedMessage suppresses visible failure notices when the host cannot deliver text", async () => {
  const harness = createLifecycle({
    channelOperations: { visibleTextDelivery: false },
  });
  harness.lifecycle.prepareIncomingMessageForRuntime = async () => ({
    ...buildIncomingMessage(),
    originalText: "hello",
    text: "prepared message",
    attachments: [],
    attachmentFailures: [],
    workspaceRoot: "E:/repo/current",
  });
  harness.lifecycle.sendPreparedMessageToRuntime = async () => ({
    status: "retryable_error",
    reason: "runtime boom",
  });

  const result = await harness.lifecycle.handlePreparedMessage(buildIncomingMessage(), {
    allowCommands: false,
  });

  assert.deepEqual(result, {
    status: "retryable_error",
    reason: "runtime boom",
  });
  assert.deepEqual(harness.sendTextCalls, []);
});

test("withUserTyping clears the typing indicator after failures", async () => {
  const harness = createLifecycle();

  await assert.rejects(
    () => harness.lifecycle.withUserTyping({ userId: "user-1", contextToken: "ctx-1" }, async () => {
      throw new Error("typing boom");
    }),
    /typing boom/u,
  );

  assert.deepEqual(harness.sendTypingCalls.map((entry) => entry.status), [1, 0]);
});

test("sendPreparedMessageToRuntime fails fast before touching the runtime when interactive turn is unsupported", async () => {
  const harness = createLifecycle({
    runtimeOperations: { interactiveTurn: false },
  });

  const result = await harness.lifecycle.sendPreparedMessageToRuntime({
    bindingKey: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
    normalized: buildIncomingMessage(),
    prepared: {
      ...buildIncomingMessage(),
      originalText: "hello",
      text: "prepared message",
      attachments: [],
      attachmentFailures: [],
      workspaceRoot: "E:/repo/current",
    },
  });

  assert.deepEqual(result, {
    status: "retryable_error",
    reason: "当前宿主不支持 interactive runtime turn。",
  });
  assert.deepEqual(harness.sendTextTurnCalls, []);
  assert.deepEqual(harness.sendTypingCalls, []);
});

test("prepareIncomingMessageForRuntime skips courtesy notices when visible text delivery is unsupported", async () => {
  const harness = createLifecycle({
    channelOperations: { visibleTextDelivery: false },
    persistIncomingWeixinAttachmentsImpl: async () => ({
      saved: [],
      failed: [{ reason: "download failed" }],
    }),
    buildRuntimeInboundTextImpl: () => "",
  });

  const prepared = await harness.lifecycle.prepareIncomingMessageForRuntime(buildIncomingMessage({
    text: "",
    attachments: [{ kind: "file", fileName: "payload.txt" }],
  }), "E:/repo/current");

  assert.equal(prepared, null);
  assert.deepEqual(harness.sendTextCalls, []);
});

test("withUserTyping skips typing mutations when the host cannot surface typing status", async () => {
  const harness = createLifecycle({
    channelOperations: { visibleTypingDelivery: false },
  });

  await harness.lifecycle.withUserTyping({ userId: "user-1", contextToken: "ctx-1" }, async () => "ok");

  assert.deepEqual(harness.sendTypingCalls, []);
});

test("sendLocalFileToCurrentChat fails before adapter delivery when visible file delivery is unsupported", async () => {
  const harness = createLifecycle({
    channelOperations: { visibleFileDelivery: false },
  });

  await assert.rejects(
    () => harness.lifecycle.sendLocalFileToCurrentChat({
      senderId: "user-1",
      filePath: "E:/repo/current/report.txt",
    }),
    /不支持可见文件回传/u,
  );
  assert.deepEqual(harness.fileCalls, []);
});
