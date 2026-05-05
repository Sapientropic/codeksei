const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const { SessionStore }: typeof import("../src/adapters/runtime/codex/session-store") = require("../src/adapters/runtime/codex/session-store");
const { SessionStoreWriter }: typeof import("../src/adapters/runtime/codex/session-store-writer") = require("../src/adapters/runtime/codex/session-store-writer");
const { withSessionStoreLock }: typeof import("../src/adapters/runtime/codex/session-store-lock") = require("../src/adapters/runtime/codex/session-store-lock");

function createTempSessionFile() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-session-store-"));
  return {
    tempRoot,
    filePath: path.join(tempRoot, "sessions.json"),
  };
}

test("SessionStore quarantines schema-invalid nested binding state", () => {
  const { filePath, tempRoot } = createTempSessionFile();
  fs.writeFileSync(filePath, JSON.stringify({
    bindings: {
      bad: {
        threadIdByWorkspaceRoot: [],
      },
    },
  }, null, 2), "utf8");

  const store = new SessionStore({ filePath });

  assert.deepEqual(store.listBindings(), []);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(tempRoot).some((entry) => /^sessions\.corrupt-.*\.json$/.test(entry)),
    true
  );
});

test("SessionStore round-trips pending approvals with deep normalized state", async () => {
  const { filePath } = createTempSessionFile();
  const store = new SessionStore({ filePath });
  const writer = new SessionStoreWriter(store);
  const bindingKey = store.buildBindingKey({
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
  });

  await writer.setThreadIdForWorkspace(bindingKey, "E:/repo/current", "thread-current", {
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
  });
  await writer.rememberPendingApprovalForThread("thread-current", {
    requestId: "approval-1",
    reason: "Need shell",
    command: "npm run review:weekly",
    commandTokens: ["npm", "run", "review:weekly"],
  }, {
    signature: "sig-1",
    promptedAt: "2026-04-12T00:00:00.000Z",
  });

  const reloaded = new SessionStore({ filePath });
  const binding = reloaded.getBinding(bindingKey);
  if (!binding) {
    throw new Error("expected persisted binding");
  }
  assert.deepEqual(reloaded.getBinding(bindingKey), {
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    activeWorkspaceRoot: "E:/repo/current",
    updatedAt: binding.updatedAt,
    threadIdByWorkspaceRoot: {
      "E:/repo/current": "thread-current",
    },
    threadIdByWorkspaceRootByRuntime: {
      codex: {
        "E:/repo/current": "thread-current",
      },
    },
    pendingThreadIdByWorkspaceRootByRuntime: {},
    runtimeParamsByWorkspaceRoot: {},
    runtimeParamsByWorkspaceRootByRuntime: {},
    workspaceBootstrapThreadIdByWorkspaceRoot: {
      "E:/repo/current": "",
    },
    workspaceBootstrapThreadIdByWorkspaceRootByRuntime: {
      codex: {
        "E:/repo/current": "",
      },
    },
  });
  assert.deepEqual(reloaded.getPendingApprovalForThread("thread-current"), {
    requestId: "approval-1",
    reason: "Need shell",
    command: "npm run review:weekly",
    commandTokens: ["npm", "run", "review:weekly"],
    signature: "sig-1",
    promptedAt: "2026-04-12T00:00:00.000Z",
  });
});

test("SessionStoreWriter keeps both bindings when two instances write the same file concurrently", async () => {
  const { filePath } = createTempSessionFile();
  const storeA = new SessionStore({ filePath });
  const storeB = new SessionStore({ filePath });
  const writerA = new SessionStoreWriter(storeA);
  const writerB = new SessionStoreWriter(storeB);

  await Promise.all([
    writerA.setThreadIdForWorkspace("binding-a", "E:/repo/a", "thread-a"),
    writerB.setThreadIdForWorkspace("binding-b", "E:/repo/b", "thread-b"),
  ]);

  const reloaded = new SessionStore({ filePath });
  assert.deepEqual(
    reloaded.listBindings().map((entry) => entry.bindingKey).sort((left, right) => left.localeCompare(right)),
    ["binding-a", "binding-b"]
  );
  assert.equal(reloaded.getThreadIdForWorkspace("binding-a", "E:/repo/a"), "thread-a");
  assert.equal(reloaded.getThreadIdForWorkspace("binding-b", "E:/repo/b"), "thread-b");
});

test("SessionStore read APIs refresh persisted state written by another instance", async () => {
  const { filePath } = createTempSessionFile();
  const reader = new SessionStore({ filePath });
  const writerStore = new SessionStore({ filePath });
  const writer = new SessionStoreWriter(writerStore);

  await writer.setThreadIdForWorkspace("binding-a", "E:/repo/current", "thread-current");

  assert.equal(reader.getThreadIdForWorkspace("binding-a", "E:/repo/current"), "thread-current");
  assert.deepEqual(reader.listWorkspaceRoots("binding-a"), ["E:/repo/current"]);
  assert.deepEqual(reader.findBindingForThreadId("thread-current"), {
    bindingKey: "binding-a",
    workspaceRoot: "E:/repo/current",
  });
});

test("SessionStoreWriter persists rebinding, workspace bootstrap, model params, and approval clearing", async () => {
  const { filePath } = createTempSessionFile();
  const store = new SessionStore({ filePath });
  const writer = new SessionStoreWriter(store);

  await writer.setThreadIdForWorkspace("binding-a", "E:/repo/current", "thread-current");
  await writer.rememberWorkspaceBootstrapForThread("binding-a", "E:/repo/current", "thread-current");
  await writer.setCodexParamsForWorkspace("binding-a", "E:/repo/current", { model: "gpt-5.4", effort: "high" });
  await writer.rememberPendingApprovalForThread("thread-current", {
    requestId: "approval-2",
    reason: "Need shell",
    command: "npm run review:monthly",
    commandTokens: ["npm", "run", "review:monthly"],
  }, {
    signature: "sig-2",
    promptedAt: "2026-04-13T00:00:00.000Z",
  });

  assert.equal(store.hasWorkspaceBootstrapForThread("binding-a", "E:/repo/current", "thread-current"), true);
  assert.deepEqual(store.getCodexParamsForWorkspace("binding-a", "E:/repo/current"), {
    model: "gpt-5.4",
    effort: "high",
  });
  assert.equal(store.getPendingApprovalForThread("thread-current")?.requestId, "approval-2");

  await writer.clearPendingApprovalForThread("thread-current");
  await writer.setThreadIdForWorkspace("binding-a", "E:/repo/current", "thread-rebound");

  const reloaded = new SessionStore({ filePath });
  const binding = reloaded.getBinding("binding-a");
  if (!binding) {
    throw new Error("expected rebound binding");
  }
  assert.equal(reloaded.getPendingApprovalForThread("thread-current"), null);
  assert.equal(reloaded.getThreadIdForWorkspace("binding-a", "E:/repo/current"), "thread-rebound");
  assert.equal(binding.workspaceBootstrapThreadIdByWorkspaceRoot?.["E:/repo/current"] || "", "");
});

test("SessionStore keeps thread ids, pending switches, bootstrap, and params scoped by runtime", async () => {
  const { filePath } = createTempSessionFile();
  const codexStore = new SessionStore({ filePath });
  const claudeStore = new SessionStore({ filePath, runtimeId: "claudecode" });
  const codexWriter = new SessionStoreWriter(codexStore);
  const claudeWriter = new SessionStoreWriter(claudeStore);

  await codexWriter.setThreadIdForWorkspace("binding-a", "E:/repo/current", "codex-thread");
  await codexWriter.setRuntimeParamsForWorkspace("binding-a", "E:/repo/current", {
    model: "gpt-5.4",
    effort: "high",
  });
  await claudeWriter.setThreadIdForWorkspace("binding-a", "E:/repo/current", "claude-thread");
  await claudeWriter.setRuntimeParamsForWorkspace("binding-a", "E:/repo/current", {
    model: "claude-sonnet-4-5",
  });
  await claudeWriter.setPendingThreadIdForWorkspace("binding-a", "E:/repo/current", "claude-pending");
  await claudeWriter.rememberWorkspaceBootstrapForThread("binding-a", "E:/repo/current", "claude-thread");

  const codexReloaded = new SessionStore({ filePath });
  const claudeReloaded = new SessionStore({ filePath, runtimeId: "claudecode" });

  assert.equal(codexReloaded.getThreadIdForWorkspace("binding-a", "E:/repo/current"), "codex-thread");
  assert.equal(claudeReloaded.getThreadIdForWorkspace("binding-a", "E:/repo/current"), "claude-thread");
  assert.deepEqual(codexReloaded.findBindingForThreadId("claude-thread"), null);
  assert.deepEqual(claudeReloaded.findBindingForThreadId("claude-thread"), {
    bindingKey: "binding-a",
    workspaceRoot: "E:/repo/current",
  });
  assert.deepEqual(codexReloaded.getRuntimeParamsForWorkspace("binding-a", "E:/repo/current"), {
    model: "gpt-5.4",
    effort: "high",
  });
  assert.deepEqual(claudeReloaded.getRuntimeParamsForWorkspace("binding-a", "E:/repo/current"), {
    model: "claude-sonnet-4-5",
    effort: "",
  });
  assert.equal(claudeReloaded.getPendingThreadIdForWorkspace("binding-a", "E:/repo/current"), "claude-pending");
  assert.equal(
    claudeReloaded.hasWorkspaceBootstrapForThread("binding-a", "E:/repo/current", "claude-thread"),
    true,
  );
});

test("withSessionStoreLock yields while waiting for another writer to release the lock", async () => {
  const { filePath } = createTempSessionFile();
  const lockFilePath = `${filePath}.lock`;
  fs.writeFileSync(lockFilePath, "busy\n", "utf8");

  let timerFired = false;
  const releaseTimer = setTimeout(() => {
    timerFired = true;
    fs.rmSync(lockFilePath, { force: true });
  }, 30);

  try {
    const result = await withSessionStoreLock(lockFilePath, async () => "acquired");
    assert.equal(result, "acquired");
    assert.equal(timerFired, true);
  } finally {
    clearTimeout(releaseTimer);
    fs.rmSync(lockFilePath, { force: true });
  }
});
