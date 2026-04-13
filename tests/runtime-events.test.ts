const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  RUNTIME_EVENT_TYPES,
  buildApprovalCommandPreview,
  isRuntimeFirstProgressEventType,
  isRuntimeReplyEventType,
  normalizeRuntimeCommandTokens,
  normalizeRuntimeEventPayload,
} = require("../src/contracts/runtime-events");

test("runtime event helpers normalize command tokens and preview quoted arguments", () => {
  assert.deepEqual(
    normalizeRuntimeCommandTokens(["npm", 42, " run ", "", "hello world"]),
    ["npm", "run", "hello world"],
  );
  assert.equal(
    buildApprovalCommandPreview(["npm", "run", "hello world"]),
    'npm run "hello world"',
  );
});

test("runtime usage payload reads thread and turn ids from nested fallbacks", () => {
  const payload = normalizeRuntimeEventPayload(RUNTIME_EVENT_TYPES.USAGE_UPDATED, {
    info: {
      thread: { id: "thread-nested" },
      turn: { id: "turn-nested" },
      total_token_usage: {
        input_tokens: "11",
        total_tokens: "22",
      },
      last_token_usage: {
        output_tokens: 7,
      },
    },
    rate_limits: {
      primary: { used_percent: "8" },
      secondary: { used_percent: 3 },
    },
  });

  assert.deepEqual(payload, {
    threadId: "thread-nested",
    turnId: "turn-nested",
    totalInputTokens: 11,
    totalCachedInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningTokens: 0,
    totalTokens: 22,
    lastInputTokens: 0,
    lastCachedInputTokens: 0,
    lastOutputTokens: 7,
    lastReasoningTokens: 0,
    lastTotalTokens: 0,
    modelContextWindow: 0,
    primaryUsedPercent: 8,
    secondaryUsedPercent: 3,
  });
});

test("runtime event type guards keep usage out of reply and progress checks", () => {
  assert.equal(isRuntimeReplyEventType(RUNTIME_EVENT_TYPES.REPLY_COMPLETED), true);
  assert.equal(isRuntimeReplyEventType(RUNTIME_EVENT_TYPES.USAGE_UPDATED), false);
  assert.equal(isRuntimeFirstProgressEventType(RUNTIME_EVENT_TYPES.TURN_STARTED), true);
  assert.equal(isRuntimeFirstProgressEventType(RUNTIME_EVENT_TYPES.USAGE_UPDATED), false);
});
