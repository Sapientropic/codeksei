const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  ChannelCommandRouter,
  parseChannelCommand,
}: typeof import("../src/core/channel-command-router") = require("../src/core/channel-command-router");
const {
  buildNormalizedCommandMessage,
} = require("./helpers/channel-command-harness.ts") as {
  buildNormalizedCommandMessage(text?: string): ChannelCommandMessage;
};

import type {
  ChannelCommandMessage,
  ControlCommandHandlerSet,
  ParsedChannelCommand,
  WorkspaceCommandHandlerSet,
} from "../src/core/channel-command-router";

interface RoutedCall {
  command: ParsedChannelCommand;
  normalized: ChannelCommandMessage;
  type: string;
}

function createRouterHarness() {
  const calls: RoutedCall[] = [];
  const workspaceHandlers: WorkspaceCommandHandlerSet = {
    async bind(normalized: ChannelCommandMessage, command: ParsedChannelCommand) {
      calls.push({ type: "bind", normalized, command });
    },
    async status(normalized: ChannelCommandMessage, command: ParsedChannelCommand) {
      calls.push({ type: "status", normalized, command });
    },
    new: async (normalized: ChannelCommandMessage, command: ParsedChannelCommand) => {
      calls.push({ type: "new", normalized, command });
    },
    async reread(normalized: ChannelCommandMessage, command: ParsedChannelCommand) {
      calls.push({ type: "reread", normalized, command });
    },
    async switch(normalized: ChannelCommandMessage, command: ParsedChannelCommand) {
      calls.push({ type: "switch", normalized, command });
    },
    async stop(normalized: ChannelCommandMessage, command: ParsedChannelCommand) {
      calls.push({ type: "stop", normalized, command });
    },
  };
  const controlHandlers: ControlCommandHandlerSet = {
    async approval(normalized: ChannelCommandMessage, command: ParsedChannelCommand) {
      calls.push({ type: "approval", normalized, command });
    },
    async model(normalized: ChannelCommandMessage, command: ParsedChannelCommand) {
      calls.push({ type: "model", normalized, command });
    },
    async help(normalized: ChannelCommandMessage, command: ParsedChannelCommand) {
      calls.push({ type: "help", normalized, command });
    },
  };
  const router = new ChannelCommandRouter({
    workspaceHandlers,
    controlHandlers,
  });
  return { calls, router };
}

test("parseChannelCommand ignores ordinary text and normalizes slash commands", () => {
  assert.equal(parseChannelCommand("hello"), null);
  assert.deepEqual(parseChannelCommand(" /Model   gpt-5  "), {
    name: "model",
    args: "gpt-5",
  });
});

test("ChannelCommandRouter leaves ordinary messages alone", async () => {
  const { calls, router } = createRouterHarness();

  const handled = await router.maybeDispatchCommand(buildNormalizedCommandMessage("hello"));

  assert.equal(handled, false);
  assert.deepEqual(calls, []);
});

test("ChannelCommandRouter routes approval aliases through one approval handler", async () => {
  const { calls, router } = createRouterHarness();

  const handled = await router.maybeDispatchCommand(buildNormalizedCommandMessage("/always"));

  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  const firstCall = calls[0];
  assert.ok(firstCall);
  assert.equal(firstCall.type, "approval");
  assert.equal(firstCall.command.name, "always");
});

test("ChannelCommandRouter falls back unknown commands to help", async () => {
  const { calls, router } = createRouterHarness();

  const handled = await router.maybeDispatchCommand(buildNormalizedCommandMessage("/wat"));

  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  const fallbackCall = calls[0];
  assert.ok(fallbackCall);
  assert.equal(fallbackCall.type, "help");
  assert.equal(fallbackCall.command.name, "wat");
});
