const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { runCompanionRememberCommand } = require("../src/app/companion-remember-cli");
const { runContextBriefingCommand } = require("../src/app/context-briefing-cli");
const { runOnboardingStartCommand, runOnboardingStepCommand } = require("../src/app/onboarding-cli");

function createFixture(overrides = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-companion-memory-"));
  const stateDir = path.join(workspaceRoot, ".codeksei-state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "# Workspace Contract\n", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# README\n", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "Home.md"), "# Home\n", "utf8");
  return {
    config: {
      allowedUserIds: ["wx-user"],
      companionSemanticHost: "deterministic",
      companionSemanticGenerator: null,
      companionSemanticMode: "",
      companionSemanticModel: "",
      companionSemanticTimeoutMs: 15_000,
      onboardingSemanticHost: "deterministic",
      onboardingSemanticGenerator: null,
      onboardingSemanticMode: "",
      onboardingSemanticModel: "",
      onboardingSemanticTimeoutMs: 15_000,
      reviewSemanticHost: "auto",
      reviewSemanticMode: "hybrid",
      reviewSemanticModel: "",
      reviewSemanticTimeoutMs: 120_000,
      stateDir,
      timezone: "Asia/Shanghai",
      workspaceRoot: workspaceRoot.replace(/\\/g, "/"),
      ...overrides,
    },
    stateDir,
    userId: "wx-user",
    workspaceRoot,
  };
}

test("companion remember writes ongoing facts into companion note and refreshes context source status", async () => {
  const fixture = createFixture({
    companionSemanticGenerator: async ({ currentMessage }: { currentMessage: string }) => ({
      corrections: [],
      facts: [
        {
          confidence: 0.93,
          domain: "biography",
          evidence: currentMessage,
          statement: "独立开发者，最近在做 Codeksei。",
          suggested_kind: "status",
          suggested_slot: "current_status",
          time_scope: "current",
          stability: "stable",
        },
        {
          confidence: 0.92,
          domain: "preferences",
          evidence: currentMessage,
          statement: "更喜欢短一点、直接一点的表达。",
          suggested_kind: "preference",
          suggested_slot: "preference",
          time_scope: "stable",
          stability: "stable",
        },
        {
          confidence: 0.91,
          domain: "preferences",
          evidence: currentMessage,
          statement: "晚上不要追得太紧。",
          suggested_kind: "boundary",
          suggested_slot: "boundary",
          time_scope: "ongoing",
          stability: "current",
        },
      ],
      gaps: [],
      unsafe_inferences: [],
    }),
  });

  const remembered = await runCompanionRememberCommand(fixture.config, [
    "--user", fixture.userId,
    "--workspace", fixture.config.workspaceRoot,
    "--source", "host_user_turn",
    "--text", "我是独立开发者，最近在做 Codeksei。你可以短一点，晚上别追太紧。",
  ]);
  assert.equal(remembered.data.status, "updated");
  assert.equal(remembered.data.updatedSlots.includes("boundary"), true);
  assert.equal(remembered.data.updatedSlots.includes("current_status"), true);
  assert.equal(remembered.data.updatedSlots.includes("preference"), true);

  const profilePath = path.join(fixture.stateDir, "companions", fixture.userId, "profile.md");
  const profileContent = fs.readFileSync(profilePath, "utf8");
  assert.match(profileContent, /独立开发者，最近在做 Codeksei/u);
  assert.match(profileContent, /更喜欢短一点、直接一点的表达/u);
  assert.match(profileContent, /晚上不要追得太紧/u);

  const briefing = await runContextBriefingCommand(fixture.config, [
    "--user", fixture.userId,
    "--workspace", fixture.config.workspaceRoot,
  ]);
  assert.match(String(briefing.data.sources.companionMemory.lastSource || ""), /host_user_turn/u);
  assert.match(String(briefing.data.boardText || ""), /companion memory/u);
});

test("companion remember stays conservative on low-signal chat and dedupes repeated over-calls", async () => {
  const fixture = createFixture();

  const lowSignal = await runCompanionRememberCommand(fixture.config, [
    "--user", fixture.userId,
    "--workspace", fixture.config.workspaceRoot,
    "--source", "host_user_turn",
    "--text", "哈哈晚安",
  ]);
  assert.equal(lowSignal.data.status, "noop");

  const first = await runCompanionRememberCommand(fixture.config, [
    "--user", fixture.userId,
    "--workspace", fixture.config.workspaceRoot,
    "--source", "host_user_turn",
    "--text", "我下午两点以后更能动。",
  ]);
  assert.equal(first.data.status, "updated");

  const second = await runCompanionRememberCommand(fixture.config, [
    "--user", fixture.userId,
    "--workspace", fixture.config.workspaceRoot,
    "--source", "host_user_turn",
    "--text", "我下午两点以后更能动。",
  ]);
  assert.equal(second.data.status, "noop");
  assert.match(String(second.text || ""), /duplicate-input/u);
});

test("diary_supplement pattern writes defer once and promote on repeated evidence", async () => {
  const fixture = createFixture();

  const first = await runCompanionRememberCommand(fixture.config, [
    "--user", fixture.userId,
    "--workspace", fixture.config.workspaceRoot,
    "--source", "diary_supplement",
    "--text", "下午通常效率更高。",
  ]);
  assert.equal(first.data.status, "deferred");

  const second = await runCompanionRememberCommand(fixture.config, [
    "--user", fixture.userId,
    "--workspace", fixture.config.workspaceRoot,
    "--source", "diary_supplement",
    "--text", "下午通常效率更高。",
  ]);
  assert.equal(second.data.status, "updated");
  assert.match(String(second.data.updatedSlots.join(",") || ""), /rhythm/u);
});

test("onboarding step reuses the shared companion memory path", async () => {
  const fixture = createFixture({
    companionSemanticGenerator: async ({ currentMessage }: { currentMessage: string }) => ({
      corrections: [],
      facts: [
        {
          confidence: 0.95,
          domain: "biography",
          evidence: currentMessage,
          statement: "独立开发者，最近在折腾 Codeksei。",
          suggested_kind: "status",
          suggested_slot: "current_status",
          time_scope: "current",
          stability: "stable",
        },
        {
          confidence: 0.92,
          domain: "experiences",
          evidence: currentMessage,
          statement: "下午两点以后通常比较能动。",
          suggested_kind: "pattern",
          suggested_slot: "rhythm",
          time_scope: "ongoing",
          stability: "current",
        },
        {
          confidence: 0.91,
          domain: "preferences",
          evidence: currentMessage,
          statement: "更喜欢短一点、直接一点的表达。",
          suggested_kind: "preference",
          suggested_slot: "preference",
          time_scope: "stable",
          stability: "stable",
        },
        {
          confidence: 0.9,
          domain: "preferences",
          evidence: currentMessage,
          statement: "晚上不要追得太紧。",
          suggested_kind: "boundary",
          suggested_slot: "boundary",
          time_scope: "ongoing",
          stability: "current",
        },
        {
          confidence: 0.93,
          domain: "work",
          evidence: currentMessage,
          statement: "接下来会先补 companion remember CLI。",
          suggested_kind: "next",
          suggested_slot: "next",
          time_scope: "near_term",
          stability: "current",
        },
      ],
      gaps: [],
      unsafe_inferences: [],
    }),
    onboardingSemanticGenerator: null,
  });

  const started = await runOnboardingStartCommand(fixture.config, ["--user", fixture.userId]);
  const step = await runOnboardingStepCommand(fixture.config, [
    "--user", fixture.userId,
    "--session", started.data.state.sessionId,
    "--text", "我是独立开发者，最近在折腾 Codeksei。下午两点以后更能动。你可以短一点。晚上别追太紧。接下来会先补 companion remember CLI。",
  ]);

  assert.equal(step.data.state.status, "ready");
  assert.equal(step.data.writes.some((entry: { slotId: string }) => entry.slotId === "next"), true);

  const directFixture = createFixture({
    companionSemanticGenerator: fixture.config.companionSemanticGenerator,
    onboardingSemanticGenerator: null,
  });
  const direct = await runCompanionRememberCommand(directFixture.config, [
    "--user", directFixture.userId,
    "--workspace", directFixture.config.workspaceRoot,
    "--source", "onboarding_turn",
    "--text", "我是独立开发者，最近在折腾 Codeksei。下午两点以后更能动。你可以短一点。晚上别追太紧。接下来会先补 companion remember CLI。",
  ]);
  assert.equal(direct.data.status, "updated");
  assert.equal(direct.data.writes.length, step.data.writes.length);
});
