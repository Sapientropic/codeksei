const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeReminderQueueEntry,
  normalizeSystemMessage,
  normalizeTimelineScreenshotJob,
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
