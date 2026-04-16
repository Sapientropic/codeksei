const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { CheckinConfigStore } = require("../src/state/checkin-config-store");
const { CheckinScheduleStateStore } = require("../src/state/checkin-schedule-state-store");
const { runHostBootstrapCommand } = require("../src/app/host-bootstrap-cli");
const { runHostClaimCheckinCommand } = require("../src/app/host-claim-checkin-cli");
const { runHostSeedProactiveCommand } = require("../src/app/host-seed-proactive-cli");
const { runHostSettleCheckinCommand } = require("../src/app/host-settle-checkin-cli");
const { runHostManifestCommand } = require("../src/app/host-manifest-cli");
const { runHostRenderCommand } = require("../src/app/host-render-cli");
const { createFakeHermesRepoLocalFixture } = require("./helpers/fake-hermes-repo-local.ts");

function createHostFixture(prefix: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const stateDir = path.join(tempRoot, "state");
  const workspaceRoot = path.join(tempRoot, "workspace");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const checkinConfigFile = path.join(stateDir, "checkin-config.json");
  new CheckinConfigStore({ filePath: checkinConfigFile }).setConfig({
    minIntervalMs: 60_000,
    maxIntervalMs: 60_000,
  });
  return {
    tempRoot,
    stateDir,
    workspaceRoot,
    config: {
      allowedUserIds: ["wx-user"],
      checkinConfigFile,
      checkinScheduleStateFile: path.join(stateDir, "checkin-schedule-state.json"),
      cliIdempotencyLedgerFile: path.join(stateDir, "cli-idempotency-ledger.json"),
      sessionsFile: path.join(stateDir, "sessions.json"),
      stateDir,
      timezone: "Asia/Shanghai",
      userName: "Tester",
      workspaceRoot,
    },
  };
}

function normalizePathSeparators(value: string) {
  return value.replace(/\\/gu, "/");
}

test("host manifest returns bridge-full invariant and hermes recipe", async () => {
  const fixture = createHostFixture("codeksei-host-manifest-");
  const result = await runHostManifestCommand(fixture.config);

  assert.equal(result.data.runtimeInvariant, "bridge-full");
  assert.equal(Array.isArray(result.data.recipes), true);
  assert.equal(result.data.recipes.some((entry: { id: string }) => entry.id === "hermes"), true);
});

test("host bootstrap writes canonical config and previews Hermes bootstrap", async () => {
  const fixture = createHostFixture("codeksei-host-bootstrap-");
  const configPath = path.join(fixture.workspaceRoot, "codeksei.config.json");

  const result = await runHostBootstrapCommand(fixture.config, [
    "--provider", "hermes",
    "--config", configPath,
    "--ensure-daemon",
    "--dry-run",
  ]);

  assert.equal(result.meta.dryRun, true);
  assert.equal(result.data.provider, "hermes");
  assert.equal(result.data.config.$schema, "./schemas/codeksei-config-v1.json");
  assert.equal(fs.existsSync(configPath), false);
});

test("host bootstrap dry-run resolves workspace-scoped config path when config is omitted", async () => {
  const fixture = createHostFixture("codeksei-host-bootstrap-workspace-dry-run-");
  const targetWorkspace = path.join(fixture.tempRoot, "target-workspace");
  const targetConfigPath = path.join(targetWorkspace, "codeksei.config.json");
  fs.mkdirSync(targetWorkspace, { recursive: true });

  const result = await runHostBootstrapCommand(fixture.config, [
    "--provider", "generic-shell",
    "--workspace", targetWorkspace,
    "--dry-run",
  ]);

  assert.equal(result.meta.dryRun, true);
  assert.equal(result.meta.configSource.resolvedConfigPath, targetConfigPath);
  assert.equal(result.meta.resolvedTargets.configFile, targetConfigPath);
  assert.deepEqual(result.meta.sideEffects, [
    { kind: "write_canonical_config", target: targetConfigPath },
  ]);
  assert.equal(result.data.config.workspaceRoot, targetWorkspace);
  assert.equal(fs.existsSync(targetConfigPath), false);
  assert.equal(fs.existsSync(path.join(fixture.workspaceRoot, "codeksei.config.json")), false);
});

test("host bootstrap writes canonical config into the explicit workspace when config is omitted", async () => {
  const fixture = createHostFixture("codeksei-host-bootstrap-workspace-execute-");
  const targetWorkspace = path.join(fixture.tempRoot, "target-workspace");
  const targetConfigPath = path.join(targetWorkspace, "codeksei.config.json");
  const ambientConfigPath = path.join(fixture.workspaceRoot, "codeksei.config.json");
  fs.mkdirSync(targetWorkspace, { recursive: true });

  const result = await runHostBootstrapCommand(fixture.config, [
    "--provider", "generic-shell",
    "--workspace", targetWorkspace,
  ]);

  assert.equal(result.meta.configSource.resolvedConfigPath, targetConfigPath);
  assert.equal(result.meta.resolvedTargets.configFile, targetConfigPath);
  assert.equal(result.data.config.workspaceRoot, targetWorkspace);
  assert.equal(fs.existsSync(targetConfigPath), true);
  assert.equal(fs.existsSync(ambientConfigPath), false);
});

test("host bootstrap keeps explicit config path even when workspace overrides config content", async () => {
  const fixture = createHostFixture("codeksei-host-bootstrap-explicit-config-");
  const targetWorkspace = path.join(fixture.tempRoot, "target-workspace");
  const explicitConfigPath = path.join(fixture.tempRoot, "custom-config", "codeksei.config.json");
  fs.mkdirSync(targetWorkspace, { recursive: true });

  const result = await runHostBootstrapCommand(fixture.config, [
    "--provider", "generic-shell",
    "--config", explicitConfigPath,
    "--workspace", targetWorkspace,
    "--dry-run",
  ]);

  assert.equal(result.meta.configSource.resolvedConfigPath, normalizePathSeparators(explicitConfigPath));
  assert.equal(result.meta.resolvedTargets.configFile, normalizePathSeparators(explicitConfigPath));
  assert.deepEqual(result.meta.sideEffects, [
    { kind: "write_canonical_config", target: normalizePathSeparators(explicitConfigPath) },
  ]);
  assert.equal(result.data.config.workspaceRoot, targetWorkspace);
  assert.equal(fs.existsSync(explicitConfigPath), false);
});

test("host bootstrap hermes dry-run previews skill install without drifting the resolved config path", async () => {
  const fixture = createHostFixture("codeksei-host-bootstrap-hermes-workspace-");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-host-bootstrap-hermes-workspace-repo-local-"))
  );
  const targetWorkspace = path.join(fixture.tempRoot, "target-workspace");
  const targetConfigPath = path.join(targetWorkspace, "codeksei.config.json");
  fs.mkdirSync(targetWorkspace, { recursive: true });
  const runtimeConfig = {
    ...fixture.config,
    ...repoLocal.env,
    runtime: "hermes",
    channelProvider: "hermes",
    hermesHome: repoLocal.hermesHome,
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
  };

  const result = await runHostBootstrapCommand(runtimeConfig, [
    "--provider", "hermes",
    "--workspace", targetWorkspace,
    "--ensure-daemon",
    "--dry-run",
  ]);

  assert.equal(result.meta.dryRun, true);
  assert.equal(result.data.provider, "hermes");
  assert.equal(result.meta.configSource.resolvedConfigPath, targetConfigPath);
  assert.equal(result.meta.resolvedTargets.configFile, targetConfigPath);
  assert.equal(result.data.config.workspaceRoot, targetWorkspace);
  assert.equal(typeof result.data.skillInstall, "object");
  assert.equal(fs.existsSync(targetConfigPath), false);
  assert.equal(fs.existsSync(path.join(repoLocal.hermesHome, "skills", "codeksei-companion", "SKILL.md")), false);
});

test("host claim-checkin and settle-checkin cover delegated proactive lease flow", async () => {
  const fixture = createHostFixture("codeksei-host-claim-settle-");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-host-claim-settle-repo-local-"))
  );
  const scheduleStore = new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile });
  scheduleStore.setState({
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
  const runtimeConfig = {
    ...fixture.config,
    ...repoLocal.env,
    runtime: "hermes",
    channelProvider: "hermes",
    hermesHome: repoLocal.hermesHome,
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
  };

  const claim = await runHostClaimCheckinCommand(runtimeConfig, [
    "--provider", "hermes",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);
  assert.equal(claim.data.status, "claimed");
  assert.equal(typeof claim.data.lease.id, "string");
  assert.equal(claim.data.payload.kind, "proactive_checkin");
  assert.deepEqual(claim.data.hostedSync.plan.jobs.map((job: { role: string }) => job.role), ["recovery"]);

  const settle = await runHostSettleCheckinCommand(runtimeConfig, [
    "--provider", "hermes",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--lease", claim.data.lease.id,
    "--result", "silent",
    "--sleep-for", "6h",
  ]);
  assert.equal(settle.ok, true);
  assert.match(String(settle.data.nextWakeAt || ""), /^\d{4}-\d{2}-\d{2}T/u);
  assert.deepEqual(settle.data.hostedWakeSync.jobs.map((job: { role: string }) => job.role), ["wake", "recovery"]);
});

test("host seed-proactive with explicit sleep-for repairs state and hosted job set together", async () => {
  const fixture = createHostFixture("codeksei-host-seed-explicit-");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-host-seed-explicit-repo-local-"))
  );
  const runtimeConfig = {
    ...fixture.config,
    ...repoLocal.env,
    runtime: "hermes",
    channelProvider: "hermes",
    hermesHome: repoLocal.hermesHome,
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
  };

  const result = await runHostSeedProactiveCommand(runtimeConfig, [
    "--provider", "hermes",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--sleep-for", "2h",
  ]);

  assert.equal(result.data.status, "seeded");
  assert.match(String(result.data.nextWakeAt || ""), /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(result.data.sync.jobs.length, 2);
  assert.deepEqual(result.data.sync.jobs.map((job: { role: string }) => job.role), ["wake", "recovery"]);
  const state = new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile }).getState();
  assert.equal(state?.nextWakeAt, result.data.nextWakeAt);
  const jobsState = JSON.parse(fs.readFileSync(repoLocal.jobsFile, "utf8"));
  assert.deepEqual(jobsState.jobs.map((job: { codeksei_checkin_role: string }) => job.codeksei_checkin_role).sort(), ["recovery", "wake"]);
  assert.equal(jobsState.jobs.every((job: { script: string }) => /codeksei_context_briefing\.py$/u.test(job.script)), true);
  assert.equal(fs.existsSync(path.join(repoLocal.hermesHome, "scripts", "codeksei_context_briefing.py")), true);
});

test("host settle-checkin returns partial on failed delegated pass and keeps recovery ownership", async () => {
  const fixture = createHostFixture("codeksei-host-settle-failed-");
  const scheduleStore = new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile });
  const startedAt = new Date().toISOString();
  scheduleStore.setState({
    activeWake: {
      createdAt: startedAt,
      dueAt: startedAt,
      kind: "checkin",
      senderId: "wx-user",
      source: "checkin_trigger",
      startedAt,
      text: "ping",
      triggerId: "lease-1",
      workspaceRoot: fixture.workspaceRoot,
    },
    lastCompletion: null,
    nextWakeAt: "",
    pendingTrigger: null,
    scheduleSource: "agent",
    senderId: "wx-user",
    targetKey: `wx-user::${fixture.workspaceRoot}`,
    updatedAt: startedAt,
    workspaceRoot: fixture.workspaceRoot,
  });

  const settle = await runHostSettleCheckinCommand(fixture.config, [
    "--provider", "generic-shell",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--lease", "lease-1",
    "--result", "failed",
  ]);
  assert.equal(settle.ok, "partial");
  assert.equal(settle.data.completion, null);
});

test("host render returns the generated Hermes skill and validates tracked template", async () => {
  const result = await runHostRenderCommand({}, [
    "--provider", "hermes",
    "--target", "skill",
    "--validate",
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.data.matchesTrackedTemplate, true);
  assert.match(String(result.text || ""), /# Codeksei Companion/u);
});
