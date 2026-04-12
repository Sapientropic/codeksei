const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { buildWeixinHelpText } = require("../src/core/command-registry");
import type { NormalizedIncomingMessage } from "../src/core/runtime-types";

const {
  buildNormalizedCommandMessage,
  createControlCommandHarness,
} = require("./helpers/channel-command-harness.ts") as {
  buildNormalizedCommandMessage(text?: string): NormalizedIncomingMessage;
  createControlCommandHarness(): {
    handlers: {
      approval(normalized: NormalizedIncomingMessage, command: { name: string; args: string }): Promise<void>;
      help(normalized: NormalizedIncomingMessage): Promise<void>;
      model(normalized: NormalizedIncomingMessage, command: { name: string; args: string }): Promise<void>;
    };
    rememberPrefixCalls: Array<{ commandTokens: string[]; workspaceRoot: string }>;
    respondApprovalCalls: Array<{ decision: "accept" | "decline"; requestId: string }>;
    setModelCalls: Array<{
      bindingKey: string;
      params: { model: string };
      workspaceRoot: string;
    }>;
    textCalls: Array<{ text: string }>;
  };
};

test("approval handler only remembers prefixes for always", async () => {
  const alwaysHarness = createControlCommandHarness();
  await alwaysHarness.handlers.approval(buildNormalizedCommandMessage("/always"), {
    name: "always",
    args: "",
  });
  assert.deepEqual(alwaysHarness.respondApprovalCalls, [{
    requestId: "approval-1",
    decision: "accept",
  }]);
  assert.equal(alwaysHarness.rememberPrefixCalls.length, 1);
  assert.match(alwaysHarness.textCalls[0].text, /自动放行/);

  const yesHarness = createControlCommandHarness();
  await yesHarness.handlers.approval(buildNormalizedCommandMessage("/yes"), {
    name: "yes",
    args: "",
  });
  assert.equal(yesHarness.rememberPrefixCalls.length, 0);

  const noHarness = createControlCommandHarness();
  await noHarness.handlers.approval(buildNormalizedCommandMessage("/no"), {
    name: "no",
    args: "",
  });
  assert.deepEqual(noHarness.respondApprovalCalls, [{
    requestId: "approval-1",
    decision: "decline",
  }]);
  assert.equal(noHarness.rememberPrefixCalls.length, 0);
});

test("model handler lists current and available models when no query is given", async () => {
  const harness = createControlCommandHarness();

  await harness.handlers.model(buildNormalizedCommandMessage("/model"), {
    name: "model",
    args: "",
  });

  assert.match(harness.textCalls[0].text, /当前模型: gpt-5/);
  assert.match(harness.textCalls[0].text, /可用模型: gpt-5、gpt-5-mini/);
});

test("model handler switches to a matched model", async () => {
  const harness = createControlCommandHarness();

  await harness.handlers.model(buildNormalizedCommandMessage("/model gpt-5-mini"), {
    name: "model",
    args: "gpt-5-mini",
  });

  assert.deepEqual(harness.setModelCalls, [{
    bindingKey: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
    params: { model: "gpt-5-mini" },
  }]);
  assert.match(harness.textCalls[0].text, /已切换模型。/);
});

test("model handler reports when a model cannot be found", async () => {
  const harness = createControlCommandHarness();

  await harness.handlers.model(buildNormalizedCommandMessage("/model nope"), {
    name: "model",
    args: "nope",
  });

  assert.match(harness.textCalls[0].text, /未找到模型：nope/);
});

test("help handler uses the shared weixin help text", async () => {
  const harness = createControlCommandHarness();

  await harness.handlers.help(buildNormalizedCommandMessage("/help"));

  assert.equal(harness.textCalls[0].text, buildWeixinHelpText());
});
