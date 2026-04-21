const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildProactiveDecision,
}: typeof import("../src/proactive/decision") = require("../src/proactive/decision");

type ProactiveJudgmentInput = import("../src/proactive/contracts").ProactiveJudgmentInput;

function baseInput(overrides: Partial<ProactiveJudgmentInput> = {}): ProactiveJudgmentInput {
  return {
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
    now: "2026-04-21T07:30:00.000Z",
    recentOutcomes: [],
    stateCard: {
      activeThread: "Codeksei proactive judgment core",
      currentLikelyState: "User is refining the proactive product direction.",
      doNotDo: ["Do not sound like debt collection."],
      easiestReentryStep: "Summarize the current blocker and offer one next step.",
      likelyBlocker: "The current check-in behavior feels stiff.",
      sourceThickness: "strong",
      toneHint: "short, natural, low-pressure",
    },
    target: {
      senderId: "wx-user",
      targetKey: "wx-user::/workspace",
      workspaceRoot: "/workspace",
    },
    timezone: "Asia/Shanghai",
    ...overrides,
  } as ProactiveJudgmentInput;
}

test("proactive decision falls back deterministically without a model", async () => {
  const decision = await buildProactiveDecision({
    proactiveJudgmentHost: "deterministic",
    proactiveJudgmentMinConfidence: 0.62,
    proactiveJudgmentMode: "hybrid",
    proactiveJudgmentModel: "",
    proactiveJudgmentTimeoutMs: 2500,
  }, baseInput());

  assert.equal(decision.kind, "proactive_decision");
  assert.equal(decision.reasonCode, "project_reentry");
  assert.equal(decision.interventionLevel, "offer_next_step");
  assert.equal(decision.shouldSurface, true);
  assert.equal(decision.model.used, false);
  assert.equal(decision.model.host, "deterministic");
  assert.match(decision.suggestedMessage, /Summarize the current blocker/u);
});

test("proactive decision downgrades push_forward when voice energy is low", async () => {
  const decision = await buildProactiveDecision({
    proactiveJudgmentHost: "deterministic",
    proactiveJudgmentMinConfidence: 0.62,
    proactiveJudgmentMode: "hybrid",
    proactiveJudgmentModel: "",
    proactiveJudgmentTimeoutMs: 2500,
  }, baseInput({
    voiceSignal: {
      confidence: 0.91,
      durationMs: 8000,
      emotion: "tired",
      energy: "low",
      source: "sensevoice",
      transcript: "算了我等会再说吧",
    },
  }));

  assert.equal(decision.reasonCode, "voice_low_energy");
  assert.equal(decision.interventionLevel, "backstage_only");
  assert.equal(decision.outputModality, "backstage_only");
  assert.equal(decision.shouldSurface, false);
});

test("proactive decision uses a valid high-confidence semantic result", async () => {
  const decision = await buildProactiveDecision({
    proactiveJudgmentGenerator: async () => ({
      backstageActions: [
        {
          kind: "project_note",
          status: "suggested",
          summary: "Record the proactive judgment interface decision.",
        },
      ],
      confidence: 0.84,
      interventionLevel: "light_nudge",
      nextWakePolicy: {
        mode: "sleep_for",
        reason: "Follow up after the product thread has had time to settle.",
        sleepFor: "2h",
      },
      outputModality: "text",
      reasonCode: "scheduled_followup",
      shouldSurface: true,
      suggestedMessage: "我先把这条主动判断层的接口收一下，然后两小时后轻轻接回。",
      userVisibleReason: "This is a timely follow-up with enough context.",
    }),
    proactiveJudgmentHost: "local",
    proactiveJudgmentMinConfidence: 0.62,
    proactiveJudgmentMode: "hybrid",
    proactiveJudgmentModel: "local-small",
    proactiveJudgmentTimeoutMs: 2500,
  }, baseInput());

  assert.equal(decision.reasonCode, "scheduled_followup");
  assert.equal(decision.interventionLevel, "light_nudge");
  assert.equal(decision.model.used, true);
  assert.equal(decision.model.host, "local");
  assert.equal(decision.model.model, "local-small");
  assert.equal(decision.backstageActions[0]?.kind, "project_note");
});

test("proactive decision falls back when semantic confidence is too low", async () => {
  const decision = await buildProactiveDecision({
    proactiveJudgmentGenerator: async () => ({
      confidence: 0.2,
      interventionLevel: "push_forward",
      reasonCode: "scheduled_followup",
      shouldSurface: true,
      suggestedMessage: "Do it now.",
      userVisibleReason: "low confidence",
    }),
    proactiveJudgmentHost: "local",
    proactiveJudgmentMinConfidence: 0.62,
    proactiveJudgmentMode: "hybrid",
    proactiveJudgmentModel: "local-small",
    proactiveJudgmentTimeoutMs: 2500,
  }, baseInput());

  assert.equal(decision.model.used, false);
  assert.equal(decision.model.host, "deterministic");
  assert.match(decision.model.fallbackReason, /confidence/u);
  assert.notEqual(decision.interventionLevel, "push_forward");
});

test("proactive decision uses observation as signal without bypassing guardrails", async () => {
  const decision = await buildProactiveDecision({
    proactiveJudgmentHost: "deterministic",
    proactiveJudgmentMode: "hybrid",
  }, baseInput({
    contextBriefing: {
      followupContext: "",
      stale: false,
      staleReasons: [],
    },
    observation: {
      annoyanceRisk: "low",
      confidence: 0.82,
      createdAt: "2026-04-21T07:20:00.000Z",
      currentStateHypothesis: "用户正在评估小模型观察层是否值得做。",
      discardReason: "",
      evidence: ["用户要求先优化这层，为小模型发挥能力做准备。"],
      id: "po_test_reentry",
      kind: "proactive_observation",
      likelyBlocker: "担心短 JSON 限制模型能力。",
      memoryCandidates: [],
      modalityHints: ["text"],
      model: {
        fallbackReason: "",
        host: "local",
        model: "gemma-4-E2B-it",
        used: true,
      },
      reentryCandidate: "先把 ProactiveObservation 接入 context board 和 decision。",
      sourceHash: "hash-reentry",
      stateSignals: ["project_reentry"],
      suggestedTone: "短、自然、给一个下一步。",
      surfaceRisk: "low",
      usable: true,
      userEnergy: "medium",
      version: 1,
    },
    stateCard: {
      activeThread: "",
      currentLikelyState: "当前上下文可用，但缺少具体重入入口。",
      doNotDo: ["不要催促。"],
      easiestReentryStep: "",
      likelyBlocker: "",
      sourceThickness: "usable",
      toneHint: "短、自然。",
    },
  }));

  assert.equal(decision.reasonCode, "project_reentry");
  assert.equal(decision.interventionLevel, "offer_next_step");
  assert.match(decision.suggestedMessage, /ProactiveObservation/u);
  assert.match(decision.userVisibleReason, /小模型观察/u);

  const guarded = await buildProactiveDecision({
    proactiveJudgmentHost: "deterministic",
    proactiveJudgmentMode: "hybrid",
  }, baseInput({
    observation: {
      annoyanceRisk: "low",
      confidence: 0.9,
      createdAt: "2026-04-21T07:20:00.000Z",
      currentStateHypothesis: "用户低能量。",
      discardReason: "",
      evidence: ["voice energy low"],
      id: "po_test_low_energy",
      kind: "proactive_observation",
      likelyBlocker: "需要先休息。",
      memoryCandidates: [],
      modalityHints: ["voice"],
      model: {
        fallbackReason: "",
        host: "local",
        model: "gemma-4-E2B-it",
        used: true,
      },
      reentryCandidate: "继续推动任务。",
      sourceHash: "hash-low",
      stateSignals: ["user_low_energy"],
      suggestedTone: "轻一点。",
      surfaceRisk: "low",
      usable: true,
      userEnergy: "low",
      version: 1,
    },
    voiceSignal: {
      confidence: 0.91,
      durationMs: 8000,
      emotion: "tired",
      energy: "low",
      source: "sensevoice",
      transcript: "算了我等会再说吧",
    },
  }));

  assert.equal(guarded.reasonCode, "voice_low_energy");
  assert.equal(guarded.interventionLevel, "backstage_only");
  assert.equal(guarded.shouldSurface, false);
});

test("proactive decision does not let overconfident observation invent reentry from thin context", async () => {
  const decision = await buildProactiveDecision({
    proactiveJudgmentHost: "deterministic",
    proactiveJudgmentMode: "hybrid",
  }, baseInput({
    contextBriefing: {
      followupContext: "",
      stale: true,
      staleReasons: ["missing_today_diary"],
    },
    observation: {
      annoyanceRisk: "low",
      confidence: 0.96,
      createdAt: "2026-04-21T07:20:00.000Z",
      currentStateHypothesis: "用户肯定要继续推进。",
      discardReason: "",
      evidence: ["thin context"],
      id: "po_test_overconfident",
      kind: "proactive_observation",
      likelyBlocker: "需要继续。",
      memoryCandidates: [],
      modalityHints: ["text"],
      model: {
        fallbackReason: "",
        host: "local",
        model: "gemma-4-E2B-it",
        used: true,
      },
      reentryCandidate: "直接继续实现下一步。",
      sourceHash: "hash-thin",
      stateSignals: ["project_reentry"],
      suggestedTone: "直接推进。",
      surfaceRisk: "low",
      usable: true,
      userEnergy: "medium",
      version: 1,
    },
    stateCard: {
      activeThread: "",
      currentLikelyState: "当前判断上下文偏薄，需要先确认用户此刻状态。",
      doNotDo: ["不要假装知道。"],
      easiestReentryStep: "",
      likelyBlocker: "缺少 context board。",
      sourceThickness: "thin",
      toneHint: "短、自然、先确认。",
    },
  }));

  assert.equal(decision.reasonCode, "context_thin");
  assert.equal(decision.interventionLevel, "state_check");
  assert.doesNotMatch(decision.suggestedMessage, /直接继续/u);
});
