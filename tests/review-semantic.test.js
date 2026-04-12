const test = require("node:test");
const assert = require("node:assert/strict");

const { __testing } = require("../src/core/review-semantic");

function createFakeClient() {
  let listener = null;
  return {
    onMessage(nextListener) {
      listener = nextListener;
      return () => {
        if (listener === nextListener) {
          listener = null;
        }
      };
    },
    emit(message) {
      if (typeof listener === "function") {
        listener(message);
      }
    },
  };
}

test("semantic review completion consumes normalized runtime reply events", async () => {
  const client = createFakeClient();
  const completion = __testing.waitForSemanticTurnCompletion(client, "thread-semantic", 1_000);

  client.emit({
    method: "turn/start",
    params: {
      threadId: "thread-semantic",
      turnId: "turn-semantic",
    },
  });
  client.emit({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-semantic",
      turnId: "turn-semantic",
      itemId: "item-1",
      delta: '{"progress":[',
      phase: "final",
    },
  });
  client.emit({
    method: "item/completed",
    params: {
      threadId: "thread-semantic",
      turnId: "turn-semantic",
      item: {
        id: "item-1",
        type: "agentmessage",
        content: [
          {
            type: "text",
            text: '{"progress":["done"]}',
          },
        ],
        metadata: {
          phase: "final_answer",
        },
      },
    },
  });
  client.emit({
    method: "turn/completed",
    params: {
      threadId: "thread-semantic",
      turnId: "turn-semantic",
    },
  });

  assert.equal(await completion, '{"progress":["done"]}');
});

test("semantic review rejects normalized approval requests instead of waiting forever", async () => {
  const client = createFakeClient();
  const completion = __testing.waitForSemanticTurnCompletion(client, "thread-semantic", 1_000);

  client.emit({
    method: "turn/started",
    params: {
      threadId: "thread-semantic",
      turnId: "turn-semantic",
    },
  });
  client.emit({
    method: "shell/requestApproval",
    params: {
      threadId: "thread-semantic",
      reason: "Need shell access",
      command: ["npm", "run", "review:weekly"],
    },
  });

  await assert.rejects(completion, /semantic review requested approval/u);
});
