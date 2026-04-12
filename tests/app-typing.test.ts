const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

import type {
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
} from "../src/core/runtime-types";

interface TestHarness {
  app: {
    runtimeTurnLifecycle: {
      prepareIncomingMessageForRuntime(
        normalized: NormalizedIncomingMessage,
        workspaceRoot: string,
      ): Promise<PreparedRuntimeMessage | null>;
    };
    handlePreparedMessage(
      normalized: NormalizedIncomingMessage,
      options: { allowCommands: boolean },
    ): Promise<{ status: string } | void>;
    sendTimelineScreenshot(payload: { senderId: string; args: string[]; outputFile: string }): Promise<unknown>;
    sendLocalFileToCurrentChat(payload: { senderId: string; filePath: string }): Promise<unknown>;
  };
  callOrder: string[];
  tempRoot: string;
  textCalls: Array<{ text: string }>;
  typingCalls: Array<{ status: number }>;
  workspaceRoot: string;
}

interface TestHarnessFactoryOptions {
  runTimelineSubcommandImpl?: (command: string, args: string[]) => Promise<unknown>;
  sendFileImpl?: () => Promise<unknown>;
  sendTextTurnImpl?: () => Promise<unknown>;
}

const { createTestAppHarness }: {
  createTestAppHarness: (options?: TestHarnessFactoryOptions) => TestHarness;
} = require("./helpers/app-harness.ts");

function buildIncomingMessage(): NormalizedIncomingMessage {
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
  harness.app.runtimeTurnLifecycle.prepareIncomingMessageForRuntime = async (
    normalized: NormalizedIncomingMessage,
  ): Promise<PreparedRuntimeMessage> => ({
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
  const firstTextCall = harness.textCalls[0];
  assert.ok(firstTextCall);
  assert.equal(firstTextCall.text, "处理失败：runtime boom");
  assert.deepEqual(harness.callOrder.slice(0, 4), [
    "typing:1",
    "sendTextTurn",
    "typing:0",
    "text:处理失败：runtime boom",
  ]);
});

test("handlePreparedMessage keeps typing open on the successful sendTextTurn path", async () => {
  const harness = createTestAppHarness();
  harness.app.runtimeTurnLifecycle.prepareIncomingMessageForRuntime = async (
    normalized: NormalizedIncomingMessage,
  ): Promise<PreparedRuntimeMessage> => ({
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
