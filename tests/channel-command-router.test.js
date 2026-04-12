const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ChannelCommandRouter,
  parseChannelCommand,
} = require("../src/core/channel-command-router");

function createRouterHarness() {
  const calls = [];
  const router = new ChannelCommandRouter({
    workspaceHandlers: {
      async bind(normalized, command) {
        calls.push({ type: "bind", normalized, command });
      },
      async status(normalized, command) {
        calls.push({ type: "status", normalized, command });
      },
      async new(normalized, command) {
        calls.push({ type: "new", normalized, command });
      },
      async reread(normalized, command) {
        calls.push({ type: "reread", normalized, command });
      },
      async switch(normalized, command) {
        calls.push({ type: "switch", normalized, command });
      },
      async stop(normalized, command) {
        calls.push({ type: "stop", normalized, command });
      },
    },
    controlHandlers: {
      async approval(normalized, command) {
        calls.push({ type: "approval", normalized, command });
      },
      async model(normalized, command) {
        calls.push({ type: "model", normalized, command });
      },
      async help(normalized, command) {
        calls.push({ type: "help", normalized, command });
      },
    },
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

  const handled = await router.maybeDispatchCommand({ text: "hello" });

  assert.equal(handled, false);
  assert.deepEqual(calls, []);
});

test("ChannelCommandRouter routes approval aliases through one approval handler", async () => {
  const { calls, router } = createRouterHarness();

  const handled = await router.maybeDispatchCommand({ text: "/always" });

  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "approval");
  assert.equal(calls[0].command.name, "always");
});

test("ChannelCommandRouter falls back unknown commands to help", async () => {
  const { calls, router } = createRouterHarness();

  const handled = await router.maybeDispatchCommand({ text: "/wat" });

  assert.equal(handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "help");
  assert.equal(calls[0].command.name, "wat");
});
