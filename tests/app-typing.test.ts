const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestAppHarness } = require("./helpers/app-harness.ts");

function buildIncomingMessage() {
  return {
    provider: "wechat",
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    chatId: "chat-1",
    threadKey: "thread:user-1",
    command: "message",
    messageId: "msg-1",
    receivedAt: "2026-04-12T12:00:00.000Z",
    text: "hello",
    attachments: [],
  };
}

test("sendTimelineScreenshot clears typing when screenshot generation fails", async () => {
  const harness = createTestAppHarness({
    async runTimelineSubcommandImpl() {
      throw new Error("screenshot boom");
    },
  });

  await assert.rejects(
    () => harness.app.sendTimelineScreenshot({
      senderId: "user-1",
      args: ["--selector", "main"],
      outputFile: path.join(harness.tempRoot, "timeline.png"),
    }),
    /screenshot boom/,
  );
  assert.deepEqual(harness.typingCalls.map((entry: { status: number }) => entry.status), [1, 0]);
});

test("sendLocalFileToCurrentChat clears typing when file delivery fails", async () => {
  const harness = createTestAppHarness({
    async sendFileImpl() {
      throw new Error("file boom");
    },
  });
  const filePath = path.join(harness.tempRoot, "payload.txt");
  fs.writeFileSync(filePath, "payload", "utf8");

  await assert.rejects(
    () => harness.app.sendLocalFileToCurrentChat({
      senderId: "user-1",
      filePath,
    }),
    /file boom/,
  );
  assert.deepEqual(harness.typingCalls.map((entry: { status: number }) => entry.status), [1, 0]);
});

test("handlePreparedMessage clears typing before sending the visible error when sendTextTurn throws", async () => {
  const harness = createTestAppHarness({
    async sendTextTurnImpl() {
      throw new Error("runtime boom");
    },
  });
  harness.app.runtimeTurnLifecycle.prepareIncomingMessageForRuntime = async (normalized: any) => ({
    ...normalized,
    originalText: normalized.text,
    text: "prepared message",
    attachmentFailures: [],
    workspaceRoot: harness.workspaceRoot,
  });

  const result = await harness.app.handlePreparedMessage(buildIncomingMessage(), {
    allowCommands: false,
  });

  assert.equal(result?.status, "retryable_error");
  assert.deepEqual(harness.typingCalls.map((entry: { status: number }) => entry.status), [1, 0]);
  assert.equal(harness.textCalls.length, 1);
  assert.equal(harness.textCalls[0].text, "处理失败：runtime boom");
  assert.deepEqual(harness.callOrder.slice(0, 4), [
    "typing:1",
    "sendTextTurn",
    "typing:0",
    "text:处理失败：runtime boom",
  ]);
});

test("handlePreparedMessage keeps typing open on the successful sendTextTurn path", async () => {
  const harness = createTestAppHarness();
  harness.app.runtimeTurnLifecycle.prepareIncomingMessageForRuntime = async (normalized: any) => ({
    ...normalized,
    originalText: normalized.text,
    text: "prepared message",
    attachmentFailures: [],
    workspaceRoot: harness.workspaceRoot,
  });

  const result = await harness.app.handlePreparedMessage(buildIncomingMessage(), {
    allowCommands: false,
  });

  assert.equal(result?.status, "sent");
  assert.deepEqual(harness.typingCalls.map((entry: { status: number }) => entry.status), [1]);
  assert.equal(harness.textCalls.length, 0);
});
