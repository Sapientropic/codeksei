const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { CheckinConfigStore }: typeof import("../src/state/checkin-config-store") = require("../src/state/checkin-config-store");
const {
  CHECKIN_ACTIVE_WAKE_TIMEOUT_MS,
  CHECKIN_HANDOFF_TIMEOUT_MS,
  runCheckinComplete,
  runCheckinCreateHandoff,
  runCheckinTick,
}: typeof import("../src/checkin") = require("../src/checkin");
const {
  CheckinScheduleStateStore,
}: typeof import("../src/state/checkin-schedule-state-store") = require("../src/state/checkin-schedule-state-store");

function createTickFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-checkin-tick-"));
  const checkinConfigFile = path.join(tempRoot, "checkin-config.json");
  new CheckinConfigStore({ filePath: checkinConfigFile }).setConfig({
    minIntervalMs: 60_000,
    maxIntervalMs: 60_000,
  });
  return {
    config: {
      checkinConfigFile,
      checkinScheduleStateFile: path.join(tempRoot, "checkin-schedule-state.json"),
      userName: "Tester",
    },
    tempRoot,
  };
}

function createTarget() {
  return {
    senderId: "wx-user",
    senderSource: "explicit_user",
    workspaceRoot: "E:/repo/current",
    workspaceSource: "explicit_workspace",
  };
}

test("checkin tick uses scheduled -> due -> in_progress -> complete semantics", () => {
  const fixture = createTickFixture();
  const target = createTarget();
  const startMs = Date.parse("2026-04-14T10:00:00Z");

  const first = runCheckinTick({
    config: fixture.config,
    nowMs: startMs,
    target,
  });
  assert.equal(first.status, "scheduled");
  assert.equal(first.due, false);
  assert.equal(first.nextWakeAt, "2026-04-14T10:01:00.000Z");
  assert.equal(first.nextDueAt, "2026-04-14T10:01:00.000Z");

  const due = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 60_000,
    target,
  });
  assert.equal(due.status, "due");
  assert.equal(due.due, true);
  assert.ok(due.payload?.triggerId);

  const repeated = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 61_000,
    target,
  });
  assert.equal(repeated.status, "due");
  assert.equal(repeated.payload?.triggerId, due.payload?.triggerId);
  assert.equal(repeated.payload?.text, due.payload?.text);

  const acked = runCheckinTick({
    ack: String(due.payload?.triggerId || ""),
    config: fixture.config,
    nowMs: startMs + 62_000,
    target,
  });
  assert.equal(acked.acknowledged, true);
  assert.equal(acked.status, "in_progress");
  assert.equal(acked.due, false);
  assert.equal(acked.activeWake?.triggerId, due.payload?.triggerId);
  assert.equal(acked.nextWakeAt, "");

  const inProgress = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 63_000,
    target,
  });
  assert.equal(inProgress.status, "in_progress");
  assert.equal(inProgress.activeWake?.triggerId, due.payload?.triggerId);

  const completed = runCheckinComplete({
    config: fixture.config,
    nowMs: startMs + 64_000,
    result: "silent",
    sleepFor: "2h",
    target,
    triggerId: String(due.payload?.triggerId || ""),
  });
  assert.equal(completed.completion.result, "silent");
  assert.equal(completed.completion.scheduleSource, "agent");
  assert.equal(completed.nextWakeAt, "2026-04-14T12:01:04.000Z");
  assert.equal(completed.nextDueAt, "2026-04-14T12:01:04.000Z");

  const scheduledAgain = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 65_000,
    target,
  });
  assert.equal(scheduledAgain.status, "scheduled");
  assert.equal(scheduledAgain.nextWakeAt, "2026-04-14T12:01:04.000Z");
});

test("checkin tick recovers timed-out active wake with a fallback schedule", () => {
  const fixture = createTickFixture();
  const target = createTarget();
  const startMs = Date.parse("2026-04-14T10:00:00Z");

  runCheckinTick({
    config: fixture.config,
    nowMs: startMs,
    target,
  });
  const due = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 60_000,
    target,
  });
  const acked = runCheckinTick({
    ack: String(due.payload?.triggerId || ""),
    config: fixture.config,
    nowMs: startMs + 61_000,
    target,
  });
  assert.equal(acked.status, "in_progress");

  const recovered = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 61_000 + 31 * 60_000,
    target,
  });
  assert.equal(recovered.status, "scheduled");
  assert.equal(recovered.state.scheduleSource, "recovery");
  assert.equal(recovered.activeWake, null);
  assert.equal(recovered.nextWakeAt, "2026-04-14T10:33:01.000Z");
});

test("checkin tick auto-finalizes an expired pending handoff through recovery", () => {
  const fixture = createTickFixture();
  const target = createTarget();
  const startMs = Date.parse("2026-04-14T10:00:00Z");

  runCheckinTick({
    config: fixture.config,
    nowMs: startMs,
    target,
  });
  const due = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 60_000,
    target,
  });
  runCheckinTick({
    ack: String(due.payload?.triggerId || ""),
    config: fixture.config,
    nowMs: startMs + 61_000,
    target,
  });
  const store = new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile });
  const current = store.getState();
  assert.ok(current);
  store.setState({
    ...current,
    pendingHandoff: {
      bookkeepingActions: [],
      followupContext: "回主会话后确认是否继续。",
      handoffCreatedAt: new Date(startMs + 62_000).toISOString(),
      handoffExpiresAt: new Date(startMs + 63_000).toISOString(),
      observedCurrentState: "最近在改 hosted proactive。",
      outcome: "silent",
      triggerId: String(due.payload?.triggerId || ""),
      userVisibleMessage: "",
    },
  });

  const recovered = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 64_000,
    target,
  });
  assert.equal(recovered.status, "scheduled");
  assert.equal(recovered.state.pendingHandoff, null);
  assert.equal(recovered.state.lastCompletion?.result, "silent");
  assert.equal(recovered.state.lastCompletion?.scheduleSource, "recovery");
});

test("checkin handoff survives active-wake timeout and only auto-finalizes after handoff expiry", () => {
  const fixture = createTickFixture();
  const target = createTarget();
  const startMs = Date.parse("2026-04-14T10:00:00Z");

  runCheckinTick({
    config: fixture.config,
    nowMs: startMs,
    target,
  });
  const due = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 60_000,
    target,
  });
  const acked = runCheckinTick({
    ack: String(due.payload?.triggerId || ""),
    config: fixture.config,
    nowMs: startMs + 61_000,
    target,
  });
  const handoff = runCheckinCreateHandoff({
    config: fixture.config,
    followupContext: "主会话回来后先确认这条线是否还在继续。",
    nowMs: startMs + 62_000,
    observedCurrentState: "最近还在改 hosted proactive。",
    result: "silent",
    target,
    triggerId: String(acked.activeWake?.triggerId || ""),
  });
  assert.equal(handoff.state.activeWake, null);
  assert.equal(handoff.state.pendingHandoff?.triggerId, due.payload?.triggerId);

  const beforeExpiry = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 62_000 + CHECKIN_ACTIVE_WAKE_TIMEOUT_MS + 1_000,
    target,
  });
  assert.equal(beforeExpiry.status, "scheduled");
  assert.equal(beforeExpiry.state.activeWake, null);
  assert.equal(beforeExpiry.state.pendingHandoff?.triggerId, due.payload?.triggerId);
  assert.equal(beforeExpiry.state.lastCompletion, null);

  const recovered = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 62_000 + CHECKIN_HANDOFF_TIMEOUT_MS + 1_000,
    target,
  });
  assert.equal(recovered.status, "scheduled");
  assert.equal(recovered.state.pendingHandoff, null);
  assert.equal(recovered.state.lastCompletion?.result, "silent");
  assert.equal(recovered.state.lastCompletion?.scheduleSource, "recovery");
});

test("checkin complete clamps overlong next wake to the 24h guardrail", () => {
  const fixture = createTickFixture();
  const target = createTarget();
  const startMs = Date.parse("2026-04-14T10:00:00Z");

  runCheckinTick({
    config: fixture.config,
    nowMs: startMs,
    target,
  });
  const due = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 60_000,
    target,
  });
  runCheckinTick({
    ack: String(due.payload?.triggerId || ""),
    config: fixture.config,
    nowMs: startMs + 61_000,
    target,
  });

  const completed = runCheckinComplete({
    config: fixture.config,
    nextWakeAt: "2026-04-20T10:00:00.000Z",
    nowMs: startMs + 62_000,
    result: "backstage_only",
    target,
    triggerId: String(due.payload?.triggerId || ""),
  });
  assert.equal(completed.completion.scheduleSource, "guardrail_clamped");
  assert.equal(completed.nextWakeAt, "2026-04-15T10:01:02.000Z");
});

test("checkin schedule state store still accepts legacy nextDueAt state", () => {
  const fixture = createTickFixture();
  const filePath = fixture.config.checkinScheduleStateFile;
  fs.writeFileSync(filePath, JSON.stringify({
    lastConfirmedAt: "2026-04-14T09:00:00.000Z",
    nextDueAt: "2026-04-14T10:05:00.000Z",
    pendingTrigger: null,
    senderId: "wx-user",
    targetKey: "wx-user::E:/repo/current",
    updatedAt: "2026-04-14T09:00:00.000Z",
    workspaceRoot: "E:/repo/current",
  }, null, 2), "utf8");

  const state = new CheckinScheduleStateStore({ filePath }).getState();
  assert.ok(state);
  assert.equal(state.nextWakeAt, "2026-04-14T10:05:00.000Z");
  assert.equal(state.scheduleSource, "fallback");
});

test("checkin schedule state store quarantines invalid state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-checkin-schedule-state-"));
  const filePath = path.join(tempRoot, "checkin-schedule-state.json");
  fs.writeFileSync(filePath, JSON.stringify({ pendingTrigger: { triggerId: 123 } }, null, 2), "utf8");

  const store = new CheckinScheduleStateStore({ filePath });

  assert.equal(store.getState(), null);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(tempRoot).some((entry) => /^checkin-schedule-state\.corrupt-.*\.json$/.test(entry)),
    true,
  );
});
