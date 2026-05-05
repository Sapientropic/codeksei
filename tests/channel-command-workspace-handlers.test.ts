const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  isAbsoluteWorkspacePath,
  normalizeWorkspacePath,
  resolveBindWorkspaceRoot,
}: typeof import("../src/core/channel-command-workspace-handlers") = require("../src/core/channel-command-workspace-handlers");
const {
  buildNormalizedCommandMessage,
  createWorkspaceCommandHarness,
} = require("./helpers/channel-command-harness.ts") as {
  buildNormalizedCommandMessage(text?: string): {
    accountId: string;
    contextToken: string;
    provider: string;
    senderId: string;
    text: string;
    workspaceId: string;
  };
  createWorkspaceCommandHarness(options?: {
    currentEffort?: string;
    currentModel?: string;
    currentThreadId?: string;
    currentThreadState?: { lastError?: string; status?: string; turnId?: string } | null;
    currentWorkspaceRoot?: string;
    knownThreadBindings?: Record<string, { bindingKey: string; workspaceRoot: string }>;
    pageArtifactStore?: import("../src/state/page-artifacts").PageArtifactStore;
    runtimeProvider?: string;
    usage?: {
      lastTotalTokens?: number;
      modelContextWindow?: number;
      primaryUsedPercent?: number;
      secondaryUsedPercent?: number;
    } | null;
  }): {
    cancelCalls: Array<{ threadId: string; turnId: string }>;
    clearThreadCalls: Array<{ key: string; workspaceRoot: string }>;
    compactCalls: Array<{ threadId: string; workspaceRoot: string }>;
    handlers: {
      "new"(normalized: ReturnType<typeof buildNormalizedCommandMessage>): Promise<void>;
      bind(normalized: ReturnType<typeof buildNormalizedCommandMessage>, command: { name: string; args: string }): Promise<void>;
      compact(normalized: ReturnType<typeof buildNormalizedCommandMessage>): Promise<void>;
      hasActivePagePointer(normalized: ReturnType<typeof buildNormalizedCommandMessage>): Promise<boolean>;
      page(normalized: ReturnType<typeof buildNormalizedCommandMessage>, command: { name: string; args: string }): Promise<void>;
      reread(normalized: ReturnType<typeof buildNormalizedCommandMessage>): Promise<void>;
      status(normalized: ReturnType<typeof buildNormalizedCommandMessage>): Promise<void>;
      stop(normalized: ReturnType<typeof buildNormalizedCommandMessage>): Promise<void>;
      switch(normalized: ReturnType<typeof buildNormalizedCommandMessage>, command: { name: string; args: string }): Promise<void>;
    };
    queueReplyCalls: Array<{ threadId: string }>;
    refreshCalls: Array<{ threadId: string }>;
    resumeCalls: Array<{ threadId: string; workspaceRoot?: string }>;
    startFreshThreadDraftCalls: Array<{ workspaceRoot: string }>;
    setPendingThreadCalls: Array<{ key: string; threadId: string; workspaceRoot: string }>;
    setThreadCalls: Array<{ key: string; threadId: string; workspaceRoot: string }>;
    setWorkspaceCalls: Array<{ key: string; workspaceRoot: string }>;
    textCalls: Array<{ text: string }>;
    watchdogCalls: Array<{ threadId?: string }>;
  };
};
const {
  PageArtifactStore,
}: typeof import("../src/state/page-artifacts") = require("../src/state/page-artifacts");

test("workspace path helpers normalize Windows-style bind input", () => {
  assert.equal(normalizeWorkspacePath("E：＼Repo／codeksei\\\\"), "E:/Repo/codeksei");
  assert.equal(normalizeWorkspacePath("file:///E:/Repo/codeksei/"), "E:/Repo/codeksei");
  assert.equal(resolveBindWorkspaceRoot(".", "E:/Repo/codeksei"), "E:/Repo/codeksei");
  assert.equal(resolveBindWorkspaceRoot("当前项目", "E:/Repo/codeksei"), "E:/Repo/codeksei");
  assert.equal(isAbsoluteWorkspacePath("E:/Repo/codeksei"), true);
  assert.equal(isAbsoluteWorkspacePath("Repo/codeksei"), false);
});

test("bind canonicalizes the workspace path before persisting it", async () => {
  const harness = createWorkspaceCommandHarness();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-bind-"));
  const mixedInput = workspaceRoot
    .replace(":", "：")
    .replace(/\\/g, "＼");
  // On Windows runners, fs.realpathSync() may surface a DOS 8.3 segment while
  // fs.promises.realpath() returns the long path. The bind handler uses the
  // async API, so the test should pin that canonicalization contract instead
  // of a runner-specific string representation.
  const expectedCanonicalWorkspaceRoot = normalizeWorkspacePath(
    await fs.promises.realpath(workspaceRoot).catch(() => workspaceRoot)
  ) || workspaceRoot;

  await harness.handlers.bind(buildNormalizedCommandMessage("/bind"), {
    name: "bind",
    args: mixedInput,
  });

  assert.equal(harness.setWorkspaceCalls.length, 1);
  const firstWorkspaceCall = harness.setWorkspaceCalls[0];
  assert.ok(firstWorkspaceCall);
  assert.equal(
    firstWorkspaceCall.workspaceRoot,
    expectedCanonicalWorkspaceRoot
  );
  const bindTextCall = harness.textCalls[0];
  assert.ok(bindTextCall);
  assert.match(bindTextCall.text, /^已绑定项目。/);
});

test("status reports thread, model, and usage summary", async () => {
  const harness = createWorkspaceCommandHarness({
    currentThreadState: { status: "running", lastError: "boom" },
    usage: {
      modelContextWindow: 100000,
      lastTotalTokens: 12345,
      primaryUsedPercent: 12,
      secondaryUsedPercent: 34,
    },
  });

  await harness.handlers.status(buildNormalizedCommandMessage("/status"));

  const statusTextCall = harness.textCalls[0];
  assert.ok(statusTextCall);
  assert.match(statusTextCall.text, /workspace: E:\/repo\/current/);
  assert.match(statusTextCall.text, /thread: thread-current/);
  assert.match(statusTextCall.text, /status: running/);
  assert.match(statusTextCall.text, /model: gpt-5/);
  assert.match(statusTextCall.text, /effort: medium/);
  assert.match(statusTextCall.text, /usage:/);
});

test("status reports active page pointer when a long reply is waiting", async () => {
  const pageArtifactStore = new PageArtifactStore({
    rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-workspace-page-status-")),
    now: () => new Date("2026-05-05T12:00:00.000Z"),
  });
  const artifact = pageArtifactStore.createTextArtifact({
    sourceKind: "weixin_reply",
    sourceName: "runtime reply",
    runtimeId: "claudecode",
    workspaceRoot: "E:/repo/current",
    bindingKey: "workspace-1:acct-1:user-1",
    text: "第一页。\n\n第二页。\n\n第三页。",
    pageChars: 8,
  });
  pageArtifactStore.activatePointer("workspace-1:acct-1:user-1", artifact.id, 1);
  const harness = createWorkspaceCommandHarness({ pageArtifactStore });

  await harness.handlers.status(buildNormalizedCommandMessage("/status"));

  assert.match(harness.textCalls[0]?.text || "", /page: active 1\/3/u);
});

test("status in Claude Code mode does not surface stale Codex effort", async () => {
  const harness = createWorkspaceCommandHarness({
    currentEffort: "",
    currentModel: "claude-sonnet-4-5",
    runtimeProvider: "claudecode",
  });

  await harness.handlers.status(buildNormalizedCommandMessage("/status"));

  const statusTextCall = harness.textCalls[0];
  assert.ok(statusTextCall);
  assert.match(statusTextCall.text, /runtime: claudecode/);
  assert.match(statusTextCall.text, /model: claude-sonnet-4-5/);
  assert.doesNotMatch(statusTextCall.text, /effort:/);
});

test("new clears the current workspace thread binding", async () => {
  const pageArtifactStore = new PageArtifactStore({
    rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-workspace-page-new-")),
  });
  const artifact = pageArtifactStore.createTextArtifact({
    sourceKind: "weixin_reply",
    sourceName: "runtime reply",
    runtimeId: "claudecode",
    workspaceRoot: "E:/repo/current",
    bindingKey: "workspace-1:acct-1:user-1",
    text: "第一页。\n\n第二页。",
    pageChars: 8,
  });
  pageArtifactStore.activatePointer("workspace-1:acct-1:user-1", artifact.id, 1);
  const harness = createWorkspaceCommandHarness({ pageArtifactStore });

  await harness.handlers.new(buildNormalizedCommandMessage("/new"));

  assert.deepEqual(harness.startFreshThreadDraftCalls, [{
    workspaceRoot: "E:/repo/current",
  }]);
  assert.deepEqual(harness.clearThreadCalls, [{
    key: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
  }]);
  assert.equal(pageArtifactStore.getActivePointer("workspace-1:acct-1:user-1"), null);
});

test("page commands advance active WeChat page pointers without flooding", async () => {
  const pageArtifactStore = new PageArtifactStore({
    rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-workspace-page-")),
    now: () => new Date("2026-05-05T12:00:00.000Z"),
  });
  const artifact = pageArtifactStore.createTextArtifact({
    sourceKind: "weixin_reply",
    sourceName: "runtime reply",
    runtimeId: "claudecode",
    workspaceRoot: "E:/repo/current",
    bindingKey: "workspace-1:acct-1:user-1",
    text: "第一页。\n\n第二页。\n\n第三页。",
    pageChars: 8,
  });
  pageArtifactStore.activatePointer("workspace-1:acct-1:user-1", artifact.id, 1);
  const harness = createWorkspaceCommandHarness({ pageArtifactStore });

  assert.equal(await harness.handlers.hasActivePagePointer(buildNormalizedCommandMessage("更多")), true);
  await harness.handlers.page(buildNormalizedCommandMessage("/more"), { name: "more", args: "" });

  assert.equal(pageArtifactStore.getActivePointer("workspace-1:acct-1:user-1")?.page, 2);
  assert.match(harness.textCalls[0]?.text || "", /第 2\/3 页/u);
  assert.match(harness.textCalls[0]?.text || "", /\/more 下一页/u);

  await harness.handlers.page(buildNormalizedCommandMessage("/page 3"), { name: "page", args: "3" });
  assert.equal(pageArtifactStore.getActivePointer("workspace-1:acct-1:user-1")?.page, 3);
  await harness.handlers.page(buildNormalizedCommandMessage("/done"), { name: "done", args: "" });
  assert.equal(pageArtifactStore.getActivePointer("workspace-1:acct-1:user-1"), null);
});

test("compact sends /compact through runtimes that expose compactThread", async () => {
  const harness = createWorkspaceCommandHarness();

  await harness.handlers.compact(buildNormalizedCommandMessage("/compact"));

  assert.deepEqual(harness.compactCalls, [{
    threadId: "thread-current",
    workspaceRoot: "E:/repo/current",
  }]);
  const compactTextCall = harness.textCalls[0];
  assert.ok(compactTextCall);
  assert.match(compactTextCall.text, /已发送 compact 请求。/);
});

test("reread reuses the current thread and schedules the runtime watchdog", async () => {
  const harness = createWorkspaceCommandHarness();

  await harness.handlers.reread(buildNormalizedCommandMessage("/reread"));

  assert.equal(harness.queueReplyCalls.length, 1);
  const firstQueueReply = harness.queueReplyCalls[0];
  assert.ok(firstQueueReply);
  assert.equal(firstQueueReply.threadId, "thread-current");
  assert.equal(harness.watchdogCalls.length, 1);
  assert.equal(harness.refreshCalls.length, 1);
  const firstRefreshCall = harness.refreshCalls[0];
  assert.ok(firstRefreshCall);
  assert.equal(firstRefreshCall.threadId, "thread-current");
});

test("switch follows the known target thread workspace", async () => {
  const harness = createWorkspaceCommandHarness({
    knownThreadBindings: {
      "thread-old": {
        bindingKey: "workspace-1:acct-1:user-1",
        workspaceRoot: "E:/repo/other",
      },
    },
  });

  await harness.handlers.switch(buildNormalizedCommandMessage("/switch"), {
    name: "switch",
    args: "thread-old",
  });

  assert.deepEqual(harness.resumeCalls, [{ threadId: "thread-old", workspaceRoot: "E:/repo/other" }]);
  assert.deepEqual(harness.setThreadCalls, [{
    key: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/other",
    threadId: "thread-old",
  }]);
  const switchTextCall = harness.textCalls[0];
  assert.ok(switchTextCall);
  assert.match(switchTextCall.text, /已跟随这条 thread 的已知 workspace。/);
});

test("stop only cancels a running turn", async () => {
  const idleHarness = createWorkspaceCommandHarness({
    currentThreadState: { status: "idle", turnId: "" },
  });
  await idleHarness.handlers.stop(buildNormalizedCommandMessage("/stop"));
  assert.deepEqual(idleHarness.cancelCalls, []);
  const idleStopText = idleHarness.textCalls[0];
  assert.ok(idleStopText);
  assert.match(idleStopText.text, /当前没有正在运行的线程。/);

  const runningHarness = createWorkspaceCommandHarness({
    currentThreadState: { status: "running", turnId: "turn-1" },
  });
  await runningHarness.handlers.stop(buildNormalizedCommandMessage("/stop"));
  assert.deepEqual(runningHarness.cancelCalls, [{
    threadId: "thread-current",
    turnId: "turn-1",
  }]);

  const waitingApprovalHarness = createWorkspaceCommandHarness({
    currentThreadState: { status: "waiting_approval", turnId: "turn-approval" },
  });
  await waitingApprovalHarness.handlers.stop(buildNormalizedCommandMessage("/stop"));
  assert.deepEqual(waitingApprovalHarness.cancelCalls, [{
    threadId: "thread-current",
    turnId: "turn-approval",
  }]);
});

test("switch in Claude Code mode writes a pending thread until session verification", async () => {
  const harness = createWorkspaceCommandHarness({
    runtimeProvider: "claudecode",
  });

  await harness.handlers.switch(buildNormalizedCommandMessage("/switch"), {
    name: "switch",
    args: "123e4567-e89b-12d3-a456-426614174000",
  });

  assert.deepEqual(harness.resumeCalls, [{
    threadId: "123e4567-e89b-12d3-a456-426614174000",
    workspaceRoot: "E:/repo/current",
  }]);
  assert.deepEqual(harness.setPendingThreadCalls, [{
    key: "workspace-1:acct-1:user-1",
    workspaceRoot: "E:/repo/current",
    threadId: "123e4567-e89b-12d3-a456-426614174000",
  }]);
  assert.deepEqual(harness.setThreadCalls, []);
});
