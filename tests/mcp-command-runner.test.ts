const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const {
  buildCodekseiMcpToolInvocation,
  formatCodekseiMcpToolResult,
}: typeof import("../src/tools/mcp/command-runner") = require("../src/tools/mcp/command-runner");
const {
  PageArtifactStore,
}: typeof import("../src/state/page-artifacts") = require("../src/state/page-artifacts");

const cliEntrypoint = path.posix.join("E:/repo/codeksei", "dist", "src", "index.js");

test("MCP command runner builds JSON-envelope CLI invocations from allowlisted tools", () => {
  const invocation = buildCodekseiMcpToolInvocation("codeksei_timeline_read", {
    date: "2026-04-05",
  }, {
    cliEntrypoint,
    nodeCommand: "node",
    workspaceRoot: "E:/repo/workspace",
  });

  assert.deepEqual(invocation.argv, [
    cliEntrypoint,
    "--format",
    "json",
    "--workspace-root",
    "E:/repo/workspace",
    "timeline",
    "read",
    "--date",
    "2026-04-05",
  ]);
  assert.equal(invocation.stdin, "");
});

test("MCP command runner sends larger body fields through subprocess stdin", () => {
  const invocation = buildCodekseiMcpToolInvocation("codeksei_diary_write", {
    date: "2026-04-05",
    section: "supplement",
    text: "一段需要进入 stdin 的正文",
    title: "MCP",
  }, {
    cliEntrypoint,
    nodeCommand: "node",
    workspaceRoot: "E:/repo/workspace",
  });

  assert.ok(invocation.argv.includes("--stdin"));
  assert.equal(invocation.argv.includes("--text"), false);
  assert.equal(invocation.stdin, "一段需要进入 stdin 的正文");
});

test("MCP result formatter exposes long command output as a paged MCP resource", () => {
  const store = new PageArtifactStore({
    rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-mcp-runner-pages-")),
    now: () => new Date("2026-05-05T12:00:00.000Z"),
  });
  const formatted = formatCodekseiMcpToolResult({
    stdout: JSON.stringify({ ok: true, data: { body: "x".repeat(12000) } }),
    stderr: "",
    status: 0,
  }, {
    maxChars: 500,
    pageArtifactStore: store,
    runtimeId: "claudecode",
    toolName: "codeksei_timeline_read",
    workspaceRoot: "E:/repo/workspace",
  });

  assert.equal(formatted.isError, false);
  assert.equal(formatted.truncated, true);
  assert.match(formatted.text, /codeksei:\/\/mcp\/tool-result\//u);
  assert.equal(formatted.content.some((block) => block.type === "resource_link"), true);
  const link = formatted.content.find((block) => block.type === "resource_link");
  assert.ok(link && "uri" in link);
  const nextPage = store.readTextResourcePage(String(link?.uri || "").replace(/page=1/u, "page=2"));
  assert.equal(nextPage?.page, 2);
});
