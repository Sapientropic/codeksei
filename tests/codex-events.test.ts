const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  RUNTIME_CORE_CONSUMER_EXPECTATIONS,
  RUNTIME_EVENT_TYPE_LIST,
}: {
  RUNTIME_CORE_CONSUMER_EXPECTATIONS: Record<string, string[]>;
  RUNTIME_EVENT_TYPE_LIST: string[];
} = require("../src/contracts/runtime-events");
const { mapCodexMessageToRuntimeEvent } = require("../src/adapters/runtime/codex/events");
const {
  extractAssistantSnapshotText,
}: typeof import("../src/adapters/runtime/codex/message-utils") = require("../src/adapters/runtime/codex/message-utils");

test("codex runtime delta events keep commentary phase", () => {
  const event = mapCodexMessageToRuntimeEvent({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      delta: "我先去看一下。",
      phase: "commentary",
    },
  });

  assert.deepEqual(event, {
    type: "runtime.reply.delta",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      text: "我先去看一下。",
      fragmentKind: "delta",
      phase: "commentary",
    },
  });
});

test("codex runtime delta events classify snapshot resends separately", () => {
  const event = mapCodexMessageToRuntimeEvent({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-2",
      item: {
        id: "item-2",
        text: "我先看了一圈，先把现状告诉你。",
      },
      phase: "commentary",
    },
  });

  assert.deepEqual(event, {
    type: "runtime.reply.delta",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-2",
      text: "我先看了一圈，先把现状告诉你。",
      fragmentKind: "snapshot",
      phase: "commentary",
    },
  });
});

test("codex runtime completed assistant items normalize final_answer phase", () => {
  const event = mapCodexMessageToRuntimeEvent({
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "item-1",
        type: "agentmessage",
        content: [
          {
            type: "text",
            text: "已经修好了。",
          },
        ],
        metadata: {
          phase: "final_answer",
        },
      },
    },
  });

  assert.deepEqual(event, {
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      text: "已经修好了。",
      phase: "final",
    },
  });
});

test("codex runtime snapshot extraction preserves English word boundaries without forcing CJK spacing", () => {
  const text = extractAssistantSnapshotText({
    item: {
      content: [
        { type: "text", text: "I" },
        { type: "text", text: "'m" },
        { type: "text", text: "switching" },
        { type: "text", text: "to" },
        { type: "text", text: "English" },
        { type: "text", text: "now," },
        { type: "text", text: "and" },
        { type: "text", text: "I" },
        { type: "text", text: "'m" },
        { type: "text", text: "keeping" },
        { type: "text", text: "state" },
        { type: "text", text: "-" },
        { type: "text", text: "of" },
        { type: "text", text: "-" },
        { type: "text", text: "the" },
        { type: "text", text: "-" },
        { type: "text", text: "art" },
        { type: "text", text: "中文" },
        { type: "text", text: "English" },
      ],
    },
  });

  assert.equal(
    text,
    "I'm switching to English now, and I'm keeping state-of-the-art中文English",
  );
});

test("codex runtime delta snapshot content preserves closing bracket and word boundaries", () => {
  const event = mapCodexMessageToRuntimeEvent({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-english-snapshot",
      itemId: "item-3",
      item: {
        id: "item-3",
        content: [
          { type: "text", text: "already" },
          { type: "text", text: "fixed" },
          { type: "text", text: ")" },
          { type: "text", text: "Next" },
          { type: "text", text: "step" },
        ],
      },
      phase: "final_answer",
    },
  });

  assert.deepEqual(event, {
    type: "runtime.reply.delta",
    payload: {
      threadId: "thread-1",
      turnId: "turn-english-snapshot",
      itemId: "item-3",
      text: "already fixed) Next step",
      fragmentKind: "snapshot",
      phase: "final",
    },
  });
});

test("codex runtime completed assistant items preserve split English spacing", () => {
  const event = mapCodexMessageToRuntimeEvent({
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-english-completed",
      item: {
        id: "item-4",
        type: "agentmessage",
        content: [
          { type: "text", text: "I" },
          { type: "text", text: "'m" },
          { type: "text", text: "switching" },
          { type: "text", text: "now," },
          { type: "text", text: "and" },
          { type: "text", text: "I" },
          { type: "text", text: "'m" },
          { type: "text", text: "back." },
        ],
        metadata: {
          phase: "final_answer",
        },
      },
    },
  });

  assert.deepEqual(event, {
    type: "runtime.reply.completed",
    payload: {
      threadId: "thread-1",
      turnId: "turn-english-completed",
      itemId: "item-4",
      text: "I'm switching now, and I'm back.",
      phase: "final",
    },
  });
});

test("codex runtime usage events keep thread scoped usage facts when present", () => {
  const event = mapCodexMessageToRuntimeEvent({
    type: "event_msg",
    payload: {
      type: "token_count",
      thread_id: "thread-usage",
      turn_id: "turn-usage",
      info: {
        total_token_usage: {
          total_tokens: 2048,
        },
        last_token_usage: {
          total_tokens: 256,
        },
        model_context_window: 200000,
      },
      rate_limits: {
        primary: { used_percent: 12 },
      },
    },
  });

  assert.deepEqual(event, {
    type: "runtime.usage.updated",
    payload: {
      threadId: "thread-usage",
      turnId: "turn-usage",
      totalInputTokens: 0,
      totalCachedInputTokens: 0,
      totalOutputTokens: 0,
      totalReasoningTokens: 0,
      totalTokens: 2048,
      lastInputTokens: 0,
      lastCachedInputTokens: 0,
      lastOutputTokens: 0,
      lastReasoningTokens: 0,
      lastTotalTokens: 256,
      modelContextWindow: 200000,
      primaryUsedPercent: 12,
      secondaryUsedPercent: 0,
    },
  });
});

test("codex runtime approval requests normalize request id and command preview", () => {
  const event = mapCodexMessageToRuntimeEvent({
    id: 123,
    method: "shell/requestApproval",
    params: {
      threadId: "thread-approval",
      reason: "Need shell access",
      command: ["npm", "run", "review:weekly"],
    },
  });

  assert.deepEqual(event, {
    type: "runtime.approval.requested",
    payload: {
      threadId: "thread-approval",
      requestId: "123",
      reason: "Need shell access",
      command: "npm run review:weekly",
      commandTokens: ["npm", "run", "review:weekly"],
      signature: "",
      promptedAt: "",
    },
  });
});

test("codex runtime mapper ignores unknown methods", () => {
  assert.equal(
    mapCodexMessageToRuntimeEvent({
      method: "workspace/refreshed",
      params: {
        threadId: "thread-1",
      },
    }),
    null
  );
});

test("runtime contract declares explicit consumer coverage for every defined event", () => {
  const allTypes = new Set(RUNTIME_EVENT_TYPE_LIST);
  for (const [consumer, expectedTypes] of Object.entries(RUNTIME_CORE_CONSUMER_EXPECTATIONS)) {
    assert.ok(expectedTypes.length > 0, `${consumer} should declare at least one runtime event`);
    for (const eventType of expectedTypes) {
      assert.ok(allTypes.has(eventType), `${consumer} declares unknown runtime event ${eventType}`);
    }
  }
  assert.deepEqual(
    new Set(RUNTIME_CORE_CONSUMER_EXPECTATIONS.threadStateStore),
    allTypes
  );
  assert.deepEqual(
    new Set(RUNTIME_CORE_CONSUMER_EXPECTATIONS.runtimeWatchdogLifecycle),
    allTypes
  );
});
