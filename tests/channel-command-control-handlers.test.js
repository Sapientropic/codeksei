const test = require("node:test");
const assert = require("node:assert/strict");

const { buildWeixinHelpText } = require("../src/core/command-registry");
const { createControlCommandHandlers } = require("../src/core/channel-command-control-handlers");

function createControlHarness({
  pendingApproval = {
    requestId: "approval-1",
    commandTokens: ["npm", "run", "timeline:write"],
  },
  currentModel = "gpt-5",
  catalog = {
    models: [
      { model: "gpt-5" },
      { model: "gpt-5-mini" },
    ],
  },
} = {}) {
  const textCalls = [];
  const respondApprovalCalls = [];
  const rememberPrefixCalls = [];
  const resolveApprovalCalls = [];
  const setModelCalls = [];
  const sessionStore = {
    buildBindingKey() {
      return "workspace-1:acct-1:user-1";
    },
    getThreadIdForWorkspace() {
      return "thread-current";
    },
    getAvailableModelCatalog() {
      return catalog;
    },
    getCodexParamsForWorkspace() {
      return { model: currentModel };
    },
    setCodexParamsForWorkspace(bindingKey, workspaceRoot, params) {
      setModelCalls.push({ bindingKey, workspaceRoot, params });
    },
    clearApprovalPrompt() {},
    rememberApprovalPrefixForWorkspace(workspaceRoot, commandTokens) {
      rememberPrefixCalls.push({ workspaceRoot, commandTokens });
    },
  };
  const runtimeAdapter = {
    getSessionStore() {
      return sessionStore;
    },
    async respondApproval(payload) {
      respondApprovalCalls.push(payload);
    },
  };
  const threadStateStore = {
    getThreadState() {
      return {
        pendingApproval,
      };
    },
    getLatestUsage() {
      return null;
    },
    resolveApproval(threadId, status) {
      resolveApprovalCalls.push({ threadId, status });
    },
  };
  const channelAdapter = {
    async sendText(payload) {
      textCalls.push(payload);
    },
  };
  const handlers = createControlCommandHandlers({
    channelAdapter,
    resolveWorkspaceRoot() {
      return "E:/repo/current";
    },
    runtimeAdapter,
    threadStateStore,
  });

  return {
    handlers,
    rememberPrefixCalls,
    resolveApprovalCalls,
    respondApprovalCalls,
    setModelCalls,
    textCalls,
  };
}

function buildNormalizedMessage(text = "/help") {
  return {
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text,
  };
}

test("approval handler only remembers prefixes for always", async () => {
  const alwaysHarness = createControlHarness();
  await alwaysHarness.handlers.approval(buildNormalizedMessage("/always"), {
    name: "always",
    args: "",
  });
  assert.deepEqual(alwaysHarness.respondApprovalCalls, [{
    requestId: "approval-1",
    decision: "accept",
  }]);
  assert.equal(alwaysHarness.rememberPrefixCalls.length, 1);
  assert.match(alwaysHarness.textCalls[0].text, /自动放行/);

  const yesHarness = createControlHarness();
  await yesHarness.handlers.approval(buildNormalizedMessage("/yes"), {
    name: "yes",
    args: "",
  });
  assert.equal(yesHarness.rememberPrefixCalls.length, 0);

  const noHarness = createControlHarness();
  await noHarness.handlers.approval(buildNormalizedMessage("/no"), {
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
  const harness = createControlHarness();

  await harness.handlers.model(buildNormalizedMessage("/model"), {
    name: "model",
    args: "",
  });

  assert.match(harness.textCalls[0].text, /当前模型: gpt-5/);
  assert.match(harness.textCalls[0].text, /可用模型: gpt-5、gpt-5-mini/);
});

test("model handler switches to a matched model", async () => {
  const harness = createControlHarness();

  await harness.handlers.model(buildNormalizedMessage("/model gpt-5-mini"), {
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
  const harness = createControlHarness();

  await harness.handlers.model(buildNormalizedMessage("/model nope"), {
    name: "model",
    args: "nope",
  });

  assert.match(harness.textCalls[0].text, /未找到模型：nope/);
});

test("help handler uses the shared weixin help text", async () => {
  const harness = createControlHarness();

  await harness.handlers.help(buildNormalizedMessage("/help"));

  assert.equal(harness.textCalls[0].text, buildWeixinHelpText());
});
