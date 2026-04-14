const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { normalizeText } = require("../src/core/text-normalization");
const { RuntimeTurnLifecycle } = require("../src/runtime/runtime-turn-lifecycle");

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
  sendTextTurnImpl = async () => ({ threadId: "thread-1", workspaceBootstrapPending: false }),
  persistIncomingWeixinAttachmentsImpl = async () => ({ saved: [], failed: [] }),
  buildRuntimeInboundTextImpl = (normalized: { text?: string }) => String(normalized.text || "").trim(),
}: {
  codexParams?: { model?: string; effort?: string };
  sendTextTurnImpl?: (payload: Record<string, unknown>) => Promise<{ threadId: string; workspaceBootstrapPending: boolean }>;
  persistIncomingWeixinAttachmentsImpl?: (args: Record<string, unknown>) => Promise<{ saved: unknown[]; failed: Array<{ reason: string }> }>;
  buildRuntimeInboundTextImpl?: (normalized: Record<string, unknown>, persisted: Record<string, unknown>) => string;
} = {}) {
  const sendTextCalls: Array<{ text: string }> = [];
  const sendTypingCalls: Array<{ status: number }> = [];
  const sendTextTurnCalls: Record<string, unknown>[] = [];
  const bootstrapCalls: Record<string, unknown>[] = [];
  const watchdogCalls: Record<string, unknown>[] = [];

  const runtimeAdapter = {
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
      getKnownContextTokens() {
        return { "user-1": "ctx-1" };
      },
      async sendFile() {},
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
      return "user-1";
    },
    resolveTimelineScreenshotOutput() {
      return "";
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
      async runSubcommand() {},
    },
    buildRuntimeInboundText: buildRuntimeInboundTextImpl,
  });

  return {
    bootstrapCalls,
    lifecycle,
    sendTextCalls,
    sendTextTurnCalls,
    sendTypingCalls,
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
