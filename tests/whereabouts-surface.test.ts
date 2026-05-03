const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  runWhereaboutsRecentMovesCommand,
  runWhereaboutsRecentStaysCommand,
  runWhereaboutsServeCommand,
  runWhereaboutsSnapshotCommand,
  runWhereaboutsSummaryCommand,
} = require("../src/app/whereabouts-cli.ts");
const {
  ingestWhereaboutsEvent,
} = require("../src/whereabouts/ingest.ts");
const {
  runCapabilitiesStatusCommand,
} = require("../src/app/capabilities-status-cli");
const {
  runContextInspectCommand,
} = require("../src/app/context-inspect-cli");
const {
  runPulseCommand,
} = require("../src/app/pulse-cli");
const {
  runHostDoctorCommand,
} = require("../src/app/host-doctor-cli");
const {
  runHostManifestCommand,
} = require("../src/app/host-manifest-cli");
const {
  runHostSmokeCommand,
} = require("../src/app/host-smoke-cli");

function createWhereaboutsSurfaceFixture(prefix: string) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const stateDir = path.join(workspaceRoot, ".codeksei-state");
  const diaryDir = path.join(stateDir, "diary");
  const codexDir = path.join(workspaceRoot, ".codex");
  const whereaboutsDir = path.join(stateDir, "whereabouts");
  const placesFile = path.join(whereaboutsDir, "places.json");
  fs.mkdirSync(diaryDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(whereaboutsDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# Codeksei fixture\n", "utf8");
  fs.writeFileSync(path.join(codexDir, "code-projects.json"), JSON.stringify({
    projects: [
      {
        slug: "codeksei",
        title: "Codeksei",
        repoRoot: workspaceRoot.replace(/\\/g, "/"),
        notePath: "",
        overviewFiles: ["README.md"],
      },
    ],
  }, null, 2), "utf8");
  fs.writeFileSync(placesFile, JSON.stringify({
    version: 1,
    places: [
      {
        id: "home",
        kind: "home",
        label: "家",
        latitude: 31.2304,
        longitude: 121.4737,
        radiusMeters: 250,
      },
    ],
  }, null, 2), "utf8");
  return {
    config: {
      allowedUserIds: ["wx-user"],
      channel: "weixin",
      channelProvider: "codeksei",
      diaryDir,
      projectRadarConfigFile: path.join(codexDir, "code-projects.json"),
      runtime: "codex",
      sessionsFile: path.join(stateDir, "sessions.json"),
      stateDir,
      timezone: "Asia/Shanghai",
      userName: "Tester",
      whereaboutsHost: "127.0.0.1",
      whereaboutsPlacesFile: placesFile,
      whereaboutsPort: 4318,
      whereaboutsRetentionDays: 30,
      whereaboutsToken: "secret-token",
      workspaceRoot: workspaceRoot.replace(/\\/g, "/"),
    },
    diaryDir,
    stateDir,
    workspaceRoot: workspaceRoot.replace(/\\/g, "/"),
  };
}

function writeTodayDiary(fixture: ReturnType<typeof createWhereaboutsSurfaceFixture>) {
  const today = "2026-05-03";
  fs.writeFileSync(path.join(fixture.diaryDir, `${today}.md`), [
    "# Diary",
    "",
    "## 时间线事实",
    "- 09:30 在修 Codeksei whereabouts。",
    "",
    "## Todo",
    "- [ ] 把 host manifest 和 context inspect 接好。",
    "",
  ].join("\n"), "utf8");
  return today;
}

async function seedHomeLowBatteryEvent(fixture: ReturnType<typeof createWhereaboutsSurfaceFixture>) {
  await ingestWhereaboutsEvent(fixture.config, {
    occurredAt: "2026-05-03T08:00:00.000Z",
    device: { deviceId: "iphone-main", platform: "ios" },
    location: { latitude: 31.23041, longitude: 121.47369, accuracyMeters: 15 },
    battery: { level: 0.18, charging: false, state: "unplugged" },
    motion: { state: "stationary" },
    context: { trigger: "shortcut", source: "ios-shortcuts" },
    extras: {},
  });
}

test("whereabouts cli surfaces semantic snapshot, stay list, move list, and summary", async () => {
  const fixture = createWhereaboutsSurfaceFixture("codeksei-whereabouts-surface-cli-");
  await seedHomeLowBatteryEvent(fixture);

  const snapshot = await runWhereaboutsSnapshotCommand(fixture.config, [
    "--now", "2026-05-03T08:05:00.000Z",
  ]);
  const stays = await runWhereaboutsRecentStaysCommand(fixture.config);
  const moves = await runWhereaboutsRecentMovesCommand(fixture.config);
  const summary = await runWhereaboutsSummaryCommand(fixture.config, [
    "--now", "2026-05-03T08:05:00.000Z",
  ]);

  assert.equal(snapshot.data.currentPlace.kind, "home");
  assert.match(snapshot.text, /在家/u);
  assert.equal(stays.data.items.length, 1);
  assert.equal(stays.data.items[0].place.kind, "home");
  assert.equal(moves.data.items.length, 0);
  assert.match(summary.text, /低电/u);
  assert.match(summary.text, /在家/u);
});

test("whereabouts serve help, host manifest, and capabilities status expose public entrypoints", async () => {
  const fixture = createWhereaboutsSurfaceFixture("codeksei-whereabouts-surface-manifest-");

  const serveHelp = await runWhereaboutsServeCommand(fixture.config, ["--help"]);
  const manifest = await runHostManifestCommand(fixture.config, ["--provider", "hermes"]);
  const capabilities = await runCapabilitiesStatusCommand(fixture.config, [
    "--provider", "codex",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);

  const snapshotCapability = capabilities.data.capabilities.find((entry: { id: string }) => entry.id === "whereabouts.snapshot");
  const serveCapability = capabilities.data.capabilities.find((entry: { id: string }) => entry.id === "whereabouts.serve");

  assert.match(serveHelp.text, /whereabouts serve/u);
  assert.deepEqual(manifest.data.entrypoints.whereaboutsServe, ["codeksei", "whereabouts", "serve"]);
  assert.deepEqual(manifest.data.entrypoints.whereaboutsSnapshot, ["codeksei", "whereabouts", "snapshot", "--format", "json"]);
  assert.deepEqual(manifest.data.entrypoints.whereaboutsSummary, ["codeksei", "whereabouts", "summary", "--format", "json"]);
  assert.equal(manifest.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "whereabouts_ingest_and_context"), true);
  assert.ok(snapshotCapability);
  assert.equal(snapshotCapability.availableNow, true);
  assert.ok(snapshotCapability.entrypoints.includes("codeksei whereabouts snapshot"));
  assert.ok(serveCapability);
  assert.equal(serveCapability.availableNow, true);
});

test("whereabouts layer appears in context inspect and influences pulse details", async () => {
  const fixture = createWhereaboutsSurfaceFixture("codeksei-whereabouts-surface-context-");
  const today = writeTodayDiary(fixture);
  await seedHomeLowBatteryEvent(fixture);

  const inspect = await runContextInspectCommand(fixture.config, [
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--mode", "proactive",
  ]);
  const pulse = await runPulseCommand(fixture.config, [
    "generate",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
    "--date", today,
    "--focus", "今天继续做 whereabouts 和 context inspect",
  ]);

  const whereaboutsLayer = inspect.data.layers.find((entry: { id: string }) => entry.id === "whereabouts");

  assert.ok(whereaboutsLayer);
  assert.equal(whereaboutsLayer.included, true);
  assert.match(whereaboutsLayer.reason, /在家/u);
  assert.match(whereaboutsLayer.reason, /低电/u);
  assert.equal(pulse.data.cards.some((card: { detailsMarkdown: string }) => /在家|低电/u.test(card.detailsMarkdown)), true);
});

test("host doctor and smoke expose whereabouts readiness, and missing token degrades serve readiness", async () => {
  const fixture = createWhereaboutsSurfaceFixture("codeksei-whereabouts-surface-doctor-");

  const doctor = await runHostDoctorCommand(fixture.config, ["--provider", "codex"]);
  const smoke = await runHostSmokeCommand(fixture.config, ["--provider", "codex"]);
  const degraded = await runCapabilitiesStatusCommand({
    ...fixture.config,
    whereaboutsToken: "",
  }, [
    "--provider", "codex",
    "--user", "wx-user",
    "--workspace", fixture.workspaceRoot,
  ]);
  const degradedServe = degraded.data.capabilities.find((entry: { id: string }) => entry.id === "whereabouts.serve");

  assert.equal(doctor.data.provider.doctor.checks.whereabouts.ok, true);
  assert.equal(smoke.data.checks.whereabouts.ok, true);
  assert.ok(degradedServe);
  assert.equal(degradedServe.availableNow, false);
  assert.match(degradedServe.reasons.join("\n"), /token/u);
});

test("host smoke keeps core readiness green when whereabouts token is missing", async () => {
  const fixture = createWhereaboutsSurfaceFixture("codeksei-whereabouts-surface-smoke-advisory-");

  const smoke = await runHostSmokeCommand({
    ...fixture.config,
    whereaboutsToken: "",
  }, ["--provider", "codex"]);

  assert.equal(smoke.ok, true);
  assert.equal(smoke.data.ok, true);
  assert.equal(smoke.data.checks.whereabouts.ok, false);
  assert.match(smoke.data.checks.whereabouts.reason, /token/u);
  assert.equal(Array.isArray(smoke.next), true);
});
