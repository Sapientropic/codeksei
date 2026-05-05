const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const {
  createCodekseiMcpRequestHandlers,
}: typeof import("../src/tools/mcp/server") = require("../src/tools/mcp/server");
const {
  PageArtifactStore,
  buildPageArtifactUri,
}: typeof import("../src/state/page-artifacts") = require("../src/state/page-artifacts");

test("MCP request handlers expose initialize and tool listing without mutating state", async () => {
  const handlers = createCodekseiMcpRequestHandlers({
    toolset: "read",
    invokeTool: async () => ({ content: [{ type: "text", text: "not called" }] }),
  });

  const initialized = await handlers.initialize({ protocolVersion: "2024-11-05" });
  const listed = await handlers.listTools();

  assert.equal(initialized.serverInfo.name, "codeksei-tools");
  assert.deepEqual(initialized.capabilities.resources, { listChanged: false });
  assert.equal(listed.tools.some((tool) => tool.name === "codeksei_context_inspect"), true);
  assert.equal(listed.tools.some((tool) => tool.name === "codeksei_diary_write"), false);
});

test("MCP request handlers route known tool calls and reject unknown tools", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const handlers = createCodekseiMcpRequestHandlers({
    toolset: "read",
    invokeTool: async (name, args) => {
      calls.push({ name, args });
      return { content: [{ type: "text", text: "ok" }] };
    },
  });

  const result = await handlers.callTool("codeksei_timeline_read", { date: "2026-04-05" });
  assert.deepEqual(result, { content: [{ type: "text", text: "ok" }] });
  assert.deepEqual(calls, [{ name: "codeksei_timeline_read", args: { date: "2026-04-05" } }]);

  await assert.rejects(
    () => handlers.callTool("codeksei_timeline_serve", {}),
    /Unknown Codeksei MCP tool/u,
  );
});

test("MCP request handlers expose paged tool-result resources scoped to runtime and workspace", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-mcp-server-pages-"));
  const store = new PageArtifactStore({
    rootDir,
    now: () => new Date("2026-05-05T12:00:00.000Z"),
  });
  const artifact = store.createTextArtifact({
    sourceKind: "mcp_tool_result",
    sourceName: "codeksei_timeline_read",
    runtimeId: "claudecode",
    workspaceRoot: "E:/workspace/current",
    text: "第一页。\n\n第二页。\n\n第三页。",
    pageChars: 8,
  });
  store.createTextArtifact({
    sourceKind: "mcp_tool_result",
    sourceName: "other-runtime",
    runtimeId: "codex",
    workspaceRoot: "E:/workspace/current",
    text: "hidden",
  });

  const handlers = createCodekseiMcpRequestHandlers({
    pageArtifactStore: store,
    runtimeId: "claudecode",
    workspaceRoot: "E:/workspace/current",
  });

  const listed = await handlers.listResources({ limit: 1 });
  assert.equal(listed.resources.length, 1);
  assert.equal(listed.resources[0]?.uri, buildPageArtifactUri(artifact.id, 1));
  const read = await handlers.readResource(buildPageArtifactUri(artifact.id, 2));
  const readContent = read.contents[0] as { text?: string; uri?: string } | undefined;
  assert.equal(readContent?.uri, buildPageArtifactUri(artifact.id, 2));
  assert.match(readContent?.text || "", /第二页|第三页/u);
  assert.equal(read._meta?.artifactId, artifact.id);
  const templates = await handlers.listResourceTemplates();
  assert.equal(templates.resourceTemplates[0]?.uriTemplate, "codeksei://mcp/tool-result/{artifactId}?page={page}");

  await assert.rejects(() => handlers.listResources({ cursor: "not-base64" }), /Invalid resource cursor/u);
  await assert.rejects(() => handlers.readResource("codeksei://mcp/tool-result/missing?page=1"), /Unknown Codeksei MCP resource/u);
});
