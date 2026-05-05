const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  mapClaudeCodeMessageToRuntimeEvent,
}: typeof import("../src/adapters/runtime/claudecode/events") = require("../src/adapters/runtime/claudecode/events");

test("Claude Code event mapper converts assistant text into completed runtime replies", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "reply.completed",
    sessionId: "thread-claude",
    turnId: "turn-1",
    text: "已处理。",
  });

  assert.deepEqual(event, {
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-claude",
      turnId: "turn-1",
      itemId: "item-turn-1",
      text: "已处理。",
      phase: "",
    },
  });
});

test("Claude Code event mapper normalizes tool approval requests", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "approval.requested",
    sessionId: "thread-approval",
    turnId: "turn-approval",
    requestId: 42,
    toolName: "Bash",
    input: {
      command: "npm run check",
      description: "Run validation",
    },
  });

  assert.deepEqual(event, {
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread-approval",
      requestId: "42",
      reason: "Tool: Bash",
      command: "Bash\ncommand: \"npm run check\"\ndescription: \"Run validation\"",
      commandTokens: ["Bash", "npm", "run", "check"],
      signature: "",
      promptedAt: "",
    },
  });
});

test("Claude Code event mapper renders Codeksei MCP tool names readably", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "approval.requested",
    sessionId: "thread-approval",
    turnId: "turn-approval",
    requestId: "req-mcp",
    toolName: "mcp__codeksei_tools__codeksei_timeline_read",
    input: {
      date: "2026-04-05",
    },
  });

  assert.equal(event?.payload.reason, "Tool: codeksei_timeline_read");
  assert.match(String(event?.payload.command || ""), /^codeksei_timeline_read/u);
  assert.deepEqual(event?.payload.commandTokens, ["codeksei_timeline_read"]);
});

test("Claude Code context usage maps onto the shared runtime usage event", () => {
  const event = mapClaudeCodeMessageToRuntimeEvent({
    type: "context.updated",
    sessionId: "thread-usage",
    turnId: "turn-usage",
    modelContextWindow: 200000,
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 30,
      output_tokens: 40,
    },
  });

  assert.deepEqual(event, {
    type: "runtime.usage.updated",
    payload: {
      threadId: "thread-usage",
      turnId: "turn-usage",
      totalInputTokens: 60,
      totalCachedInputTokens: 50,
      totalOutputTokens: 40,
      totalReasoningTokens: 0,
      totalTokens: 100,
      lastInputTokens: 60,
      lastCachedInputTokens: 50,
      lastOutputTokens: 40,
      lastReasoningTokens: 0,
      lastTotalTokens: 100,
      modelContextWindow: 200000,
      primaryUsedPercent: 0,
      secondaryUsedPercent: 0,
    },
  });
});
