const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const path: typeof import("node:path") = require("node:path");

const {
  buildCodekseiMcpBootstrapPlan,
}: typeof import("../src/tools/mcp/bootstrap") = require("../src/tools/mcp/bootstrap");

test("MCP bootstrap defaults to a non-mutating local Claude MCP add command", () => {
  const plan = buildCodekseiMcpBootstrapPlan({
    packageRoot: "E:/repo/codeksei",
    workspaceRoot: "E:/repo/workspace",
  });

  assert.equal(plan.scope, "local");
  assert.equal(plan.install, false);
  assert.equal(plan.writesProjectConfig, false);
  assert.deepEqual(plan.commandArgv.slice(0, 6), ["claude", "mcp", "add", "--scope", "local", "codeksei_tools"]);
  assert.ok(plan.commandArgv.includes("tool"));
  assert.ok(plan.commandArgv.includes("mcp-server"));
  assert.ok(plan.commandArgv.includes("--toolset"));
  assert.ok(plan.commandArgv.includes("read"));
  assert.match(plan.text, /不会写 workspace \.mcp\.json/u);
});

test("MCP bootstrap requires an explicit project-config override before project install", () => {
  assert.throws(
    () => buildCodekseiMcpBootstrapPlan({
      install: true,
      packageRoot: "E:/repo/codeksei",
      scope: "project",
      workspaceRoot: "E:/repo/workspace",
    }),
    /--allow-project-config/u,
  );

  const plan = buildCodekseiMcpBootstrapPlan({
    allowProjectConfig: true,
    install: true,
    packageRoot: "E:/repo/codeksei",
    scope: "project",
    workspaceRoot: "E:/repo/workspace",
  });
  assert.equal(plan.writesProjectConfig, true);
  assert.deepEqual(plan.commandArgv.slice(0, 5), ["claude", "mcp", "add", "--scope", "project"]);
});

test("MCP bootstrap resolves the published CLI entrypoint for Windows-safe node invocation", () => {
  const plan = buildCodekseiMcpBootstrapPlan({
    nodeCommand: "C:/Program Files/nodejs/node.exe",
    packageRoot: "E:/repo/codeksei",
    workspaceRoot: "E:/repo/workspace",
    toolset: "companion",
  });
  const nodeIndex = plan.commandArgv.indexOf("--") + 1;

  assert.equal(plan.commandArgv[nodeIndex], "C:/Program Files/nodejs/node.exe");
  assert.equal(path.basename(plan.commandArgv[nodeIndex + 1] || ""), "index.js");
  assert.ok(plan.commandArgv.includes("companion"));
});
