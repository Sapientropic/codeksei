const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { CliError }: typeof import("../src/core/cli-contract") = require("../src/core/cli-contract");
const { CheckinConfigStore }: typeof import("../src/state/checkin-config-store") = require("../src/state/checkin-config-store");
const {
  runSystemCheckinCompleteCommand,
}: typeof import("../src/app/system-checkin-complete-cli") = require("../src/app/system-checkin-complete-cli");
const {
  runCheckinTick,
}: typeof import("../src/checkin") = require("../src/checkin");
const {
  runSystemCheckinTickCommand,
}: typeof import("../src/app/system-checkin-tick-cli") = require("../src/app/system-checkin-tick-cli");
const {
  runSystemCheckinTriggerCommand,
}: typeof import("../src/app/system-checkin-trigger-cli") = require("../src/app/system-checkin-trigger-cli");
const { createFakeHermesRepoLocalFixture } = require("./helpers/fake-hermes-repo-local.ts");

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
  const hostedConfig: Parameters<typeof runSystemCheckinTriggerCommand>[0] = {
    channelProvider: "hermes",
    checkinConfigFile: fixture.checkinConfigFile,
    checkinScheduleStateFile: fixture.checkinScheduleStateFile,
    runtime: "hermes",
    sessionsFile: fixture.sessionsFile,
  };

  const result = await runSystemCheckinTriggerCommand(hostedConfig, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);
  const data = result.data as {
    payload: { kind: string; source: string; text: string };
    target: { senderId: string; workspaceRoot: string };
  };

  assert.equal(data.target.senderId, "wx-user");
  assert.equal(data.target.workspaceRoot, fixture.workspaceRoot);
  assert.equal(data.payload.kind, "checkin");
  assert.equal(data.payload.source, "checkin_trigger");
  assert.doesNotMatch(data.payload.text, /checkin-complete/u);
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
  const hostedConfig: Parameters<typeof runSystemCheckinTickCommand>[0] = {
    channelProvider: "hermes",
    checkinConfigFile: fixture.checkinConfigFile,
    checkinScheduleStateFile: fixture.checkinScheduleStateFile,
    runtime: "hermes",
    sessionsFile: fixture.sessionsFile,
  };

  const result = await runSystemCheckinTickCommand(hostedConfig, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);
  const data = result.data as {
    due: boolean;
    nextDueAt: string;
    nextWakeAt: string;
    status: string;
  };

  assert.equal(data.due, false);
  assert.equal(data.status, "scheduled");
  assert.match(String(data.nextWakeAt || ""), /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(data.nextDueAt, data.nextWakeAt);
});

test("checkin-complete writes the next wake after tick ack", async () => {
  const fixture = createCheckinConfigFixture();
  const baseConfig: Parameters<typeof runSystemCheckinCompleteCommand>[0] = {
    channelProvider: "hermes",
    checkinConfigFile: fixture.checkinConfigFile,
    checkinScheduleStateFile: fixture.checkinScheduleStateFile,
    runtime: "hermes",
    sessionsFile: fixture.sessionsFile,
  };
  const target = {
    senderId: "wx-user",
    senderSource: "explicit_user",
    workspaceRoot: fixture.workspaceRoot,
    workspaceSource: "explicit_workspace",
  };
  // Keep the active wake within the 30-minute timeout window so this test
  // keeps asserting tick -> ack -> complete semantics instead of depending on
  // when the suite happens to run in real time.
  const completionNowMs = Date.now();
  const startMs = completionNowMs - 2 * 60_000;

  runCheckinTick({
    config: baseConfig,
    nowMs: startMs,
    target,
  });
  const due = runCheckinTick({
    config: baseConfig,
    nowMs: startMs + 60_000,
    target,
  });
  assert.ok(due.payload?.triggerId);
  const acked = runCheckinTick({
    ack: due.payload?.triggerId,
    config: baseConfig,
    nowMs: startMs + 61_000,
    target,
  });
  assert.equal(acked.status, "in_progress");

  const completed = await runSystemCheckinCompleteCommand(baseConfig, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--trigger", due.payload.triggerId,
    "--result", "silent",
    "--sleep-for", "6h",
  ]);
  const completionData = completed.data as {
    completion: { result: string; scheduleSource: string };
    nextWakeAt: string;
    nextDueAt: string;
  };

  assert.equal(completionData.completion.result, "silent");
  assert.equal(completionData.completion.scheduleSource, "agent");
  assert.match(String(completionData.nextWakeAt || ""), /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(completionData.nextDueAt, completionData.nextWakeAt);
});

test("checkin-complete rejects missing or invalid result values", async () => {
  const fixture = createCheckinConfigFixture();

  await assert.rejects(
    runSystemCheckinCompleteCommand({
      checkinConfigFile: fixture.checkinConfigFile,
      checkinScheduleStateFile: fixture.checkinScheduleStateFile,
      sessionsFile: fixture.sessionsFile,
    }, [
      "--user", "wx-user",
      "--workspace", fixture.workspaceRoot,
      "--trigger", "trigger-1",
      "--result", "bad-value",
      "--sleep-for", "6h",
    ]),
    (error: unknown) => error instanceof CliError && error.code === "validation_error",
  );
});

test("hosted checkin-complete re-arms the next wake and clears future recovery jobs", async () => {
  const fixture = createCheckinConfigFixture();
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-checkin-complete-hosted-"))
  );
  const baseConfig: Parameters<typeof runSystemCheckinCompleteCommand>[0] = {
    channelProvider: "hermes",
    runtime: "hermes",
    checkinConfigFile: fixture.checkinConfigFile,
    checkinScheduleStateFile: fixture.checkinScheduleStateFile,
    sessionsFile: fixture.sessionsFile,
    hermesHome: repoLocal.hermesHome,
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
  };
  const target = {
    senderId: "wx-user",
    senderSource: "explicit_user",
    workspaceRoot: fixture.workspaceRoot,
    workspaceSource: "explicit_workspace",
  };
  const startMs = Date.now() - 120_000;
  runCheckinTick({
    config: baseConfig,
    nowMs: startMs,
    target,
  });
  const due = runCheckinTick({
    config: baseConfig,
    nowMs: startMs + 60_000,
    target,
  });
  runCheckinTick({
    ack: String(due.payload?.triggerId || ""),
    config: baseConfig,
    nowMs: startMs + 61_000,
    target,
  });
  fs.writeFileSync(repoLocal.jobsFile, JSON.stringify({
    jobs: [{
      id: "cron-old-recovery",
      name: "ck-checkin-recovery-test",
      next_run_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      enabled: true,
      state: "scheduled",
      deliver: "origin",
      codeksei_checkin_target_key: `wx-user::${fixture.workspaceRoot}`,
      codeksei_checkin_role: "recovery",
    }],
    updated_at: new Date().toISOString(),
  }, null, 2), "utf8");

  const result = await runSystemCheckinCompleteCommand(baseConfig, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--trigger", String(due.payload?.triggerId || ""),
    "--result", "silent",
    "--sleep-for", "6h",
  ]);

  assert.equal(result.ok, true);
  const data = result.data as {
    hostedWakeSync: { jobId: string; removedJobIds: string[]; role: string };
  };
  assert.equal(data.hostedWakeSync.role, "wake");
  assert.equal(data.hostedWakeSync.jobId.startsWith("cron-"), true);
  assert.deepEqual(data.hostedWakeSync.removedJobIds, ["cron-old-recovery"]);
  const jobsState = JSON.parse(fs.readFileSync(repoLocal.jobsFile, "utf8"));
  assert.equal(jobsState.jobs.length, 1);
  assert.equal(jobsState.jobs[0].codeksei_checkin_role, "wake");
  assert.equal(jobsState.jobs[0].deliver, "origin");
  assert.equal(jobsState.jobs[0].env.CODEKSEI_RUNTIME, "hermes");
  assert.equal(jobsState.jobs[0].env.CODEKSEI_STATE_DIR, fixture.tempRoot);
  assert.deepEqual(jobsState.jobs[0].origin, {
    platform: "weixin",
    chat_id: "wxid_sender",
    chat_name: "Test Chat",
    thread_id: "",
  });
});
