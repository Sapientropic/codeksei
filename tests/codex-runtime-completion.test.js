const test = require("node:test");
const assert = require("node:assert/strict");

const { __testing } = require("../src/adapters/runtime/codex");

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

test("runtime turn completion follows normalized runtime events instead of raw RPC branches", async () => {
  const client = createFakeClient();
  const completion = __testing.waitForTurnCompletion(client, "thread-1");

  client.emit({
    method: "turn/start",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });
  client.emit({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      delta: "先看一下现状。",
      phase: "commentary",
    },
  });
  client.emit({
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "item-2",
        type: "agentmessage",
        content: [
          {
            type: "text",
            text: "已经处理好了。",
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
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });

  assert.deepEqual(await completion, {
    turnId: "turn-1",
    text: "已经处理好了。",
  });
});

test("runtime turn completion surfaces normalized failures", async () => {
  const client = createFakeClient();
  const completion = __testing.waitForTurnCompletion(client, "thread-1");

  client.emit({
    method: "turn/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });
  client.emit({
    method: "turn/failed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      error: {
        message: "runtime exploded",
      },
    },
  });

  await assert.rejects(completion, /runtime exploded/u);
});
