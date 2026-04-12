const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWorkspaceCommandHandlers,
  isAbsoluteWorkspacePath,
  normalizeWorkspacePath,
  resolveBindWorkspaceRoot,
} = require("../src/core/channel-command-workspace-handlers");

function createWorkspaceHarness({
  currentWorkspaceRoot = "E:/repo/current",
  currentThreadId = "thread-current",
  currentThreadState = null,
  currentModel = "gpt-5",
  knownThreadBindings = {},
  usage = null,
} = {}) {
  const textCalls = [];
  const queueReplyCalls = [];
  const watchdogCalls = [];
  const refreshCalls = [];
  const resumeCalls = [];
  const cancelCalls = [];
  const clearThreadCalls = [];
  const setThreadCalls = [];
  const setWorkspaceCalls = [];
  const bindingKey = "workspace-1:acct-1:user-1";
  const config = {
    workspaceRoot: currentWorkspaceRoot,
    codexAccessMode: "workspace-write",
  };
  const sessionStore = {
    buildBindingKey() {
      return bindingKey;
    },
    getActiveWorkspaceRoot() {
      return currentWorkspaceRoot;
    },
    setActiveWorkspaceRoot(key, workspaceRoot) {
      setWorkspaceCalls.push({ key, workspaceRoot });
    },
    getThreadIdForWorkspace(key, workspaceRoot) {
      if (key === bindingKey && workspaceRoot === currentWorkspaceRoot) {
        return currentThreadId;
      }
      return "";
    },
    clearThreadIdForWorkspace(key, workspaceRoot) {
      clearThreadCalls.push({ key, workspaceRoot });
    },
    getCodexParamsForWorkspace() {
      return { model: currentModel };
    },
    findBindingForThreadId(threadId) {
      return knownThreadBindings[threadId] || null;
    },
    setThreadIdForWorkspace(key, workspaceRoot, threadId) {
      setThreadCalls.push({ key, workspaceRoot, threadId });
    },
  };
  const runtimeAdapter = {
    getSessionStore() {
      return sessionStore;
    },
    async refreshThreadInstructions(payload) {
      refreshCalls.push(payload);
    },
    async resumeThread(payload) {
      resumeCalls.push(payload);
    },
    async cancelTurn(payload) {
      cancelCalls.push(payload);
    },
  };
  const threadStateStore = {
    getThreadState(threadId) {
      return threadId === currentThreadId ? currentThreadState : null;
    },
    getLatestUsage() {
      return usage;
    },
  };
  const channelAdapter = {
    async sendText(payload) {
      textCalls.push(payload);
    },
  };
  const streamDelivery = {
    queueReplyTargetForThread(threadId, target) {
      queueReplyCalls.push({ threadId, target });
    },
  };
  const handlers = createWorkspaceCommandHandlers({
    channelAdapter,
    config,
    resolveWorkspaceRoot() {
      return currentWorkspaceRoot;
    },
    runtimeAdapter,
    scheduleRuntimeEventWatchdog(payload) {
      watchdogCalls.push(payload);
    },
    streamDelivery,
    threadStateStore,
  });

  return {
    cancelCalls,
    clearThreadCalls,
    config,
    handlers,
    queueReplyCalls,
    refreshCalls,
    resumeCalls,
    setThreadCalls,
    setWorkspaceCalls,
    textCalls,
    watchdogCalls,
  };
}

function buildNormalizedMessage(text = "/status") {
  return {
    provider: "weixin",
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text,
  };
}

test("workspace path helpers normalize Windows-style bind input", () => {
  assert.equal(normalizeWorkspacePath("E：＼Repo／codeksei\\\\"), "E:/Repo/codeksei");
  assert.equal(normalizeWorkspacePath("file:///E:/Repo/codeksei/"), "E:/Repo/codeksei");
  assert.equal(resolveBindWorkspaceRoot(".", "E:/Repo/codeksei"), "E:/Repo/codeksei");
  assert.equal(resolveBindWorkspaceRoot("当前项目", "E:/Repo/codeksei"), "E:/Repo/codeksei");
  assert.equal(isAbsoluteWorkspacePath("E:/Repo/codeksei"), true);
  assert.equal(isAbsoluteWorkspacePath("Repo/codeksei"), false);
});

test("bind canonicalizes the workspace path before persisting it", async () => {
  const harness = createWorkspaceHarness();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-bind-"));
  const mixedInput = workspaceRoot
    .replace(":", "：")
    .replace(/\\/g, "＼");

  await harness.handlers.bind(buildNormalizedMessage("/bind"), {
    name: "bind",
    args: mixedInput,
  });

  assert.equal(harness.setWorkspaceCalls.length, 1);
  assert.equal(
    harness.setWorkspaceCalls[0].workspaceRoot,
    normalizeWorkspacePath(fs.realpathSync(workspaceRoot))
  );
  assert.match(harness.textCalls[0].text, /^已绑定项目。/);
});

test("status reports thread, model, and usage summary", async () => {
  const harness = createWorkspaceHarness({
    currentThreadState: { status: "running", lastError: "boom" },
    usage: {
      modelContextWindow: 100000,
      lastTotalTokens: 12345,
      primaryUsedPercent: 12,
      secondaryUsedPercent: 34,
    },
  });

  await harness.handlers.status(buildNormalizedMessage("/status"));

  assert.match(harness.textCalls[0].text, /workspace: E:\/repo\/current/);
  assert.match(harness.textCalls[0].text, /thread: thread-current/);
  assert.match(harness.textCalls[0].text, /status: running/);
  assert.match(harness.textCalls[0].text, /model: gpt-5/);
  assert.match(harness.textCalls[0].text, /usage:/);
});

test("new clears the current workspace thread binding", async () => {
  const harness = createWorkspaceHarness();

  await harness.handlers.new(buildNormalizedMessage("/new"));

  assert.deepEqual(harness.clearThreadCalls, [{
    key: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
  }]);
});

test("reread reuses the current thread and schedules the runtime watchdog", async () => {
  const harness = createWorkspaceHarness();

  await harness.handlers.reread(buildNormalizedMessage("/reread"));

  assert.equal(harness.queueReplyCalls.length, 1);
  assert.equal(harness.queueReplyCalls[0].threadId, "thread-current");
  assert.equal(harness.watchdogCalls.length, 1);
  assert.equal(harness.refreshCalls.length, 1);
  assert.equal(harness.refreshCalls[0].threadId, "thread-current");
});

test("switch follows the known target thread workspace", async () => {
  const harness = createWorkspaceHarness({
    knownThreadBindings: {
      "thread-old": {
        workspaceRoot: "E:/repo/other",
      },
    },
  });

  await harness.handlers.switch(buildNormalizedMessage("/switch"), {
    name: "switch",
    args: "thread-old",
  });

  assert.deepEqual(harness.resumeCalls, [{ threadId: "thread-old" }]);
  assert.deepEqual(harness.setThreadCalls, [{
    key: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/other",
    threadId: "thread-old",
  }]);
  assert.match(harness.textCalls[0].text, /已跟随这条 thread 的已知 workspace。/);
});

test("stop only cancels a running turn", async () => {
  const idleHarness = createWorkspaceHarness({
    currentThreadState: { status: "idle", turnId: "" },
  });
  await idleHarness.handlers.stop(buildNormalizedMessage("/stop"));
  assert.deepEqual(idleHarness.cancelCalls, []);
  assert.match(idleHarness.textCalls[0].text, /当前没有正在运行的线程。/);

  const runningHarness = createWorkspaceHarness({
    currentThreadState: { status: "running", turnId: "turn-1" },
  });
  await runningHarness.handlers.stop(buildNormalizedMessage("/stop"));
  assert.deepEqual(runningHarness.cancelCalls, [{
    threadId: "thread-current",
    turnId: "turn-1",
  }]);
});
