const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createReplyTargetRegistry,
} = require("../src/core/stream-delivery/reply-target-registry");

test("reply target registry consumes queued thread targets in FIFO order", () => {
  const registry = createReplyTargetRegistry({
    sessionStore: {
      findBindingForThreadId() {
        return null;
      },
    },
  });

  registry.queueReplyTargetForThread("thread-1", {
    userId: "user-1",
    contextToken: "ctx-1",
    provider: "weixin",
  });
  registry.queueReplyTargetForThread("thread-1", {
    userId: "user-2",
    contextToken: "ctx-2",
    provider: "weixin",
  });

  const first = { threadId: "thread-1", bindingKey: "", replyTarget: null };
  const second = { threadId: "thread-1", bindingKey: "", replyTarget: null };
  const third = { threadId: "thread-1", bindingKey: "", replyTarget: null };

  registry.attachReplyTarget(first);
  registry.attachReplyTarget(second);
  registry.attachReplyTarget(third);

  assert.deepEqual(first.replyTarget, {
    userId: "user-1",
    contextToken: "ctx-1",
    provider: "weixin",
  });
  assert.deepEqual(second.replyTarget, {
    userId: "user-2",
    contextToken: "ctx-2",
    provider: "weixin",
  });
  assert.equal(third.replyTarget, null);
});

test("reply target registry restores binding key and falls back to binding target after queue drain", () => {
  const registry = createReplyTargetRegistry({
    sessionStore: {
      findBindingForThreadId(threadId) {
        return threadId === "thread-2" ? { bindingKey: "binding-2" } : null;
      },
    },
  });

  registry.setReplyTarget("binding-2", {
    userId: "bound-user",
    contextToken: "bound-ctx",
    provider: "weixin",
  });
  registry.queueReplyTargetForThread("thread-2", {
    userId: "queued-user",
    contextToken: "queued-ctx",
    provider: "weixin",
  });

  const queuedState = { threadId: "thread-2", bindingKey: "", replyTarget: null };
  registry.attachReplyTarget(queuedState);

  assert.equal(queuedState.bindingKey, "binding-2");
  assert.deepEqual(queuedState.replyTarget, {
    userId: "queued-user",
    contextToken: "queued-ctx",
    provider: "weixin",
  });

  const reboundState = { threadId: "thread-2", bindingKey: "", replyTarget: null };
  registry.attachReplyTarget(reboundState);

  assert.equal(reboundState.bindingKey, "binding-2");
  assert.deepEqual(reboundState.replyTarget, {
    userId: "bound-user",
    contextToken: "bound-ctx",
    provider: "weixin",
  });
});
