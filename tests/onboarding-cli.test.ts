const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { runOnboardingResetCommand, runOnboardingStartCommand, runOnboardingStatusCommand, runOnboardingStepCommand } = require("../src/app/onboarding-cli");
const { runContextBriefingCommand } = require("../src/app/context-briefing-cli");
const { buildCheckinTriggerPayload } = require("../src/checkin");

function createOnboardingFixture(overrides = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-onboarding-"));
  const stateDir = path.join(workspaceRoot, ".codeksei-state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "# Workspace Contract\n", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# README\n", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "Home.md"), "# Home\n", "utf8");
  return {
    config: {
      allowedUserIds: ["wx-user"],
      onboardingSemanticHost: "deterministic",
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

test("onboarding flow prefers semantic extraction, writes fallback companion note, and reaches ready", async () => {
  const fixture = createOnboardingFixture({
    onboardingSemanticGenerator: async ({ currentMessage }: { currentMessage: string }) => {
      if (/接下来/u.test(currentMessage)) {
        return {
          facts: [
            {
              confidence: 0.94,
              domain: "work",
              evidence: "接下来这周我最想先把 onboarding 和 context board 接起来。",
              statement: "这周想先把 onboarding 和 context board 接起来。",
              suggested_kind: "next",
              suggested_slot: "next",
              time_scope: "near_term",
              stability: "current",
            },
          ],
          corrections: [],
          gaps: [],
          unsafe_inferences: [],
        };
      }
      return {
        facts: [
          {
            confidence: 0.95,
            domain: "biography",
            evidence: "我是独立开发者，最近一直在折腾 Codeksei。",
            statement: "独立开发者，最近一直在折腾 Codeksei。",
            suggested_kind: "status",
            suggested_slot: "current_status",
            time_scope: "current",
            stability: "stable",
          },
          {
            confidence: 0.91,
            domain: "experiences",
            evidence: "下午两点以后比较能动。",
            statement: "下午两点以后通常比较能动。",
            suggested_kind: "pattern",
            suggested_slot: "rhythm",
            time_scope: "ongoing",
            stability: "current",
          },
          {
            confidence: 0.89,
            domain: "preferences",
            evidence: "你可以短一点直接一点。",
            statement: "更喜欢短一点、直接一点的表达。",
            suggested_kind: "preference",
            suggested_slot: "preference",
            time_scope: "stable",
            stability: "stable",
          },
          {
            confidence: 0.93,
            domain: "preferences",
            evidence: "晚上别来追我太紧。",
            statement: "晚上不要追得太紧。",
            suggested_kind: "boundary",
            suggested_slot: "boundary",
            time_scope: "ongoing",
            stability: "current",
          },
        ],
        corrections: [],
        gaps: [
          {
            domain: "work",
            priority: "high",
            reason: "还缺一个近期会发生的真实落点。",
            slot_id: "next",
            tone_hint: "顺着眼前项目聊下一个真实动作。",
          },
        ],
        unsafe_inferences: [],
      };
    },
  });

  const started = await runOnboardingStartCommand(fixture.config, ["--user", fixture.userId]);
  assert.equal(started.data.state.status, "in_progress");
  assert.doesNotMatch(String(started.text || ""), /current_status|onboarding|schema/u);

  const firstStep = await runOnboardingStepCommand(fixture.config, [
    "--user", fixture.userId,
    "--session", started.data.state.sessionId,
    "--text", "我是独立开发者，最近一直在折腾 Codeksei。下午两点以后比较能动，晚上别来追我太紧。你可以短一点直接一点。",
  ]);
  assert.equal(firstStep.data.state.status, "in_progress");
  assert.deepEqual(firstStep.data.state.missingSlots, ["next"]);
  assert.match(String(firstStep.text || ""), /接下来/u);

  const secondStep = await runOnboardingStepCommand(fixture.config, [
    "--user", fixture.userId,
    "--session", started.data.state.sessionId,
    "--text", "接下来这周我最想先把 onboarding 和 context board 接起来。",
  ]);
  assert.equal(secondStep.data.state.status, "ready");

  const profilePath = path.join(fixture.stateDir, "companions", fixture.userId, "profile.md");
  const profileContent = fs.readFileSync(profilePath, "utf8");
  assert.match(profileContent, /^# Codeksei Companion Profile/mu);
  assert.match(profileContent, /独立开发者/u);
  assert.match(profileContent, /下午两点以后通常比较能动/u);
  assert.match(profileContent, /更喜欢短一点、直接一点的表达/u);
  assert.match(profileContent, /晚上不要追得太紧/u);
  assert.match(profileContent, /这周想先把 onboarding 和 context board 接起来/u);
  assert.doesNotMatch(profileContent, /psychometrics|slot|domain|onboarding schema/u);

  const briefing = await runContextBriefingCommand(fixture.config, [
    "--user", fixture.userId,
    "--workspace", fixture.config.workspaceRoot,
  ]);
  assert.match(String(briefing.text || ""), /独立开发者/u);
  assert.match(String(briefing.data.boardText || ""), /onboarding：ready/u);
});

test("semantic corrections replace prior managed preference lines and ignore unsafe psychometric labels", async () => {
  const fixture = createOnboardingFixture({
    onboardingSemanticGenerator: async ({ currentMessage }: { currentMessage: string }) => {
      if (/别写太长/u.test(currentMessage)) {
        return {
          facts: [],
          corrections: [
            {
              confidence: 0.95,
              domain: "preferences",
              evidence: "别写太长，先给结论。",
              statement: "更喜欢先给结论，不要写太长。",
              suggested_kind: "preference",
              suggested_slot: "preference",
              replaces: ["更喜欢短一点、直接一点的表达。"],
              time_scope: "stable",
              stability: "stable",
            },
          ],
          gaps: [],
          unsafe_inferences: [
            {
              domain: "psychometrics",
              statement: "用户是很典型的 ADHD 型人格。",
              reason: "这是强标签和诊断式推断，不应落 durable truth。",
            },
          ],
        };
      }
      return {
        facts: [
          {
            confidence: 0.95,
            domain: "preferences",
            evidence: "你可以短一点直接一点。",
            statement: "更喜欢短一点、直接一点的表达。",
            suggested_kind: "preference",
            suggested_slot: "preference",
            time_scope: "stable",
            stability: "stable",
          },
          {
            confidence: 0.95,
            domain: "biography",
            evidence: "我是独立开发者。",
            statement: "独立开发者。",
            suggested_kind: "status",
            suggested_slot: "current_status",
            time_scope: "stable",
            stability: "stable",
          },
          {
            confidence: 0.9,
            domain: "experiences",
            evidence: "下午效率高。",
            statement: "下午效率通常比较高。",
            suggested_kind: "pattern",
            suggested_slot: "rhythm",
            time_scope: "ongoing",
            stability: "current",
          },
          {
            confidence: 0.9,
            domain: "preferences",
            evidence: "别太密。",
            statement: "不要太密集地打扰。",
            suggested_kind: "boundary",
            suggested_slot: "boundary",
            time_scope: "ongoing",
            stability: "current",
          },
          {
            confidence: 0.9,
            domain: "work",
            evidence: "接下来我会先补 onboarding CLI。",
            statement: "接下来会先补 onboarding CLI。",
            suggested_kind: "next",
            suggested_slot: "next",
            time_scope: "near_term",
            stability: "current",
          },
        ],
        corrections: [],
        gaps: [],
        unsafe_inferences: [],
      };
    },
  });

  const started = await runOnboardingStartCommand(fixture.config, ["--user", fixture.userId]);
  await runOnboardingStepCommand(fixture.config, [
    "--user", fixture.userId,
    "--session", started.data.state.sessionId,
    "--text", "我是独立开发者。下午效率高。你可以短一点直接一点。别太密。接下来我会先补 onboarding CLI。",
  ]);
  await runOnboardingStepCommand(fixture.config, [
    "--user", fixture.userId,
    "--session", started.data.state.sessionId,
    "--text", "别写太长，先给结论。",
  ]);

  const profilePath = path.join(fixture.stateDir, "companions", fixture.userId, "profile.md");
  const profileContent = fs.readFileSync(profilePath, "utf8");
  assert.match(profileContent, /更喜欢先给结论，不要写太长/u);
  assert.doesNotMatch(profileContent, /更喜欢短一点、直接一点的表达/u);
  assert.doesNotMatch(profileContent, /ADHD|人格/u);
});

test("semantic failure falls back to deterministic extraction", async () => {
  const fixture = createOnboardingFixture({
    onboardingSemanticGenerator: async () => {
      throw new Error("semantic unavailable");
    },
  });

  const started = await runOnboardingStartCommand(fixture.config, ["--user", fixture.userId]);
  const firstStep = await runOnboardingStepCommand(fixture.config, [
    "--user", fixture.userId,
    "--session", started.data.state.sessionId,
    "--text", "我是独立开发者，最近在做 Codeksei。下午效率高。你可以短一点，别太密。接下来我会先补 onboarding CLI。",
  ]);

  assert.match(String(firstStep.text || ""), /已经大概摸到你的节奏了|接下来/u);
  const profilePath = path.join(fixture.stateDir, "companions", fixture.userId, "profile.md");
  const profileContent = fs.readFileSync(profilePath, "utf8");
  assert.match(profileContent, /独立开发者/u);
  assert.match(profileContent, /下午效率高/u);
});

test("onboarding status and reset keep long-term companion note intact", async () => {
  const fixture = createOnboardingFixture();
  const started = await runOnboardingStartCommand(fixture.config, ["--user", fixture.userId]);
  await runOnboardingStepCommand(fixture.config, [
    "--user", fixture.userId,
    "--session", started.data.state.sessionId,
    "--text", "我是独立开发者，最近在做 Codeksei。下午效率高。你可以短一点，别太密。接下来我会先补 onboarding CLI。",
  ]);

  const beforeReset = await runOnboardingStatusCommand(fixture.config, ["--user", fixture.userId]);
  assert.match(String(beforeReset.text || ""), /status: ready|status: in_progress/u);

  const reset = await runOnboardingResetCommand(fixture.config, ["--user", fixture.userId]);
  assert.equal(reset.data.state.status, "not_started");

  const profilePath = path.join(fixture.stateDir, "companions", fixture.userId, "profile.md");
  assert.equal(fs.existsSync(profilePath), true);
});

test("checkin payload uses onboarding-specific proactive copy before the profile is ready", () => {
  const fixture = createOnboardingFixture();
  const payload = buildCheckinTriggerPayload({
    stateDir: fixture.stateDir,
    userName: "单道杨",
  }, {
    senderId: fixture.userId,
    senderSource: "explicit",
    workspaceRoot: fixture.config.workspaceRoot,
    workspaceSource: "explicit",
  });

  assert.match(payload.text, /first real activation/u);
  assert.match(payload.text, /Do not sound like a survey/u);
});
