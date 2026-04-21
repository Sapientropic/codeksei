const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { CheckinScheduleStateStore } = require("../src/state/checkin-schedule-state-store");
const { buildCheckinTargetKey } = require("../src/checkin");
const { runProactiveObserveCommand } = require("../src/app/proactive-observe-cli");
const { runProactiveEvalCommand } = require("../src/app/proactive-eval-cli");
const {
  readObservationState,
} = require("../src/proactive/observation-store");

function createFixture(prefix: string) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const stateDir = path.join(workspaceRoot, ".codeksei-state");
  const diaryDir = path.join(stateDir, "diary");
  fs.mkdirSync(diaryDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "# Workspace Contract\n", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# README\n", "utf8");
  const target = {
    senderId: "wx-user",
    senderSource: "explicit",
    workspaceRoot: workspaceRoot.replace(/\\/g, "/"),
    workspaceSource: "explicit",
  };
  const checkinScheduleStateFile = path.join(stateDir, "checkin-schedule-state.json");
  new CheckinScheduleStateStore({ filePath: checkinScheduleStateFile }).setState({
    activeWake: null,
    lastCompletion: {
      completedAt: new Date().toISOString(),
      nextWakeAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      result: "silent",
      scheduleSource: "agent",
      triggerId: "trigger-1",
    },
    nextWakeAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    pendingTrigger: null,
    scheduleSource: "agent",
    senderId: target.senderId,
    targetKey: buildCheckinTargetKey(target),
    updatedAt: new Date().toISOString(),
    workspaceRoot: target.workspaceRoot,
  });
  return {
    config: {
      allowedUserIds: [target.senderId],
      checkinScheduleStateFile,
      diaryDir,
      proactiveObservationGenerator: async () => ({
        annoyanceRisk: "low",
        confidence: 0.84,
        currentStateHypothesis: "用户正在验证 proactive observation CLI。",
        evidence: ["fixture context board"],
        likelyBlocker: "需要先确认 CLI 不自动写长期记忆。",
        memoryCandidates: [
          {
            confidence: 0.71,
            evidence: "用户提到未来想让小模型整理生活记录。",
            kind: "next",
            slotId: "next",
            text: "未来希望小模型整理生活记录作为主 agent 记忆层。",
          },
        ],
        modalityHints: ["text"],
        reentryCandidate: "运行 proactive eval fixture。",
        stateSignals: ["project_reentry", "memory_candidate"],
        suggestedTone: "短、自然。",
        surfaceRisk: "low",
        userEnergy: "medium",
      }),
      proactiveObservationHost: "local",
      proactiveObservationMinConfidence: 0.55,
      proactiveObservationMode: "hybrid",
      proactiveObservationModel: "gemma-4-E2B-it",
      proactiveObservationTimeoutMs: 8000,
      sessionsFile: path.join(stateDir, "sessions.json"),
      stateDir,
      timezone: "Asia/Shanghai",
      workspaceRoot: target.workspaceRoot,
    },
    stateDir,
    target,
    workspaceRoot,
  };
}

test("proactive observe dry-run returns observation without writing store", async () => {
  const fixture = createFixture("codeksei-proactive-observe-dry-");

  const result = await runProactiveObserveCommand(fixture.config, [
    "--user", fixture.target.senderId,
    "--workspace", fixture.workspaceRoot,
    "--dry-run",
  ]);

  assert.equal(result.data.status, "observed");
  assert.equal(result.data.observation.kind, "proactive_observation");
  assert.equal(result.data.observation.model.model, "gemma-4-E2B-it");
  const state = readObservationState(fixture.config, fixture.target);
  assert.equal(state.latest, null);
});

test("proactive observe show reads latest observation without calling model", async () => {
  const fixture = createFixture("codeksei-proactive-observe-show-");
  await runProactiveObserveCommand(fixture.config, [
    "--user", fixture.target.senderId,
    "--workspace", fixture.workspaceRoot,
  ]);
  let modelCalls = 0;
  const shown = await runProactiveObserveCommand({
    ...fixture.config,
    proactiveObservationGenerator: async () => {
      modelCalls += 1;
      return {};
    },
  }, [
    "--user", fixture.target.senderId,
    "--workspace", fixture.workspaceRoot,
    "--show",
  ]);

  assert.equal(modelCalls, 0);
  assert.equal(shown.data.status, "shown");
  assert.equal(shown.data.latest.usable, true);
  assert.equal(typeof shown.data.currentSourceHash, "string");
  assert.equal(shown.data.latest.expired, false);
});

test("proactive observe writes observation store and refreshes context board by default", async () => {
  const fixture = createFixture("codeksei-proactive-observe-write-");

  const result = await runProactiveObserveCommand(fixture.config, [
    "--user", fixture.target.senderId,
    "--workspace", fixture.workspaceRoot,
  ]);

  assert.equal(result.data.status, "observed");
  assert.equal(result.data.written, true);
  const state = readObservationState(fixture.config, fixture.target);
  assert.equal(state.latest?.id, result.data.observation.id);
  assert.match(String(result.data.briefingText || ""), /小模型观察/u);
});

test("proactive eval scores fixture cases without writing local state", async () => {
  const fixture = createFixture("codeksei-proactive-eval-");
  const fixturePath = path.join(fixture.workspaceRoot, "proactive-observation-cases.json");
  fs.writeFileSync(fixturePath, JSON.stringify({
    cases: [
      {
        expected: {
          decisionReasonCode: "project_reentry",
          observationStateSignal: "project_reentry",
          shouldSurface: true,
        },
        id: "project-reentry",
        input: {
          checkin: {
            lastCompletionAt: "",
            lastCompletionResult: "",
            nextWakeAt: "",
            pendingHandoffExists: false,
          },
          contextBriefing: {
            followupContext: "",
            stale: false,
            staleReasons: [],
          },
          now: "2026-04-21T08:00:00.000Z",
          recentOutcomes: [],
          stateCard: {
            activeThread: "",
            currentLikelyState: "用户在推进 proactive observation。",
            doNotDo: ["不要催促"],
            easiestReentryStep: "",
            likelyBlocker: "",
            sourceThickness: "usable",
            toneHint: "短、自然",
          },
          target: {
            senderId: "wx-user",
            targetKey: `wx-user::${fixture.workspaceRoot}`,
            workspaceRoot: fixture.workspaceRoot,
          },
          timezone: "Asia/Shanghai",
        },
      },
    ],
  }, null, 2), "utf8");

  const result = await runProactiveEvalCommand(fixture.config, [
    "--fixture", fixturePath,
  ]);

  assert.equal(result.data.summary.total, 1);
  assert.equal(result.data.summary.parseSuccessCount, 1);
  assert.equal(result.data.summary.fieldAccuracy, 1);
  assert.equal(result.data.cases[0].decision.reasonCode, "project_reentry");
  const state = readObservationState(fixture.config, fixture.target);
  assert.equal(state.latest, null);
});
