const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { CheckinConfigStore } = require("../src/state/checkin-config-store");
const { CheckinScheduleStateStore } = require("../src/state/checkin-schedule-state-store");
const { runHostBootstrapCommand } = require("../src/app/host-bootstrap-cli");
const { runHostClaimCheckinCommand } = require("../src/app/host-claim-checkin-cli");
const { runContextBriefingCommand } = require("../src/app/context-briefing-cli");
const { runHostDoctorCommand } = require("../src/app/host-doctor-cli");
const { runHostFinalizeCheckinCommand } = require("../src/app/host-finalize-checkin-cli");
const { runHostSeedProactiveCommand } = require("../src/app/host-seed-proactive-cli");
const { runHostSettleCheckinCommand } = require("../src/app/host-settle-checkin-cli");
const { runHostManifestCommand } = require("../src/app/host-manifest-cli");
const { runHostRenderCommand } = require("../src/app/host-render-cli");
const { runHostSmokeCommand } = require("../src/app/host-smoke-cli");
const { getCurrentDateStringInTimezone } = require("../src/core/timezone");
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

function writeFreshHostDiary(fixture: ReturnType<typeof createHostFixture>) {
  const diaryDir = path.join(fixture.stateDir, "diary");
  fs.mkdirSync(diaryDir, { recursive: true });
  const today = getCurrentDateStringInTimezone("Asia/Shanghai");
  fs.writeFileSync(path.join(diaryDir, `${today}.md`), [
    "# Diary",
    "",
    "## 时间线事实",
    "- 15:00 继续 Codeksei proactive observation layer",
    "",
    "## Todo",
    "- [ ] 接入 claim-checkin",
    "",
  ].join("\n"), "utf8");
  return diaryDir;
}

test("host manifest returns the hosted-first discovery contract plus compatibility invariant", async () => {
  const fixture = createHostFixture("codeksei-host-manifest-");
  const result = await runHostManifestCommand(fixture.config);

  assert.equal(result.data.contractVersion, 2);
  assert.equal(result.data.coreInvariant, "codeksei-core-owned");
  assert.equal(result.data.scheduleTruthOwner, "codeksei");
  assert.equal(result.data.hostIdentity.profile, "hosted-mode");
  assert.equal(result.data.hostIdentity.runtimeProvider, "hermes");
  assert.equal(result.data.hostIdentity.runtimeOwner, "host");
  assert.equal(result.data.hostIdentity.channelProvider, "hermes");
  assert.equal(result.data.hostIdentity.deliveryRecipe, "hermes-origin");
  assert.equal(result.data.runtimeInvariant, "bridge-full");
  assert.equal(result.data.provider, "hermes");
  assert.equal(Array.isArray(result.data.recipes), true);
  assert.equal(result.data.recipes.some((entry: { id: string }) => entry.id === "hermes"), true);
  assert.equal(Array.isArray(result.data.recommendedWorkflows), true);
  assert.equal(result.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "first_activation_onboarding"), true);
  assert.equal(result.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "ongoing_companion_memory"), true);
  assert.equal(result.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "proactive_checkin"), true);
  assert.equal(result.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "proactive_continuity"), true);
  assert.equal(result.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "time_block_capture"), true);
  assert.equal(result.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "cutover_bookkeeping"), true);
  assert.equal(result.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "sleep_closeout"), true);
  assert.equal(result.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "project_continuity_write"), true);
  assert.deepEqual(result.data.entrypoints.bootstrap, ["codeksei", "host", "bootstrap", "--provider", "hermes", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.doctor, ["codeksei", "host", "doctor", "--provider", "hermes", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.seedProactive, ["codeksei", "host", "seed-proactive", "--provider", "hermes", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.claimCheckin, ["codeksei", "host", "claim-checkin", "--provider", "hermes", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.finalizeCheckin, ["codeksei", "host", "finalize-checkin", "--provider", "hermes", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.settleCheckin, ["codeksei", "host", "settle-checkin", "--provider", "hermes", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.diaryWrite, ["codeksei", "diary", "write", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.timelineEvent, ["codeksei", "timeline", "event", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.timelineCategories, ["codeksei", "timeline", "categories", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.timelineRead, ["codeksei", "timeline", "read", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.reviewNightly, ["codeksei", "review", "nightly", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.noteAuto, ["codeksei", "note", "auto", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.projectRadar, ["codeksei", "project", "radar", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.reminderWrite, ["codeksei", "reminder", "write", "--format", "json"]);
  assert.equal(Array.isArray(result.data.entrypoints.companionRemember), true);
  assert.equal(Array.isArray(result.data.entrypoints.onboardingStart), true);
  assert.equal(Array.isArray(result.data.entrypoints.contextBriefing), true);
  assert.equal(result.data.upgrade.startupDoctorRequired, true);
});

test("host manifest can render the Codex provider view without hiding Hermes", async () => {
  const fixture = createHostFixture("codeksei-host-manifest-codex-");
  const result = await runHostManifestCommand(fixture.config, [
    "--provider", "codex",
  ]);

  assert.equal(result.data.provider, "codex");
  assert.equal(result.data.hostIdentity.profile, "codex-mode");
  assert.equal(result.data.hostIdentity.runtimeProvider, "codex");
  assert.equal(result.data.hostIdentity.runtimeOwner, "codeksei");
  assert.equal(result.data.hostIdentity.channelProvider, "codeksei");
  assert.equal(result.data.hostIdentity.deliveryRecipe, "codeksei-weixin-bridge");
  assert.deepEqual(result.data.entrypoints.bootstrap, ["codeksei", "host", "bootstrap", "--provider", "codex", "--format", "json"]);
  assert.equal(result.data.recipes.some((entry: { id: string }) => entry.id === "codex"), true);
  assert.equal(result.data.recipes.some((entry: { id: string }) => entry.id === "hermes"), true);
});

test("host bootstrap defaults to hermes on clean install when provider is omitted", async () => {
  const fixture = createHostFixture("codeksei-host-bootstrap-default-hermes-");
  const targetWorkspace = path.join(fixture.tempRoot, "target-workspace");
  fs.mkdirSync(targetWorkspace, { recursive: true });

  const result = await runHostBootstrapCommand(fixture.config, [
    "--workspace", targetWorkspace,
    "--dry-run",
  ]);

  assert.equal(result.meta.dryRun, true);
  assert.equal(result.data.provider, "hermes");
  assert.equal(result.meta.resolvedTargets.provider, "hermes");
  assert.equal(result.data.config.workspaceRoot, targetWorkspace);
  assert.equal(result.data.config.host.provider, "hermes");
  assert.equal(result.data.config.host.runtimeProvider, "hermes");
  assert.equal(result.data.config.host.runtimeOwner, "host");
  assert.equal(result.data.config.host.channelProvider, "hermes");
  assert.equal(result.data.config.host.channelKind, "weixin");
  assert.equal(result.data.config.host.deliveryRecipe, "hermes-origin");
  assert.equal(typeof result.data.skillInstall, "object");
  assert.deepEqual(result.meta.sideEffects, [
    { kind: "write_canonical_config", target: path.join(targetWorkspace, "codeksei.config.json") },
    { kind: "install_companion_skill", target: "~/.hermes/skills/codeksei-companion/SKILL.md" },
  ]);
});

test("host bootstrap supports first-party Codex Mode without installing Hermes skill", async () => {
  const fixture = createHostFixture("codeksei-host-bootstrap-codex-");
  const targetWorkspace = path.join(fixture.tempRoot, "target-workspace");
  fs.mkdirSync(targetWorkspace, { recursive: true });

  const result = await runHostBootstrapCommand(fixture.config, [
    "--provider", "codex",
    "--workspace", targetWorkspace,
    "--dry-run",
  ]);

  assert.equal(result.meta.dryRun, true);
  assert.equal(result.data.provider, "codex");
  assert.equal(result.data.config.modeClass, "codex-managed");
  assert.equal(result.data.config.host.provider, "codex");
  assert.equal(result.data.config.host.runtimeProvider, "codex");
  assert.equal(result.data.config.host.runtimeOwner, "codeksei");
  assert.equal(result.data.config.host.channelProvider, "codeksei");
  assert.equal(result.data.config.host.channelKind, "weixin");
  assert.equal(result.data.config.host.deliveryRecipe, "codeksei-weixin-bridge");
  assert.equal(result.data.skillInstall, null);
  assert.deepEqual(result.meta.sideEffects, [
    { kind: "write_canonical_config", target: path.join(targetWorkspace, "codeksei.config.json") },
  ]);
});

test("host bootstrap provider selection overrides stale canonical host fields", async () => {
  const fixture = createHostFixture("codeksei-host-bootstrap-codex-override-");
  const configPath = path.join(fixture.workspaceRoot, "codeksei.config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    $schema: "./schemas/codeksei-config-v2.json",
    modeClass: "hosted-proactive",
    workspaceRoot: fixture.workspaceRoot,
    stateDir: fixture.stateDir,
    user: {
      id: "wx-user",
      name: "Tester",
      timezone: "Asia/Shanghai",
    },
    host: {
      provider: "hermes",
      runtimeProvider: "hermes",
      runtimeOwner: "host",
      channelProvider: "hermes",
      channelKind: "weixin",
      deliveryRecipe: "hermes-origin",
      channel: "weixin",
    },
  }, null, 2), "utf8");

  const result = await runHostBootstrapCommand(fixture.config, [
    "--provider", "codex",
    "--config", configPath,
    "--dry-run",
  ]);

  assert.equal(result.data.config.modeClass, "codex-managed");
  assert.equal(result.data.config.host.provider, "codex");
  assert.equal(result.data.config.host.runtimeProvider, "codex");
  assert.equal(result.data.config.host.runtimeOwner, "codeksei");
  assert.equal(result.data.config.host.channelProvider, "codeksei");
  assert.equal(result.data.config.host.deliveryRecipe, "codeksei-weixin-bridge");
});

test("host bootstrap writes canonical config and previews Hermes bootstrap", async () => {
  const fixture = createHostFixture("codeksei-host-bootstrap-");
  const configPath = path.join(fixture.workspaceRoot, "codeksei.config.json");

  const result = await runHostBootstrapCommand(fixture.config, [
    "--provider", "hermes",
    "--config", configPath,
    "--dry-run",
  ]);

  assert.equal(result.meta.dryRun, true);
  assert.equal(result.data.provider, "hermes");
  assert.equal(result.data.config.$schema, "./schemas/codeksei-config-v2.json");
  assert.equal(result.data.config.host.runtimeProvider, "hermes");
  assert.equal(result.data.config.host.runtimeOwner, "host");
  assert.equal(result.data.config.host.channelProvider, "hermes");
  assert.equal(result.data.config.host.channelKind, "weixin");
  assert.equal(result.data.config.host.deliveryRecipe, "hermes-origin");
  assert.equal(result.data.config.bootstrap.manifestContractVersion > 0, true);
  assert.match(String(result.data.config.bootstrap.completedAt || ""), /T/u);
  assert.equal(fs.existsSync(configPath), false);
});

test("host doctor and smoke expose Codex provider readiness without Hermes prerequisites", async () => {
  const fixture = createHostFixture("codeksei-host-doctor-codex-");

  const doctor = await runHostDoctorCommand(fixture.config, [
    "--provider", "codex",
  ]);
  assert.equal(doctor.data.provider.id, "codex");
  assert.equal(doctor.data.attachment.profile, "codex-mode");
  assert.equal(doctor.data.attachment.runtimeProvider, "codex");
  assert.equal(doctor.data.attachment.channelProvider, "codeksei");

  const smoke = await runHostSmokeCommand(fixture.config, [
    "--provider", "codex",
  ]);
  assert.equal(smoke.ok, true);
  assert.equal(smoke.data.provider, "codex");
  assert.equal(smoke.data.checks.stateDir.ok, true);
});

test("host doctor flags legacy config without bootstrap snapshot for re-bootstrap", async () => {
  const fixture = createHostFixture("codeksei-host-doctor-upgrade-");
  const configPath = path.join(fixture.workspaceRoot, "codeksei.config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    $schema: "./schemas/codeksei-config-v1.json",
    modeClass: "hosted-skill-only",
    workspaceRoot: fixture.workspaceRoot,
    stateDir: fixture.stateDir,
    user: {
      id: "wx-user",
      name: "Tester",
      timezone: "Asia/Shanghai",
    },
    host: {
      provider: "generic-shell",
      channel: "weixin",
    },
  }, null, 2), "utf8");

  const result = await runHostDoctorCommand(fixture.config, [
    "--provider", "generic-shell",
    "--config", configPath,
  ]);

  assert.equal(result.data.upgrade.bootstrapSnapshotMissing, true);
  assert.equal(result.data.upgrade.needsBootstrap, true);
  assert.match(String(result.text || ""), /bootstrap_required: yes/u);
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
  assert.equal(claim.data.proactiveDecision.kind, "proactive_decision");
  assert.equal(claim.data.proactiveDecision.model.used, false);
  assert.equal(claim.data.proactiveDecision.model.host, "deterministic");
  assert.equal(Array.isArray(claim.data.payload.decisionOrder), true);
  assert.equal(Array.isArray(claim.data.payload.bookkeepingPriorities), true);
  assert.equal(typeof claim.data.contextBriefing?.briefingText, "string");
  assert.equal(Array.isArray(claim.data.bookkeepingExpectations), true);
  assert.deepEqual(claim.data.hostedSync.plan.jobs.map((job: { role: string }) => job.role), ["recovery", "guard"]);

  const settle = await runHostSettleCheckinCommand(runtimeConfig, [
    "--provider", "hermes",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--lease", claim.data.lease.id,
    "--result", "silent",
    "--sleep-for", "6h",
    "--decision-id", claim.data.proactiveDecision.decisionId,
    "--response-outcome", "ignored",
    "--feedback-text", "No visible response yet.",
  ]);
  assert.equal(settle.ok, true);
  assert.equal(settle.data.outcomeLogged, true);
  assert.match(String(settle.data.nextWakeAt || ""), /^\d{4}-\d{2}-\d{2}T/u);
  assert.deepEqual(settle.data.hostedWakeSync.jobs.map((job: { role: string }) => job.role), ["wake", "recovery", "guard"]);
});

test("host claim-checkin uses proactive observation generator without taking over schedule truth", async () => {
  const fixture = createHostFixture("codeksei-host-claim-observation-");
  const diaryDir = writeFreshHostDiary(fixture);
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-host-claim-observation-repo-local-"))
  );
  new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile }).setState({
    activeWake: null,
    lastCompletion: {
      completedAt: new Date().toISOString(),
      nextWakeAt: new Date(Date.now() - 60_000).toISOString(),
      result: "silent",
      scheduleSource: "agent",
      triggerId: "previous-trigger",
    },
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
    diaryDir,
    hermesHome: repoLocal.hermesHome,
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
    proactiveObservationGenerator: async () => ({
      annoyanceRisk: "low",
      confidence: 0.88,
      currentStateHypothesis: "用户正在推进 observation layer。",
      evidence: ["context board 提到 proactive checkin。"],
      likelyBlocker: "需要一个低风险实现入口。",
      modalityHints: ["text"],
      reentryCandidate: "先把 observation 接入 claim-checkin。",
      stateSignals: ["project_reentry"],
      suggestedTone: "短、自然。",
      surfaceRisk: "low",
      userEnergy: "medium",
    }),
    proactiveObservationHost: "local",
    proactiveObservationMinConfidence: 0.55,
    proactiveObservationMode: "hybrid",
    proactiveObservationModel: "gemma-4-E2B-it",
    proactiveObservationTimeoutMs: 8000,
  };

  const claim = await runHostClaimCheckinCommand(runtimeConfig, [
    "--provider", "hermes",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);

  assert.equal(claim.data.status, "claimed");
  assert.equal(claim.data.proactiveDecision.model.used, false);
  assert.equal(claim.data.proactiveDecision.reasonCode, "project_reentry");
  assert.equal(claim.data.proactiveDecision.interventionLevel, "offer_next_step");
  assert.match(String(claim.data.contextBriefing?.briefingText || ""), /小模型观察/u);
  assert.match(String(claim.data.contextBriefing?.briefingText || ""), /observation 接入 claim-checkin/u);
  assert.deepEqual(claim.data.hostedSync.plan.jobs.map((job: { role: string }) => job.role), ["recovery", "guard"]);
});

test("generic-shell claim-checkin can use proactive observation without Hermes-specific fields", async () => {
  const fixture = createHostFixture("codeksei-host-claim-generic-observation-");
  const diaryDir = writeFreshHostDiary(fixture);
  new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile }).setState({
    activeWake: null,
    lastCompletion: {
      completedAt: new Date().toISOString(),
      nextWakeAt: new Date(Date.now() - 60_000).toISOString(),
      result: "silent",
      scheduleSource: "agent",
      triggerId: "previous-trigger",
    },
    nextWakeAt: new Date(Date.now() - 60_000).toISOString(),
    pendingTrigger: null,
    scheduleSource: "agent",
    senderId: "wx-user",
    targetKey: `wx-user::${fixture.workspaceRoot}`,
    updatedAt: new Date().toISOString(),
    workspaceRoot: fixture.workspaceRoot,
  });
  const claim = await runHostClaimCheckinCommand({
    ...fixture.config,
    diaryDir,
    proactiveObservationGenerator: async () => ({
      annoyanceRisk: "low",
      confidence: 0.8,
      currentStateHypothesis: "generic shell host 也能消费 observation。",
      evidence: ["generic-shell provider"],
      reentryCandidate: "验证 host-neutral observation contract。",
      stateSignals: ["project_reentry"],
      surfaceRisk: "low",
      userEnergy: "medium",
    }),
    proactiveObservationHost: "local",
    proactiveObservationMinConfidence: 0.55,
    proactiveObservationMode: "hybrid",
    proactiveObservationModel: "gemma-4-E2B-it",
    proactiveObservationTimeoutMs: 8000,
  }, [
    "--provider", "generic-shell",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);

  assert.equal(claim.data.status, "claimed");
  assert.equal(claim.data.hostedSync, null);
  assert.equal(claim.data.proactiveDecision.reasonCode, "project_reentry");
  assert.match(String(claim.data.contextBriefing?.briefingText || ""), /小模型观察/u);
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
  assert.equal(result.data.sync.jobs.length, 3);
  assert.deepEqual(result.data.sync.jobs.map((job: { role: string }) => job.role), ["wake", "recovery", "guard"]);
  const state = new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile }).getState();
  assert.equal(state?.nextWakeAt, result.data.nextWakeAt);
  const jobsState = JSON.parse(fs.readFileSync(repoLocal.jobsFile, "utf8"));
  assert.deepEqual(jobsState.jobs.map((job: { codeksei_checkin_role: string }) => job.codeksei_checkin_role).sort(), ["guard", "recovery", "wake"]);
  assert.equal(jobsState.jobs.every((job: { script: string }) => /codeksei_hosted_checkin\.py$/u.test(job.script)), true);
  assert.equal(fs.existsSync(path.join(repoLocal.hermesHome, "scripts", "codeksei_hosted_checkin.py")), true);
});

test("host claim-checkin repairs hosted future jobs from scheduled local truth even when no cron jobs remain", async () => {
  const fixture = createHostFixture("codeksei-host-claim-idle-repair-");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-host-claim-idle-repair-repo-local-"))
  );
  new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile }).setState({
    activeWake: null,
    lastCompletion: null,
    nextWakeAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    pendingHandoff: null,
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

  assert.equal(claim.data.status, "idle");
  assert.deepEqual(claim.data.hostedSync.plan.jobs.map((job: { role: string }) => job.role), ["wake", "recovery", "guard"]);
  const jobsState = JSON.parse(fs.readFileSync(repoLocal.jobsFile, "utf8"));
  assert.deepEqual(jobsState.jobs.map((job: { codeksei_checkin_role: string }) => job.codeksei_checkin_role).sort(), ["guard", "recovery", "wake"]);
});

test("host claim-checkin re-arms hosted future jobs after an expired pending handoff auto-finalizes locally", async () => {
  const fixture = createHostFixture("codeksei-host-expired-handoff-repair-");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-host-expired-handoff-repair-repo-local-"))
  );
  new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile }).setState({
    activeWake: {
      createdAt: "2026-04-18T00:00:00.000Z",
      dueAt: "2026-04-18T00:00:00.000Z",
      kind: "checkin",
      senderId: "wx-user",
      source: "checkin_trigger",
      startedAt: "2026-04-18T00:01:00.000Z",
      text: "ping",
      triggerId: "lease-expired",
      workspaceRoot: fixture.workspaceRoot,
    },
    lastCompletion: null,
    nextWakeAt: "",
    pendingHandoff: {
      bookkeepingActions: [],
      followupContext: "主会话没来接这轮。",
      handoffCreatedAt: "2026-04-18T00:05:00.000Z",
      handoffExpiresAt: "2026-04-18T00:10:00.000Z",
      observedCurrentState: "最近还在这条线附近。",
      outcome: "silent",
      triggerId: "lease-expired",
      userVisibleMessage: "",
    },
    pendingTrigger: null,
    scheduleSource: "agent",
    senderId: "wx-user",
    targetKey: `wx-user::${fixture.workspaceRoot}`,
    updatedAt: "2026-04-18T00:05:00.000Z",
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

  assert.equal(claim.data.status, "idle");
  assert.match(String(claim.data.nextWakeAt || ""), /^\d{4}-\d{2}-\d{2}T/u);
  const state = new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile }).getState();
  assert.equal(state?.pendingHandoff, null);
  assert.equal(state?.lastCompletion?.scheduleSource, "recovery");
  const jobsState = JSON.parse(fs.readFileSync(repoLocal.jobsFile, "utf8"));
  assert.deepEqual(jobsState.jobs.map((job: { codeksei_checkin_role: string }) => job.codeksei_checkin_role).sort(), ["guard", "recovery", "wake"]);
});

test("host settle-checkin can record a child handoff and host finalize-checkin can complete it", async () => {
  const fixture = createHostFixture("codeksei-host-handoff-finalize-");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-host-handoff-finalize-repo-local-"))
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

  const handoff = await runHostSettleCheckinCommand(runtimeConfig, [
    "--provider", "hermes",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--lease", claim.data.lease.id,
    "--result", "sent_message",
    "--create-handoff",
    "--message", "你现在是在继续这条线，还是已经切走了？",
    "--observed-state", "最近还在 codeksei 这条线上，但当前是否切走需要再确认。",
    "--followup-context", "主会话回来后先确认这条线有没有继续，再决定晚上要不要 nightly closeout。",
    "--bookkeeping-action", "timeline|suggested|如果确认还在同一条线，补今天这段工作块。",
    "--bookkeeping-action", "project_note|suggested|补一条当前 hosted proactive 改造的状态块。",
  ]);
  assert.equal(handoff.ok, true);
  assert.equal(handoff.data.completion, null);
  assert.equal(handoff.data.handoff.outcome, "sent_message");
  assert.equal(handoff.data.handoff.userVisibleMessage, "你现在是在继续这条线，还是已经切走了？");
  assert.equal(handoff.data.handoff.bookkeepingActions.length, 2);

  const briefing = await runContextBriefingCommand(runtimeConfig, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--mode", "proactive",
  ]);
  assert.equal(briefing.data.sources.pendingHandoff.exists, true);
  assert.match(String(briefing.text || ""), /待主会话收尾的 proactive handoff/u);

  const finalized = await runHostFinalizeCheckinCommand(runtimeConfig, [
    "--provider", "hermes",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--lease", claim.data.lease.id,
    "--sleep-for", "2h",
  ]);
  assert.equal(finalized.ok, true);
  assert.equal(finalized.data.completion.result, "sent_message");
  assert.match(String(finalized.data.nextWakeAt || ""), /^\d{4}-\d{2}-\d{2}T/u);
  const state = new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile }).getState();
  assert.equal(state?.pendingHandoff, null);
});

test("host settle-checkin rejects create-handoff sent_message results that omit the actual user-visible message", async () => {
  const fixture = createHostFixture("codeksei-host-handoff-validation-");
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-host-handoff-validation-repo-local-"))
  );
  const scheduleStore = new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile });
  scheduleStore.setState({
    activeWake: null,
    lastCompletion: null,
    nextWakeAt: new Date(Date.now() - 60_000).toISOString(),
    pendingHandoff: null,
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

  await assert.rejects(
    runHostSettleCheckinCommand(runtimeConfig, [
      "--provider", "hermes",
      "--user", "wx-user",
      "--workspace", fixture.workspaceRoot,
      "--lease", claim.data.lease.id,
      "--result", "sent_message",
      "--create-handoff",
      "--observed-state", "还在这条线附近。",
    ]),
    /必须同时提供 --message/u,
  );
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
