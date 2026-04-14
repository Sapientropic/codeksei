const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { SessionStore }: typeof import("../src/adapters/runtime/codex/session-store") = require("../src/adapters/runtime/codex/session-store");
const { CheckinConfigStore }: typeof import("../src/state/checkin-config-store") = require("../src/state/checkin-config-store");
const {
  processBridgeCheckinPollerIteration,
  runCheckinComplete,
} = require("../src/checkin");

function createPollerFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-checkin-poller-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const checkinConfigFile = path.join(tempRoot, "checkin-config.json");
  new CheckinConfigStore({ filePath: checkinConfigFile }).setConfig({
    minIntervalMs: 60_000,
    maxIntervalMs: 60_000,
  });
  return {
    config: {
      allowedUserIds: ["wx-user"],
      checkinConfigFile,
      checkinScheduleStateFile: path.join(tempRoot, "checkin-schedule-state.json"),
      sessionsFile: path.join(tempRoot, "sessions.json"),
      systemMessageDeadLetterFile: path.join(tempRoot, "system-message-dead-letter.json"),
      systemMessageQueueFile: path.join(tempRoot, "system-message-queue.json"),
      userName: "Tester",
      workspaceRoot,
      workspaceId: "default",
    },
    tempRoot,
  };
}

test("bridge checkin poller keeps pending trigger until queue drains and only acks after enqueue", () => {
  const fixture = createPollerFixture();
  const sessionStore = new SessionStore({ filePath: fixture.config.sessionsFile });
  const enqueued: Array<Record<string, unknown>> = [];
  const startMs = Date.parse("2026-04-14T10:00:00Z");

  const initial = processBridgeCheckinPollerIteration({
    accountId: "acct-1",
    config: fixture.config,
    nowMs: startMs,
    queueStore: {
      enqueue(message: Record<string, unknown>) {
        enqueued.push(message);
      },
      hasPendingForAccount() {
        return false;
      },
    },
    sessionStore,
  });
  assert.equal(initial.action, "waiting");
  assert.equal(initial.tick.nextWakeAt, "2026-04-14T10:01:00.000Z");

  const blocked = processBridgeCheckinPollerIteration({
    accountId: "acct-1",
    config: fixture.config,
    nowMs: startMs + 60_000,
    queueStore: {
      enqueue(message: Record<string, unknown>) {
        enqueued.push(message);
      },
      hasPendingForAccount() {
        return true;
      },
    },
    sessionStore,
  });
  assert.equal(blocked.action, "waiting_for_queue");
  assert.ok(blocked.tick.payload?.triggerId);
  assert.equal(enqueued.length, 0);

  const flushed = processBridgeCheckinPollerIteration({
    accountId: "acct-1",
    config: fixture.config,
    nowMs: startMs + 60_000,
    queueStore: {
      enqueue(message: Record<string, unknown>) {
        enqueued.push(message);
      },
      hasPendingForAccount() {
        return false;
      },
    },
    sessionStore,
  });
  assert.equal(flushed.action, "enqueue_and_ack");
  assert.equal(flushed.tick.acknowledged, true);
  assert.equal(flushed.tick.status, "in_progress");
  assert.equal(flushed.tick.activeWake?.triggerId, blocked.tick.payload?.triggerId);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]?.kind, "checkin");
  assert.equal(enqueued[0]?.checkinTriggerId, blocked.tick.payload?.triggerId);
});

test("bridge checkin poller does not schedule the next wake until completion is recorded", () => {
  const fixture = createPollerFixture();
  const sessionStore = new SessionStore({ filePath: fixture.config.sessionsFile });
  const startMs = Date.parse("2026-04-14T10:00:00Z");

  processBridgeCheckinPollerIteration({
    accountId: "acct-1",
    config: fixture.config,
    nowMs: startMs,
    queueStore: {
      enqueue() {},
      hasPendingForAccount() {
        return false;
      },
    },
    sessionStore,
  });
  const queued = processBridgeCheckinPollerIteration({
    accountId: "acct-1",
    config: fixture.config,
    nowMs: startMs + 60_000,
    queueStore: {
      enqueue() {},
      hasPendingForAccount() {
        return false;
      },
    },
    sessionStore,
  });
  assert.equal(queued.tick.status, "in_progress");
  assert.equal(queued.tick.nextWakeAt, "");

  const waiting = processBridgeCheckinPollerIteration({
    accountId: "acct-1",
    config: fixture.config,
    nowMs: startMs + 61_000,
    queueStore: {
      enqueue() {},
      hasPendingForAccount() {
        return false;
      },
    },
    sessionStore,
  });
  assert.equal(waiting.action, "waiting");
  assert.equal(waiting.tick.status, "in_progress");
  assert.equal(waiting.tick.nextWakeAt, "");

  runCheckinComplete({
    config: fixture.config,
    nowMs: startMs + 62_000,
    result: "silent",
    sleepFor: "2h",
    target: waiting.tick.target,
    triggerId: String(waiting.tick.activeWake?.triggerId || ""),
  });

  const afterComplete = processBridgeCheckinPollerIteration({
    accountId: "acct-1",
    config: fixture.config,
    nowMs: startMs + 63_000,
    queueStore: {
      enqueue() {},
      hasPendingForAccount() {
        return false;
      },
    },
    sessionStore,
  });
  assert.equal(afterComplete.action, "waiting");
  assert.equal(afterComplete.tick.status, "scheduled");
  assert.equal(afterComplete.tick.nextWakeAt, "2026-04-14T12:01:02.000Z");
});
