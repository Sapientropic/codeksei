const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { CheckinConfigStore }: typeof import("../src/state/checkin-config-store") = require("../src/state/checkin-config-store");
const {
  runCheckinTick,
}: typeof import("../src/core/checkin-core") = require("../src/core/checkin-core");
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

test("checkin tick creates the first nextDueAt, reuses pending trigger, and advances after ack", () => {
  const fixture = createTickFixture();
  const target = {
    senderId: "wx-user",
    senderSource: "explicit_user",
    workspaceRoot: "E:/repo/current",
    workspaceSource: "explicit_workspace",
  };
  const startMs = Date.parse("2026-04-14T10:00:00Z");

  const first = runCheckinTick({
    config: fixture.config,
    nowMs: startMs,
    target,
  });
  assert.equal(first.due, false);
  assert.equal(first.nextDueAt, "2026-04-14T10:01:00.000Z");

  const due = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 60_000,
    target,
  });
  assert.equal(due.due, true);
  assert.ok(due.payload?.triggerId);

  const repeated = runCheckinTick({
    config: fixture.config,
    nowMs: startMs + 61_000,
    target,
  });
  assert.equal(repeated.due, true);
  assert.equal(repeated.payload?.triggerId, due.payload?.triggerId);
  assert.equal(repeated.payload?.text, due.payload?.text);

  const acked = runCheckinTick({
    ack: String(due.payload?.triggerId || ""),
    config: fixture.config,
    nowMs: startMs + 62_000,
    target,
  });
  assert.equal(acked.acknowledged, true);
  assert.equal(acked.due, false);
  assert.equal(acked.nextDueAt, "2026-04-14T10:02:02.000Z");
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
