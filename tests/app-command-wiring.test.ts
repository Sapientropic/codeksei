const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

import type {
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
} from "../src/core/runtime-types";

interface TestHarness {
  app: {
    channelCommandRouter: {
      maybeDispatchCommand(normalized: NormalizedIncomingMessage): Promise<boolean>;
    };
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
  };
  sendTextTurnCalls: unknown[];
  workspaceRoot: string;
}

const { createTestAppHarness }: {
  createTestAppHarness: () => TestHarness;
} = require("./helpers/app-harness.ts");

function buildIncomingMessage(text: string): NormalizedIncomingMessage {
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
    text,
    attachments: [],
  };
}

test("handlePreparedMessage lets the command router intercept slash commands", async () => {
  const harness = createTestAppHarness();
  const routerCalls: string[] = [];
  harness.app.channelCommandRouter.maybeDispatchCommand = async (normalized: { text: string }) => {
    routerCalls.push(normalized.text);
    return true;
  };
  harness.app.runtimeTurnLifecycle.prepareIncomingMessageForRuntime = async () => {
    throw new Error("should not prepare");
  };

  const result = await harness.app.handlePreparedMessage(buildIncomingMessage("/help"), {
    allowCommands: true,
  });

  assert.equal(result, undefined);
  assert.deepEqual(routerCalls, ["/help"]);
  assert.deepEqual(harness.sendTextTurnCalls, []);
});

test("handlePreparedMessage still sends ordinary messages through the runtime when router returns false", async () => {
  const harness = createTestAppHarness();
  let routerCalls = 0;
  harness.app.channelCommandRouter.maybeDispatchCommand = async () => {
    routerCalls += 1;
    return false;
  };
  harness.app.runtimeTurnLifecycle.prepareIncomingMessageForRuntime = async (
    normalized: NormalizedIncomingMessage,
  ): Promise<PreparedRuntimeMessage> => ({
    ...normalized,
    originalText: normalized.text,
    text: "prepared message",
    attachmentFailures: [],
    workspaceRoot: harness.workspaceRoot,
  });

  const result = await harness.app.handlePreparedMessage(buildIncomingMessage("hello"), {
    allowCommands: true,
  });

  assert.equal(routerCalls, 1);
  assert.equal(result?.status, "sent");
  assert.equal(harness.sendTextTurnCalls.length, 1);
});
