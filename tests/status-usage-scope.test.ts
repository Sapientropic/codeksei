const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { ThreadStateStore }: typeof import("../src/runtime/thread-state-store") = require("../src/runtime/thread-state-store");
const {
  buildChannelCommandContext,
}: typeof import("../src/core/channel-command-context") = require("../src/core/channel-command-context");
const {
  buildNormalizedCommandMessage,
} = require("./helpers/channel-command-harness.ts") as {
  buildNormalizedCommandMessage(text?: string): {
    accountId: string;
    senderId: string;
    workspaceId: string;
  };
};

import type { ChannelCommandSessionStore } from "../src/core/channel-command-context";

test("channel command context only exposes usage for the current thread", () => {
  const threadStateStore = new ThreadStateStore();
  threadStateStore.applyRuntimeEvent({
    type: "runtime.usage.updated",
    payload: {
      threadId: "thread-a",
      turnId: "turn-a",
      lastTotalTokens: 111,
    },
  });
  threadStateStore.applyRuntimeEvent({
    type: "runtime.usage.updated",
    payload: {
      threadId: "thread-b",
      turnId: "turn-b",
      lastTotalTokens: 222,
    },
  });

  const sessionStore: ChannelCommandSessionStore = {
    buildBindingKey() {
      return "workspace-1:acct-1:user-1";
    },
    getThreadIdForWorkspace() {
      return "thread-a";
    },
    getPendingApprovalForThread() {
      return null;
    },
  };

  const context = buildChannelCommandContext({
    normalized: buildNormalizedCommandMessage("status probe"),
    resolveWorkspaceRoot() {
      return "E:/repo/current";
    },
    runtimeAdapter: {
      getSessionStore() {
        return sessionStore;
      },
    },
    threadStateStore,
  });

  assert.equal(context.threadId, "thread-a");
  assert.ok(context.usage);
  assert.equal(context.usage.lastTotalTokens, 111);
  const threadBUsage = threadStateStore.getUsageForThread("thread-b");
  assert.ok(threadBUsage);
  assert.equal(threadBUsage.lastTotalTokens, 222);
});
