const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { CliError }: typeof import("../src/core/cli-contract") = require("../src/core/cli-contract");
const { CheckinConfigStore }: typeof import("../src/state/checkin-config-store") = require("../src/state/checkin-config-store");
const {
  runSystemCheckinTickCommand,
}: typeof import("../src/app/system-checkin-tick-cli") = require("../src/app/system-checkin-tick-cli");
const {
  runSystemCheckinTriggerCommand,
}: typeof import("../src/app/system-checkin-trigger-cli") = require("../src/app/system-checkin-trigger-cli");

function createCheckinConfigFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-checkin-trigger-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const checkinConfigFile = path.join(tempRoot, "checkin-config.json");
  new CheckinConfigStore({ filePath: checkinConfigFile }).setConfig({
    minIntervalMs: 60_000,
    maxIntervalMs: 60_000,
  });
  return {
    checkinConfigFile,
    checkinScheduleStateFile: path.join(tempRoot, "checkin-schedule-state.json"),
    sessionsFile: path.join(tempRoot, "sessions.json"),
    tempRoot,
    workspaceRoot,
  };
}

test("checkin-trigger works in hosted mode with explicit target and no bridge session", async () => {
  const fixture = createCheckinConfigFixture();

  const result = await runSystemCheckinTriggerCommand({
    channelProvider: "hermes",
    checkinConfigFile: fixture.checkinConfigFile,
    checkinScheduleStateFile: fixture.checkinScheduleStateFile,
    runtime: "hermes",
    sessionsFile: fixture.sessionsFile,
  }, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);
  const data = result.data as {
    payload: { kind: string; source: string };
    target: { senderId: string; workspaceRoot: string };
  };

  assert.equal(data.target.senderId, "wx-user");
  assert.equal(data.target.workspaceRoot, fixture.workspaceRoot);
  assert.equal(data.payload.kind, "checkin");
  assert.equal(data.payload.source, "checkin_trigger");
});

test("checkin-trigger can fall back to unique config defaults", async () => {
  const fixture = createCheckinConfigFixture();

  const result = await runSystemCheckinTriggerCommand({
    allowedUserIds: ["wx-default"],
    checkinConfigFile: fixture.checkinConfigFile,
    checkinScheduleStateFile: fixture.checkinScheduleStateFile,
    sessionsFile: fixture.sessionsFile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const data = result.data as {
    target: {
      senderId: string;
      senderSource: string;
      workspaceRoot: string;
      workspaceSource: string;
    };
  };

  assert.equal(data.target.senderId, "wx-default");
  assert.equal(data.target.senderSource, "config.allowedUserIds");
  assert.equal(data.target.workspaceRoot, fixture.workspaceRoot);
  assert.equal(data.target.workspaceSource, "config.workspaceRoot");
});

test("checkin-trigger returns target_resolution_required when sender defaults are ambiguous", async () => {
  const fixture = createCheckinConfigFixture();

  await assert.rejects(
    runSystemCheckinTriggerCommand({
      allowedUserIds: ["wx-a", "wx-b"],
      checkinConfigFile: fixture.checkinConfigFile,
      checkinScheduleStateFile: fixture.checkinScheduleStateFile,
      sessionsFile: fixture.sessionsFile,
      workspaceRoot: fixture.workspaceRoot,
    }),
    (error: unknown) => error instanceof CliError && error.code === "target_resolution_required",
  );
});

test("checkin-tick also works in hosted mode without local bridge state", async () => {
  const fixture = createCheckinConfigFixture();

  const result = await runSystemCheckinTickCommand({
    channelProvider: "hermes",
    checkinConfigFile: fixture.checkinConfigFile,
    checkinScheduleStateFile: fixture.checkinScheduleStateFile,
    runtime: "hermes",
    sessionsFile: fixture.sessionsFile,
  }, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);
  const data = result.data as {
    due: boolean;
    nextDueAt: string;
  };

  assert.equal(data.due, false);
  assert.match(String(data.nextDueAt || ""), /^\d{4}-\d{2}-\d{2}T/u);
});
