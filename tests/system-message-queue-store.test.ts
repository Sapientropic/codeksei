const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { SystemMessageQueueStore } = require("../src/core/system-message-queue-store");

function createStore() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-system-queue-"));
  return {
    tempRoot,
    queueFile: path.join(tempRoot, "system-message-queue.json"),
    deadLetterFile: path.join(tempRoot, "system-message-dead-letter.json"),
    store: new SystemMessageQueueStore({
      filePath: path.join(tempRoot, "system-message-queue.json"),
      deadLetterFilePath: path.join(tempRoot, "system-message-dead-letter.json"),
    }),
  };
}

function buildMessage(overrides = {}) {
  return {
    id: "msg-1",
    accountId: "acct-1",
    senderId: "user-1",
    workspaceRoot: "E:/workspace",
    text: "Take a quiet look at whether now is a good moment to reach out to Sam.",
    createdAt: "2026-04-12T08:00:00.000Z",
    ...overrides,
  };
}

test("SystemMessageQueueStore infers legacy metadata and only drains ready messages", () => {
  const { store } = createStore();
  const nowMs = Date.parse("2026-04-12T08:00:00.000Z");

  store.enqueue(buildMessage({
    id: "legacy-checkin",
  }));
  store.enqueue(buildMessage({
    id: "reminder:future",
    text: "Reminder trigger",
    nextAttemptAt: "2026-04-12T08:05:00.000Z",
  }));

  const ready = store.takeReadyForAccount("acct-1", { nowMs });
  assert.deepEqual(ready.map((entry: any) => entry.id), ["legacy-checkin"]);
  assert.equal(ready[0].kind, "checkin");
  assert.equal(ready[0].attemptCount, 0);
  assert.equal(ready[0].deliveryState, "in_flight");
  assert.equal(store.hasPendingForAccount("acct-1", { nowMs }), true);
  store.complete(ready[0], { nowMs });

  const futureReady = store.takeReadyForAccount("acct-1", {
    nowMs: Date.parse("2026-04-12T08:05:00.000Z"),
  });
  assert.deepEqual(futureReady.map((entry: any) => entry.id), ["reminder:future"]);
  assert.equal(futureReady[0].kind, "reminder");
});

test("SystemMessageQueueStore expires stale pending messages and moves them to dead letter", () => {
  const { store } = createStore();
  const nowMs = Date.parse("2026-04-12T09:00:00.000Z");

  store.enqueue(buildMessage({
    id: "expired-checkin",
    createdAt: "2026-04-12T08:00:00.000Z",
    expiresAt: "2026-04-12T08:30:00.000Z",
  }));

  assert.equal(store.hasPendingForAccount("acct-1", { nowMs }), false);
  const deadLetters = store.listDeadLetters();
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].id, "expired-checkin");
  assert.equal(deadLetters[0].deadLetterReason, "expired");
});

test("SystemMessageQueueStore defers busy messages without incrementing attempts", () => {
  const { store } = createStore();
  const nowMs = Date.parse("2026-04-12T10:00:00.000Z");

  store.enqueue(buildMessage({
    id: "busy-message",
    kind: "manual",
    text: "后台手动消息",
    createdAt: "2026-04-12T10:00:00.000Z",
  }));

  const [message] = store.takeReadyForAccount("acct-1", { nowMs });
  const deferred = store.defer(message, {
    delayMs: 30_000,
    reason: "thread_running",
    countAttempt: false,
    nowMs,
  });

  assert.equal(deferred.status, "deferred");
  assert.equal(deferred.message.attemptCount, 0);
  assert.equal(deferred.message.lastFailureReason, "thread_running");
  assert.equal(deferred.message.deliveryState, "pending");
  assert.deepEqual(store.takeReadyForAccount("acct-1", { nowMs }), []);
  assert.equal(
    store.takeReadyForAccount("acct-1", { nowMs: nowMs + 30_000 }).length,
    1
  );
});

test("SystemMessageQueueStore dead-letters retryable errors after the attempt ceiling", () => {
  const { store } = createStore();
  const nowMs = Date.parse("2026-04-12T11:00:00.000Z");

  store.enqueue(buildMessage({
    id: "max-attempt-checkin",
    attemptCount: 2,
    createdAt: "2026-04-12T11:00:00.000Z",
    expiresAt: "2026-04-12T11:30:00.000Z",
  }));

  const [message] = store.takeReadyForAccount("acct-1", { nowMs });
  const result = store.defer(message, {
    delayMs: 30_000,
    reason: "runtime_send_failed",
    countAttempt: true,
    nowMs,
  });

  assert.equal(result.status, "dead_letter");
  const deadLetters = store.listDeadLetters();
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].id, "max-attempt-checkin");
  assert.equal(deadLetters[0].deadLetterReason, "runtime_send_failed");
});

test("SystemMessageQueueStore keeps leased ready messages recoverable across a restart", () => {
  const { deadLetterFile, queueFile, store } = createStore();
  const nowMs = Date.parse("2026-04-12T12:00:00.000Z");

  store.enqueue(buildMessage({
    id: "leased-message",
    kind: "manual",
    text: "后台消息",
    createdAt: "2026-04-12T12:00:00.000Z",
  }));

  const [ready] = store.takeReadyForAccount("acct-1", { nowMs });
  assert.equal(ready.deliveryState, "in_flight");

  const restartedStore = new SystemMessageQueueStore({
    filePath: queueFile,
    deadLetterFilePath: deadLetterFile,
  });
  assert.deepEqual(restartedStore.takeReadyForAccount("acct-1", { nowMs: nowMs + 1_000 }), []);

  const retried = restartedStore.takeReadyForAccount("acct-1", { nowMs: nowMs + 61_000 });
  assert.deepEqual(retried.map((entry: any) => entry.id), ["leased-message"]);
});

test("SystemMessageQueueStore records dead-letter before removing the live queue entry", () => {
  const { deadLetterFile, queueFile, store } = createStore();
  const nowMs = Date.parse("2026-04-12T13:00:00.000Z");

  store.enqueue(buildMessage({
    id: "dead-letter-order",
    kind: "manual",
    text: "后台消息",
    createdAt: "2026-04-12T13:00:00.000Z",
  }));

  const originalPersistMessages = store.persistMessages.bind(store);
  store.persistMessages = () => {
    throw new Error("queue write failed after dead-letter save");
  };

  assert.throws(
    () => store.deadLetter({ id: "dead-letter-order" }, { reason: "forced_failure", nowMs }),
    /queue write failed/
  );

  const recoveredQueue = new SystemMessageQueueStore({
    filePath: queueFile,
    deadLetterFilePath: deadLetterFile,
  });
  assert.equal(recoveredQueue.hasPendingForAccount("acct-1", { nowMs }), true);
  assert.equal(recoveredQueue.listDeadLetters().some((entry: any) => entry.id === "dead-letter-order"), true);

  store.persistMessages = originalPersistMessages;
});
