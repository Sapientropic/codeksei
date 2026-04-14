const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeReminderQueueEntry,
  normalizeSystemMessage,
  normalizeTimelineScreenshotJob,
  reminderQueueStateSchema,
  systemMessageDeadLetterStateSchema,
  systemMessageQueueStateSchema,
  timelineScreenshotQueueStateSchema,
} = require("../src/contracts/queue-items");

test("system message contract normalizes delivery metadata", () => {
  const normalized = normalizeSystemMessage({
    id: "msg-1",
    accountId: "acct-1",
    senderId: "user-1",
    workspaceRoot: "E:/repo/current",
    text: "后台消息",
    kind: "manual",
    createdAt: "2026-04-12T00:00:00.000Z",
    deliveryState: "in_flight",
    inFlightAt: "",
  });

  assert.deepEqual(normalized, {
    id: "msg-1",
    accountId: "acct-1",
    checkinTriggerId: "",
    senderId: "user-1",
    workspaceRoot: "E:/repo/current",
    text: "后台消息",
    kind: "manual",
    attemptCount: 0,
    lastAttemptAt: "",
    nextAttemptAt: "2026-04-12T00:00:00.000Z",
    expiresAt: "2026-04-13T00:00:00.000Z",
    lastFailureReason: "",
    deliveryState: "pending",
    inFlightAt: "",
    createdAt: "2026-04-12T00:00:00.000Z",
  });
});

test("system message contract clamps invalid numeric and timestamp edge cases", () => {
  const normalized = normalizeSystemMessage({
    id: "msg-edge",
    accountId: "acct-1",
    senderId: "user-1",
    workspaceRoot: "E:/repo/current",
    text: "后台消息",
    kind: "manual",
    createdAt: "2026-04-12T00:00:00.000Z",
    attemptCount: "-5",
    lastAttemptAt: "not-a-date",
    nextAttemptAt: "Infinity",
    expiresAt: "bad-value",
    deliveryState: "in_flight",
    inFlightAt: "still-bad",
  });

  assert.deepEqual(normalized, {
    id: "msg-edge",
    accountId: "acct-1",
    checkinTriggerId: "",
    senderId: "user-1",
    workspaceRoot: "E:/repo/current",
    text: "后台消息",
    kind: "manual",
    attemptCount: 0,
    lastAttemptAt: "",
    nextAttemptAt: "2026-04-12T00:00:00.000Z",
    expiresAt: "2026-04-13T00:00:00.000Z",
    lastFailureReason: "",
    deliveryState: "pending",
    inFlightAt: "",
    createdAt: "2026-04-12T00:00:00.000Z",
  });
});

test("timeline screenshot queue contract normalizes args and output file", () => {
  const normalized = normalizeTimelineScreenshotJob({
    id: "shot-1",
    accountId: "acct-1",
    senderId: "user-1",
    outputFile: "C:/tmp/shot.png",
    args: ["--selector", "timeline", ""],
    createdAt: "2026-04-12T00:00:00.000Z",
  });

  assert.deepEqual(normalized, {
    id: "shot-1",
    accountId: "acct-1",
    senderId: "user-1",
    outputFile: "C:/tmp/shot.png",
    args: ["--selector", "timeline"],
    createdAt: "2026-04-12T00:00:00.000Z",
  });
});

test("reminder queue contract normalizes due time and created timestamp", () => {
  const normalized = normalizeReminderQueueEntry({
    id: "reminder-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text: "起身喝水",
    dueAtMs: "1712908800000",
    createdAt: "2026-04-12T00:00:00.000Z",
  });

  assert.deepEqual(normalized, {
    id: "reminder-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text: "起身喝水",
    dueAtMs: 1712908800000,
    createdAt: "2026-04-12T00:00:00.000Z",
  });
});

test("system message queue schema canonicalizes legacy queue payloads at ingress", () => {
  const parsed = systemMessageQueueStateSchema.safeParse({
    retained: true,
    messages: [{
      id: "reminder:legacy",
      accountId: "acct-1",
      senderId: "user-1",
      workspaceRoot: "E:/repo/current",
      text: "Reminder trigger",
      createdAt: "2026-04-12T00:00:00.000Z",
      deliveryState: "in_flight",
      inFlightAt: "",
    }],
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.retained, true);
  assert.deepEqual(parsed.data.messages, [{
    id: "reminder:legacy",
    accountId: "acct-1",
    checkinTriggerId: "",
    senderId: "user-1",
    workspaceRoot: "E:/repo/current",
    text: "Reminder trigger",
    kind: "reminder",
    attemptCount: 0,
    lastAttemptAt: "",
    nextAttemptAt: "2026-04-12T00:00:00.000Z",
    expiresAt: "2026-04-13T00:00:00.000Z",
    lastFailureReason: "",
    deliveryState: "pending",
    inFlightAt: "",
    createdAt: "2026-04-12T00:00:00.000Z",
  }]);
});

test("system message dead letter schema canonicalizes legacy entries at ingress", () => {
  const parsed = systemMessageDeadLetterStateSchema.safeParse({
    retained: true,
    entries: [{
      id: "dead-letter-1",
      accountId: "acct-1",
      senderId: "user-1",
      workspaceRoot: "E:/repo/current",
      text: "后台消息",
      createdAt: "2026-04-12T00:00:00.000Z",
      deadLetterReason: "",
      deadLetterAt: "2026-04-12T01:00:00.000Z",
      deliveryState: "in_flight",
      inFlightAt: "",
    }],
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.retained, true);
  assert.deepEqual(parsed.data.entries, [{
    id: "dead-letter-1",
    accountId: "acct-1",
    checkinTriggerId: "",
    senderId: "user-1",
    workspaceRoot: "E:/repo/current",
    text: "后台消息",
    kind: "manual",
    attemptCount: 0,
    lastAttemptAt: "",
    nextAttemptAt: "2026-04-12T00:00:00.000Z",
    expiresAt: "2026-04-13T00:00:00.000Z",
    lastFailureReason: "",
    deliveryState: "pending",
    inFlightAt: "",
    createdAt: "2026-04-12T00:00:00.000Z",
    deadLetterReason: "dead_letter",
    deadLetterAt: "2026-04-12T01:00:00.000Z",
  }]);
});

test("timeline screenshot queue schema canonicalizes legacy queue payloads at ingress", () => {
  const parsed = timelineScreenshotQueueStateSchema.safeParse({
    retained: true,
    jobs: [{
      id: "shot-1",
      accountId: "acct-1",
      senderId: "user-1",
      outputFile: "C:/tmp/shot.png",
      args: ["--selector", "timeline", ""],
      createdAt: "2026-04-12T00:00:00.000Z",
    }],
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.retained, true);
  assert.deepEqual(parsed.data.jobs, [{
    id: "shot-1",
    accountId: "acct-1",
    senderId: "user-1",
    outputFile: "C:/tmp/shot.png",
    args: ["--selector", "timeline"],
    createdAt: "2026-04-12T00:00:00.000Z",
  }]);
});

test("reminder queue schema canonicalizes legacy queue payloads at ingress", () => {
  const parsed = reminderQueueStateSchema.safeParse({
    retained: true,
    reminders: [{
      id: "reminder-1",
      accountId: "acct-1",
      senderId: "user-1",
      contextToken: "ctx-1",
      text: "起身喝水",
      dueAtMs: "1712908800000",
      createdAt: "2026-04-12T00:00:00.000Z",
    }],
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.retained, true);
  assert.deepEqual(parsed.data.reminders, [{
    id: "reminder-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text: "起身喝水",
    dueAtMs: 1712908800000,
    createdAt: "2026-04-12T00:00:00.000Z",
  }]);
});
