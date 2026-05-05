const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  PageArtifactStore,
  buildPageArtifactUri,
  parsePageArtifactUri,
}: typeof import("../src/state/page-artifacts") = require("../src/state/page-artifacts");

function makeStore() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-page-artifacts-"));
  return new PageArtifactStore({
    rootDir,
    now: () => new Date("2026-05-05T12:00:00.000Z"),
  });
}

test("page artifact store writes text pages and reads them through resource URIs", () => {
  const store = makeStore();
  const artifact = store.createTextArtifact({
    sourceKind: "mcp_tool_result",
    sourceName: "codeksei_timeline_read",
    runtimeId: "claudecode",
    workspaceRoot: "E:/workspace/current",
    bindingKey: "workspace-1:acct-1:user-1",
    threadId: "thread-1",
    userId: "user-1",
    contextToken: "ctx-1",
    pageChars: 12,
    text: "第一段。\n\n第二段。\n\n第三段。",
    metadata: { ok: true },
  });

  assert.equal(artifact.totalPages > 1, true);
  const uri = buildPageArtifactUri(artifact.id, 2);
  assert.deepEqual(parsePageArtifactUri(uri), {
    artifactId: artifact.id,
    page: 2,
  });

  const page = store.readTextResourcePage(uri);
  assert.equal(page?.artifact.id, artifact.id);
  assert.equal(page?.page, 2);
  assert.match(page?.text || "", /第二段|第三段/u);
  assert.equal(page?.previousUri, buildPageArtifactUri(artifact.id, 1));
});

test("page artifact store lists resources by runtime and workspace with opaque cursors", () => {
  const store = makeStore();
  const first = store.createTextArtifact({
    sourceKind: "mcp_tool_result",
    sourceName: "first",
    runtimeId: "claudecode",
    workspaceRoot: "E:/workspace/current",
    text: "first",
  });
  const second = store.createTextArtifact({
    sourceKind: "mcp_tool_result",
    sourceName: "second",
    runtimeId: "claudecode",
    workspaceRoot: "E:/workspace/current",
    text: "second",
  });
  store.createTextArtifact({
    sourceKind: "mcp_tool_result",
    sourceName: "other",
    runtimeId: "codex",
    workspaceRoot: "E:/workspace/current",
    text: "other",
  });

  const pageOne = store.listResources({
    runtimeId: "claudecode",
    workspaceRoot: "E:/workspace/current",
    limit: 1,
  });
  assert.equal(pageOne.resources.length, 1);
  assert.equal(pageOne.resources[0]?.uri, buildPageArtifactUri(second.id, 1));
  assert.ok(pageOne.nextCursor);

  const pageTwo = store.listResources({
    runtimeId: "claudecode",
    workspaceRoot: "E:/workspace/current",
    limit: 1,
    cursor: pageOne.nextCursor,
  });
  assert.equal(pageTwo.resources.length, 1);
  assert.equal(pageTwo.resources[0]?.uri, buildPageArtifactUri(first.id, 1));
  assert.equal(pageTwo.nextCursor, "");
});

test("page artifact store rejects oversized text artifacts", () => {
  const store = makeStore();

  assert.throws(() => store.createTextArtifact({
    sourceKind: "mcp_tool_result",
    sourceName: "too-large",
    runtimeId: "claudecode",
    workspaceRoot: "E:/workspace/current",
    text: "x".repeat(2 * 1024 * 1024 + 1),
  }), /exceeds maximum page artifact size/u);
});

test("page artifact store tracks active WeChat page pointers by binding key", () => {
  const store = makeStore();
  const artifact = store.createTextArtifact({
    sourceKind: "weixin_reply",
    sourceName: "runtime reply",
    runtimeId: "claudecode",
    workspaceRoot: "E:/workspace/current",
    bindingKey: "workspace-1:acct-1:user-1",
    text: "第一页。\n\n第二页。",
    pageChars: 8,
  });

  store.activatePointer("workspace-1:acct-1:user-1", artifact.id, 1);
  assert.deepEqual(store.getActivePointer("workspace-1:acct-1:user-1"), {
    artifactId: artifact.id,
    page: 1,
  });

  store.activatePointer("workspace-1:acct-1:user-1", artifact.id, 2);
  assert.equal(store.getActivePointer("workspace-1:acct-1:user-1")?.page, 2);
  store.clearActivePointer("workspace-1:acct-1:user-1");
  assert.equal(store.getActivePointer("workspace-1:acct-1:user-1"), null);
});
