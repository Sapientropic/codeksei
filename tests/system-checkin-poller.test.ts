const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { SessionStore }: typeof import("../src/adapters/runtime/codex/session-store") = require("../src/adapters/runtime/codex/session-store");
const { CheckinConfigStore }: typeof import("../src/state/checkin-config-store") = require("../src/state/checkin-config-store");
const {
  processBridgeCheckinPollerIteration,
} = require("../src/core/checkin-core");

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
  assert.equal(initial.tick.nextDueAt, "2026-04-14T10:01:00.000Z");

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
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]?.kind, "checkin");
});
