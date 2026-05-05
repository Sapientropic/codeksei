const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildClaudeCodeArgs,
  filterClaudeCodeEnv,
  isPotentiallySensitiveClaudeCodeText,
}: typeof import("../src/adapters/runtime/claudecode/process-client") = require("../src/adapters/runtime/claudecode/process-client");

test("Claude Code process args enable stream-json stdio and safe runtime flags", () => {
  const args = buildClaudeCodeArgs({
    disableVerbose: false,
    extraArgs: ["--debug", "-c", "danger", "-e", "also-danger"],
    mcpConfigPaths: ["E:/mcp.json"],
    model: "claude-sonnet-4-5",
    permissionMode: "acceptEdits",
    resumeSessionId: "123e4567-e89b-12d3-a456-426614174000",
    strictMcpConfig: true,
  });

  assert.deepEqual(args, [
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--permission-prompt-tool",
    "stdio",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--resume",
    "123e4567-e89b-12d3-a456-426614174000",
    "--model",
    "claude-sonnet-4-5",
    "--mcp-config",
    "E:/mcp.json",
    "--strict-mcp-config",
    "--debug",
  ]);
});

test("Claude Code env filter removes the recursive CLAUDECODE marker only", () => {
  assert.deepEqual(filterClaudeCodeEnv({
    CLAUDECODE: "1",
    KEEP_ME: "yes",
  }), {
    KEEP_ME: "yes",
  });
});

test("Claude Code stderr sensitivity detector catches common secret shapes", () => {
  assert.equal(isPotentiallySensitiveClaudeCodeText("plain warning"), false);
  assert.equal(isPotentiallySensitiveClaudeCodeText("api key sk-secret12345678901234567890"), true);
  assert.equal(isPotentiallySensitiveClaudeCodeText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"), true);
});
