const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  listCodekseiMcpTools,
  resolveCodekseiMcpTool,
}: typeof import("../src/tools/mcp/tool-catalog") = require("../src/tools/mcp/tool-catalog");

const legacyBridgeName = ["cyber", "boss"].join("");

test("MCP tool catalog exposes the read toolset by default without mutations or legacy names", () => {
  const tools = listCodekseiMcpTools({ toolset: "read" });
  const names = tools.map((tool) => tool.name).sort();

  assert.deepEqual(names, [
    "codeksei_capabilities_status",
    "codeksei_context_briefing",
    "codeksei_context_inspect",
    "codeksei_project_radar",
    "codeksei_timeline_categories",
    "codeksei_timeline_proposals",
    "codeksei_timeline_read",
  ]);
  assert.ok(tools.every((tool) => tool.mutability === "read"));
  assert.ok(tools.every((tool) => !new RegExp(legacyBridgeName, "iu").test(`${tool.name} ${tool.description}`)));
});

test("MCP tool catalog gates companion and delivery mutations behind explicit toolsets", () => {
  const readNames = new Set(listCodekseiMcpTools({ toolset: "read" }).map((tool) => tool.name));
  const companionNames = new Set(listCodekseiMcpTools({ toolset: "companion" }).map((tool) => tool.name));
  const deliveryNames = new Set(listCodekseiMcpTools({ toolset: "delivery" }).map((tool) => tool.name));

  assert.equal(readNames.has("codeksei_diary_write"), false);
  assert.equal(companionNames.has("codeksei_diary_write"), true);
  assert.equal(companionNames.has("codeksei_channel_send_file"), false);
  assert.equal(deliveryNames.has("codeksei_channel_send_file"), true);
});

test("MCP tool catalog refuses raw runner and long-running command exposure", () => {
  const tools = listCodekseiMcpTools({ toolset: "delivery" });
  const forbidden = new Set(["login", "start", "shared:start", "timeline:serve", "timeline:dev"]);

  for (const tool of tools) {
    assert.equal(tool.commandTokens.some((token) => forbidden.has(token)), false, `${tool.name} should not expose ${tool.commandTokens.join(" ")}`);
    assert.notEqual(tool.mutability, "long_running", `${tool.name} should not be long-running`);
  }
  assert.equal(resolveCodekseiMcpTool("codeksei_timeline_serve", { toolset: "delivery" }), null);
});
