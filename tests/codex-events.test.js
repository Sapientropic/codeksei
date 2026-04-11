const test = require("node:test");
const assert = require("node:assert/strict");

const { mapCodexMessageToRuntimeEvent } = require("../src/adapters/runtime/codex/events");

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
