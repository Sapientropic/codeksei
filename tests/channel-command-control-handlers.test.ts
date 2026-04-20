const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { buildWeixinHelpText } = require("../src/core/command-registry");
import type { NormalizedIncomingMessage } from "../src/core/runtime-types";

const {
  buildNormalizedCommandMessage,
  createControlCommandHarness,
} = require("./helpers/channel-command-harness.ts") as {
  buildNormalizedCommandMessage(text?: string): NormalizedIncomingMessage;
  createControlCommandHarness(options?: {
    currentEffort?: string;
  }): {
    handlers: {
      approval(normalized: NormalizedIncomingMessage, command: { name: string; args: string }): Promise<void>;
      checkin(normalized: NormalizedIncomingMessage, command: { name: string; args: string }): Promise<void>;
      effort(normalized: NormalizedIncomingMessage, command: { name: string; args: string }): Promise<void>;
      help(normalized: NormalizedIncomingMessage): Promise<void>;
      model(normalized: NormalizedIncomingMessage, command: { name: string; args: string }): Promise<void>;
      reply(normalized: NormalizedIncomingMessage, command: { name: string; args: string }): Promise<void>;
    };
    rememberPrefixCalls: Array<{ commandTokens: string[]; workspaceRoot: string }>;
    respondApprovalCalls: Array<{ decision: "accept" | "decline"; requestId: string }>;
    setModelCalls: Array<{
      bindingKey: string;
      params: { effort?: string; model?: string };
      workspaceRoot: string;
    }>;
    setReplyModeCalls: unknown[];
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
  const alwaysTextCall = alwaysHarness.textCalls[0];
  assert.ok(alwaysTextCall);
  assert.match(alwaysTextCall.text, /自动放行/);

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
  const harness = createControlCommandHarness({ currentEffort: "medium" });

  await harness.handlers.model(buildNormalizedCommandMessage("/model"), {
    name: "model",
    args: "",
  });

  const currentModelText = harness.textCalls[0];
  assert.ok(currentModelText);
  assert.match(currentModelText.text, /当前模型: gpt-5/);
  assert.match(currentModelText.text, /当前 effort: medium/);
  assert.match(currentModelText.text, /可用模型: gpt-5、gpt-5-mini/);
});

test("model handler switches to a matched model and keeps a compatible effort", async () => {
  const harness = createControlCommandHarness({ currentEffort: "low" });

  await harness.handlers.model(buildNormalizedCommandMessage("/model gpt-5-mini"), {
    name: "model",
    args: "gpt-5-mini",
  });

  assert.deepEqual(harness.setModelCalls, [{
    bindingKey: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
    params: { model: "gpt-5-mini", effort: "low" },
  }]);
  const switchedModelText = harness.textCalls[0];
  assert.ok(switchedModelText);
  assert.match(switchedModelText.text, /已切换模型。/);
  assert.match(switchedModelText.text, /effort: low/);
});

test("model handler reports when a model cannot be found", async () => {
  const harness = createControlCommandHarness();

  await harness.handlers.model(buildNormalizedCommandMessage("/model nope"), {
    name: "model",
    args: "nope",
  });

  const missingModelText = harness.textCalls[0];
  assert.ok(missingModelText);
  assert.match(missingModelText.text, /未找到模型：nope/);
});

test("model handler rejects unsupported explicit effort for the selected model", async () => {
  const harness = createControlCommandHarness();

  await harness.handlers.model(buildNormalizedCommandMessage("/model gpt-5-mini high"), {
    name: "model",
    args: "gpt-5-mini high",
  });

  assert.deepEqual(harness.setModelCalls, []);
  const textCall = harness.textCalls[0];
  assert.ok(textCall);
  assert.match(textCall.text, /不支持 effort：high/);
});

test("effort handler lists current effort and model-supported choices", async () => {
  const harness = createControlCommandHarness({ currentEffort: "medium" });

  await harness.handlers.effort(buildNormalizedCommandMessage("/effort"), {
    name: "effort",
    args: "",
  });

  const textCall = harness.textCalls[0];
  assert.ok(textCall);
  assert.match(textCall.text, /当前模型: gpt-5/);
  assert.match(textCall.text, /当前 effort: medium/);
  assert.match(textCall.text, /可用 effort: low、medium、high/);
});

test("effort handler updates effort while reusing current model", async () => {
  const harness = createControlCommandHarness();

  await harness.handlers.effort(buildNormalizedCommandMessage("/effort high"), {
    name: "effort",
    args: "high",
  });

  assert.deepEqual(harness.setModelCalls, [{
    bindingKey: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
    params: { model: "gpt-5", effort: "high" },
  }]);
  const textCall = harness.textCalls[0];
  assert.ok(textCall);
  assert.match(textCall.text, /已切换 effort。/);
});

test("checkin handler shows and updates persisted interval config", async () => {
  const harness = createControlCommandHarness();

  await harness.handlers.checkin(buildNormalizedCommandMessage("/checkin"), {
    name: "checkin",
    args: "",
  });
  await harness.handlers.checkin(buildNormalizedCommandMessage("/checkin 5-30"), {
    name: "checkin",
    args: "5-30",
  });

  assert.equal(harness.textCalls.length, 2);
  const firstText = harness.textCalls[0];
  const secondText = harness.textCalls[1];
  assert.ok(firstText);
  assert.ok(secondText);
  assert.match(firstText.text, /当前 checkin: 3m-60m/);
  assert.match(secondText.text, /当前 checkin: 5m-30m/);
});

test("reply handler inspects updates and resets delivery config", async () => {
  const harness = createControlCommandHarness();

  await harness.handlers.reply(buildNormalizedCommandMessage("/reply"), {
    name: "reply",
    args: "",
  });
  await harness.handlers.reply(buildNormalizedCommandMessage("/reply mode settled"), {
    name: "reply",
    args: "mode settled",
  });
  await harness.handlers.reply(buildNormalizedCommandMessage("/reply merge 140"), {
    name: "reply",
    args: "merge 140",
  });
  await harness.handlers.reply(buildNormalizedCommandMessage("/reply reset"), {
    name: "reply",
    args: "reset",
  });

  assert.equal(harness.textCalls.length, 4);
  assert.match(harness.textCalls[0]?.text || "", /replyMode: stream \[default\]/u);
  assert.match(harness.textCalls[1]?.text || "", /replyMode: settled \[stored\]/u);
  assert.match(harness.textCalls[2]?.text || "", /merge: 140 chars \[stored\]/u);
  assert.match(harness.textCalls[3]?.text || "", /replyMode: stream \[default\]/u);
  assert.deepEqual(harness.setReplyModeCalls, ["settled", "stream"]);
});

test("reply handler rejects invalid mode and merge values", async () => {
  const modeHarness = createControlCommandHarness();
  await modeHarness.handlers.reply(buildNormalizedCommandMessage("/reply mode weird"), {
    name: "reply",
    args: "mode weird",
  });
  assert.match(modeHarness.textCalls[0]?.text || "", /\/reply mode stream\|settled/u);

  const mergeHarness = createControlCommandHarness();
  await mergeHarness.handlers.reply(buildNormalizedCommandMessage("/reply merge 9999"), {
    name: "reply",
    args: "merge 9999",
  });
  assert.match(mergeHarness.textCalls[0]?.text || "", /\/reply merge <1-3800>/u);
});

test("help handler uses the shared weixin help text", async () => {
  const harness = createControlCommandHarness();

  await harness.handlers.help(buildNormalizedCommandMessage("/help"));

  const helpTextCall = harness.textCalls[0];
  assert.ok(helpTextCall);
  assert.equal(helpTextCall.text, buildWeixinHelpText());
});
