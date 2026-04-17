const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  runHermesInstallSkillCommand,
  runHermesSmokeCommand,
  runHermesStatusCommand,
  runHermesSyncCheckinCommand,
} = require("../src/app/hermes-operator-cli");
const { CheckinScheduleStateStore } = require("../src/state/checkin-schedule-state-store");
const { CheckinConfigStore } = require("../src/state/checkin-config-store");
const { createFakeHermesCommand } = require("./helpers/fake-hermes-command.ts");
const {
  createFakeHermesRepoLocalFixture,
} = require("./helpers/fake-hermes-repo-local.ts");

function createHostedCheckinFixture(prefix: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

test("operator hermes install-skill installs and syncs the companion skill", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-install-"));
  const hermesHome = path.join(tempRoot, ".hermes");

  const result = await runHermesInstallSkillCommand({
    hermesHome,
    runtime: "hermes",
    channelProvider: "hermes",
  });

  assert.equal(result.data.installedSkill.exists, true);
  assert.equal(result.data.installedSkill.inSync, true);
  assert.equal(fs.existsSync(result.data.installedPath), true);
});

test("operator hermes install-skill dry-run previews side effects without writing files", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-install-dry-run-"));
  const hermesHome = path.join(tempRoot, ".hermes");

  const result = await runHermesInstallSkillCommand({
    hermesHome,
    runtime: "hermes",
    channelProvider: "hermes",
  }, ["--dry-run"]);

  assert.equal(result.meta.dryRun, true);
  assert.equal(result.data.willWrite, true);
  assert.equal(fs.existsSync(path.join(hermesHome, "skills", "codeksei-companion", "SKILL.md")), false);
});

test("operator hermes status reports catalog and semantic availability", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-status-"));
  const hermesHome = path.join(tempRoot, ".hermes");
  const accountsDir = path.join(hermesHome, "weixin", "accounts");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-status-repo-local-"))
  );
  fs.mkdirSync(accountsDir, { recursive: true });
  fs.writeFileSync(path.join(accountsDir, "acct-1.json"), JSON.stringify({ accountId: "acct-1" }), "utf8");

  const { commandPath } = createFakeHermesCommand(tempRoot);
  await runHermesInstallSkillCommand({
    hermesHome,
    runtime: "hermes",
    channelProvider: "hermes",
  });

  const result = await runHermesStatusCommand({
    hermesHome,
    hermesCommand: commandPath,
    reviewSemanticHost: "hermes",
    runtime: "hermes",
    channelProvider: "hermes",
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
    workspaceRoot: tempRoot,
  });

  assert.equal(result.data.hostProfile.profile, "hosted-mode");
  assert.equal(result.data.hermes.installedSkill.inSync, true);
  assert.equal(result.data.hermes.repoLocal.ready, true);
  assert.equal(result.data.skillCatalog.listed, true);
  assert.equal(result.data.hermes.semanticReview.available, true);
  assert.match(result.text, /repo_local: ready/u);
});

test("operator hermes smoke returns partial when hosted prerequisites are missing", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-smoke-"));
  const result = await runHermesSmokeCommand({
    hermesHome: path.join(tempRoot, ".hermes"),
    runtime: "hermes",
    channelProvider: "hermes",
  });

  assert.equal(result.ok, "partial");
  assert.equal(result.data.ok, false);
  assert.match(result.data.checks.weixinAccounts.reason, /Weixin/u);
});

test("operator hermes sync-checkin creates a wake job for scheduled hosted checkins", async () => {
  const fixture = createHostedCheckinFixture("codeksei-hermes-sync-wake-");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-sync-wake-repo-local-"))
  );

  const result = await runHermesSyncCheckinCommand({
    runtime: "hermes",
    channelProvider: "hermes",
    checkinConfigFile: fixture.checkinConfigFile,
    checkinScheduleStateFile: fixture.checkinScheduleStateFile,
    sessionsFile: fixture.sessionsFile,
    workspaceRoot: fixture.workspaceRoot,
    hermesHome: repoLocal.hermesHome,
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
  }, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);

  assert.equal(result.data.tick.status, "scheduled");
  assert.deepEqual(result.data.planned.jobs.map((job: { role: string }) => job.role), ["wake", "recovery"]);
  assert.equal(result.data.summary.wakeJobs.length, 1);
  assert.equal(result.data.summary.recoveryJobs.length, 1);
  assert.equal(result.data.summary.drifted, false);
  const jobsState = JSON.parse(fs.readFileSync(repoLocal.jobsFile, "utf8"));
  assert.equal(jobsState.jobs.length, 2);
  assert.equal(fs.existsSync(path.join(repoLocal.hermesHome, "scripts", "codeksei_context_briefing.py")), true);
  assert.equal(jobsState.jobs[0].deliver, "origin");
  assert.equal(jobsState.jobs.every((job: { script: string }) => /codeksei_context_briefing\.py$/u.test(job.script)), true);
  assert.deepEqual(jobsState.jobs[0].origin, {
    platform: "weixin",
    chat_id: "wxid_sender",
    chat_name: "Test Chat",
    thread_id: "",
  });
});

test("operator hermes sync-checkin creates an immediate wake job when checkin is already due", async () => {
  const fixture = createHostedCheckinFixture("codeksei-hermes-sync-due-");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-sync-due-repo-local-"))
  );
  const baseConfig = {
    runtime: "hermes",
    channelProvider: "hermes",
    checkinConfigFile: fixture.checkinConfigFile,
    checkinScheduleStateFile: fixture.checkinScheduleStateFile,
    sessionsFile: fixture.sessionsFile,
    workspaceRoot: fixture.workspaceRoot,
    hermesHome: repoLocal.hermesHome,
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
  };
  new CheckinScheduleStateStore({ filePath: fixture.checkinScheduleStateFile }).setState({
    activeWake: null,
    lastCompletion: null,
    nextWakeAt: new Date(Date.now() - 60_000).toISOString(),
    pendingTrigger: null,
    scheduleSource: "agent",
    senderId: "wx-user",
    targetKey: `wx-user::${fixture.workspaceRoot}`,
    updatedAt: new Date().toISOString(),
    workspaceRoot: fixture.workspaceRoot,
  });

  const result = await runHermesSyncCheckinCommand(baseConfig, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);

  assert.equal(result.data.tick.status, "due");
  assert.deepEqual(result.data.planned.jobs.map((job: { role: string }) => job.role), ["wake", "recovery"]);
  assert.equal(result.data.sync.jobs.length, 2);
  assert.equal(result.data.sync.jobs.every((job: { jobId: string }) => job.jobId.startsWith("cron-")), true);
  assert.equal(result.data.tick.triggerId.length > 0, true);
});

test("operator hermes sync-checkin creates a recovery job while active wake is in progress", async () => {
  const fixture = createHostedCheckinFixture("codeksei-hermes-sync-recovery-");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-sync-recovery-repo-local-"))
  );
  const baseConfig = {
    runtime: "hermes",
    channelProvider: "hermes",
    checkinConfigFile: fixture.checkinConfigFile,
    checkinScheduleStateFile: fixture.checkinScheduleStateFile,
    sessionsFile: fixture.sessionsFile,
    workspaceRoot: fixture.workspaceRoot,
    hermesHome: repoLocal.hermesHome,
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
  };
  const nowIso = new Date().toISOString();
  new CheckinScheduleStateStore({ filePath: fixture.checkinScheduleStateFile }).setState({
    activeWake: {
      createdAt: nowIso,
      dueAt: nowIso,
      kind: "checkin",
      senderId: "wx-user",
      source: "checkin_trigger",
      startedAt: nowIso,
      text: "ping",
      triggerId: "trigger-1",
      workspaceRoot: fixture.workspaceRoot,
    },
    lastCompletion: null,
    nextWakeAt: "",
    pendingTrigger: null,
    scheduleSource: "agent",
    senderId: "wx-user",
    targetKey: `wx-user::${fixture.workspaceRoot}`,
    updatedAt: nowIso,
    workspaceRoot: fixture.workspaceRoot,
  });

  const result = await runHermesSyncCheckinCommand(baseConfig, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);

  assert.equal(result.data.tick.status, "in_progress");
  assert.deepEqual(result.data.planned.jobs.map((job: { role: string }) => job.role), ["recovery"]);
  assert.equal(result.data.summary.wakeJobs.length, 0);
  assert.equal(result.data.summary.recoveryJobs.length, 1);
});
