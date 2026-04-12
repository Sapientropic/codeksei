const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const { SessionStore }: typeof import("../src/adapters/runtime/codex/session-store") = require("../src/adapters/runtime/codex/session-store");

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

test("SessionStore round-trips pending approvals with deep normalized state", () => {
  const { filePath } = createTempSessionFile();
  const store = new SessionStore({ filePath });
  const bindingKey = store.buildBindingKey({
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
  });

  store.setThreadIdForWorkspace(bindingKey, "E:/repo/current", "thread-current", {
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
  });
  store.rememberPendingApprovalForThread("thread-current", {
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
    codexParamsByWorkspaceRoot: {},
    workspaceBootstrapThreadIdByWorkspaceRoot: {
      "E:/repo/current": "",
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

test("SessionStore keeps both bindings when two instances write the same file in sequence", () => {
  const { filePath } = createTempSessionFile();
  const storeA = new SessionStore({ filePath });
  const storeB = new SessionStore({ filePath });

  storeA.setThreadIdForWorkspace("binding-a", "E:/repo/a", "thread-a");
  storeB.setThreadIdForWorkspace("binding-b", "E:/repo/b", "thread-b");

  const reloaded = new SessionStore({ filePath });
  assert.deepEqual(
    reloaded.listBindings().map((entry) => entry.bindingKey).sort((left, right) => left.localeCompare(right)),
    ["binding-a", "binding-b"]
  );
  assert.equal(reloaded.getThreadIdForWorkspace("binding-a", "E:/repo/a"), "thread-a");
  assert.equal(reloaded.getThreadIdForWorkspace("binding-b", "E:/repo/b"), "thread-b");
});

test("SessionStore read APIs refresh persisted state written by another instance", () => {
  const { filePath } = createTempSessionFile();
  const reader = new SessionStore({ filePath });
  const writer = new SessionStore({ filePath });

  writer.setThreadIdForWorkspace("binding-a", "E:/repo/current", "thread-current");

  assert.equal(reader.getThreadIdForWorkspace("binding-a", "E:/repo/current"), "thread-current");
  assert.deepEqual(reader.listWorkspaceRoots("binding-a"), ["E:/repo/current"]);
  assert.deepEqual(reader.findBindingForThreadId("thread-current"), {
    bindingKey: "binding-a",
    workspaceRoot: "E:/repo/current",
  });
});
