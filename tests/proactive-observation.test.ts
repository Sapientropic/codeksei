const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildProactiveObservationPrompt,
}: typeof import("../src/proactive/observation-prompt") = require("../src/proactive/observation-prompt");
const {
  normalizeProactiveObservation,
}: typeof import("../src/proactive/observation-normalize") = require("../src/proactive/observation-normalize");
const {
  readReusableProactiveObservation,
  writeProactiveObservation,
}: typeof import("../src/proactive/observation-store") = require("../src/proactive/observation-store");

test("proactive observation normalizer keeps valid high-confidence signal and drops unsafe payloads", () => {
  const observation = normalizeProactiveObservation({
    annoyanceRisk: "LOW",
    confidence: 0.81,
    currentStateHypothesis: "用户还在收口 proactive 设计，但需要低压重入。",
    evidence: ["用户要求优化主动判断层", "明确选择 Gemma 4 E2B-it"],
    likelyBlocker: "担心小模型能力被短 JSON 限制。",
    memoryCandidates: [
      {
        confidence: 0.77,
        evidence: "希望小模型作为云端大模型主 agent 的记忆层。",
        kind: "next",
        slotId: "next",
        text: "后续希望把拍照、音频和生活记录结构化为主 agent 记忆层。",
      },
      {
        confidence: 0.9,
        evidence: "invalid slot should be ignored",
        kind: "next",
        slotId: "unsupported",
        text: "bad",
      },
    ],
    modalityHints: ["text", "voice", "unsupported"],
    reentryCandidate: "先实现 observation layer，再跑 fixture eval。",
    stateSignals: ["project_reentry", "memory_candidate", "not_allowed"],
    suggestedTone: "短、自然、不要催促。",
    surfaceRisk: "medium",
    userEnergy: "medium",
  }, {
    host: "local",
    minConfidence: 0.55,
    model: "gemma-4-E2B-it",
    now: new Date("2026-04-21T08:00:00.000Z"),
    sourceHash: "src_hash_1",
  });

  assert.equal(observation?.kind, "proactive_observation");
  assert.equal(observation?.version, 1);
  assert.equal(observation?.sourceHash, "src_hash_1");
  assert.equal(observation?.model.host, "local");
  assert.equal(observation?.model.model, "gemma-4-E2B-it");
  assert.equal(observation?.confidence, 0.81);
  assert.equal(observation?.usable, true);
  assert.equal(observation?.discardReason, "");
  assert.deepEqual(observation?.stateSignals, ["project_reentry", "memory_candidate"]);
  assert.deepEqual(observation?.modalityHints, ["text", "voice"]);
  assert.equal(observation?.memoryCandidates.length, 1);
  assert.equal(observation?.memoryCandidates[0]?.slotId, "next");

  const lowConfidence = normalizeProactiveObservation({
    confidence: 0.2,
    evidence: ["weak"],
    surfaceRisk: "low",
  }, {
    host: "local",
    minConfidence: 0.55,
    model: "gemma-4-E2B-it",
    now: new Date("2026-04-21T08:00:00.000Z"),
    sourceHash: "src_hash_1",
  });
  assert.equal(lowConfidence?.usable, false);
  assert.match(String(lowConfidence?.discardReason || ""), /confidence/u);

  const noEvidence = normalizeProactiveObservation({
    confidence: 0.9,
    evidence: [],
    surfaceRisk: "low",
  }, {
    host: "local",
    minConfidence: 0.55,
    model: "gemma-4-E2B-it",
    now: new Date("2026-04-21T08:00:00.000Z"),
    sourceHash: "src_hash_1",
  });
  assert.equal(noEvidence?.usable, false);
  assert.match(String(noEvidence?.discardReason || ""), /evidence/u);
});

test("proactive observation prompt redacts target identifiers and absolute paths", () => {
  const prompt = buildProactiveObservationPrompt({
    checkin: {
      lastCompletionAt: "",
      lastCompletionResult: "",
      nextWakeAt: "",
      pendingHandoffExists: false,
    },
    contextBriefing: {
      followupContext: "继续看 /Users/luciano/private/secret.md",
      stale: false,
      staleReasons: [],
    },
    now: "2026-04-21T08:00:00.000Z",
    recentOutcomes: [],
    stateCard: {
      activeThread: "Codeksei proactive observation layer",
      currentLikelyState: "用户正在设计小模型观察层。",
      doNotDo: ["不要催促，也不要暴露 /home/luciano/secrets.txt"],
      easiestReentryStep: "/Users/luciano/private/secret.md - read first",
      likelyBlocker: "担心本地模型输出不稳。",
      sourceThickness: "strong",
      toneHint: "短、自然；可参考 /Volumes/Vault/project.md 和 /tmp/private.log",
    },
    target: {
      senderId: "wx-secret-user",
      targetKey: "wx-secret-user::/Users/luciano/private/workspace",
      workspaceRoot: "/Users/luciano/private/workspace",
    },
    timezone: "Asia/Shanghai",
  });

  assert.doesNotMatch(prompt, /wx-secret-user/u);
  assert.doesNotMatch(prompt, /\/Users\/luciano\/private/u);
  assert.doesNotMatch(prompt, /\/home\/luciano/u);
  assert.doesNotMatch(prompt, /\/Volumes\/Vault/u);
  assert.doesNotMatch(prompt, /\/tmp\/private/u);
  assert.match(prompt, /targetKeyHash/u);
  assert.match(prompt, /Codeksei proactive observation layer/u);
});

test("proactive observation store reuses only fresh matching usable source hash", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-observation-store-"));
  const target = {
    senderId: "wx-user",
    targetKey: "wx-user::/workspace",
    workspaceRoot: "/workspace",
  };
  const observation = normalizeProactiveObservation({
    annoyanceRisk: "low",
    confidence: 0.8,
    currentStateHypothesis: "仍在同一项目线。",
    evidence: ["context board strong"],
    reentryCandidate: "继续写 observation tests。",
    stateSignals: ["project_reentry"],
    surfaceRisk: "low",
  }, {
    host: "local",
    minConfidence: 0.55,
    model: "gemma-4-E2B-it",
    now: new Date("2026-04-21T08:00:00.000Z"),
    sourceHash: "hash-a",
  });
  assert.ok(observation);

  writeProactiveObservation({ stateDir }, target, observation);

  const fresh = readReusableProactiveObservation({ stateDir }, target, {
    maxAgeMs: 60_000,
    now: new Date("2026-04-21T08:00:30.000Z"),
    sourceHash: "hash-a",
  });
  assert.equal(fresh?.id, observation.id);

  const mismatch = readReusableProactiveObservation({ stateDir }, target, {
    maxAgeMs: 60_000,
    now: new Date("2026-04-21T08:00:30.000Z"),
    sourceHash: "hash-b",
  });
  assert.equal(mismatch, null);

  const stale = readReusableProactiveObservation({ stateDir }, target, {
    maxAgeMs: 60_000,
    now: new Date("2026-04-21T08:02:30.000Z"),
    sourceHash: "hash-a",
  });
  assert.equal(stale, null);

  const unusable = {
    ...observation,
    discardReason: "confidence 0.20 below 0.55",
    id: "po_unusable",
    usable: false,
  };
  writeProactiveObservation({ stateDir }, target, unusable);
  const reusedUnusable = readReusableProactiveObservation({ stateDir }, target, {
    maxAgeMs: 60_000,
    now: new Date("2026-04-21T08:00:30.000Z"),
    sourceHash: "hash-a",
  });
  assert.equal(reusedUnusable, null);
});

test("proactive observation store normalizes persisted shape instead of trusting casts", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-observation-store-bad-shape-"));
  const target = {
    senderId: "wx-user",
    targetKey: "wx-user::/workspace",
    workspaceRoot: "/workspace",
  };
  const storePath = path.join(stateDir, "proactive", "observations", "wx-user_workspace.json");
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({
    latest: {
      confidence: "0.8",
      evidence: "not-array",
      id: "po_bad",
      kind: "proactive_observation",
      model: null,
      sourceHash: "hash-bad",
      version: 1,
    },
    recent: [
      {
        confidence: 0.75,
        createdAt: "2026-04-21T08:00:00.000Z",
        currentStateHypothesis: "valid recent",
        discardReason: "",
        evidence: ["valid"],
        id: "po_valid_recent",
        kind: "proactive_observation",
        memoryCandidates: [],
        modalityHints: ["text"],
        model: {
          fallbackReason: "",
          host: "local",
          model: "gemma-4-E2B-it",
          used: true,
        },
        sourceHash: "hash-valid",
        stateSignals: ["project_reentry"],
        surfaceRisk: "low",
        annoyanceRisk: "low",
        usable: true,
        userEnergy: "medium",
        version: 1,
      },
    ],
  }, null, 2), "utf8");

  const {
    readObservationState,
  }: typeof import("../src/proactive/observation-store") = require("../src/proactive/observation-store");
  const state = readObservationState({ stateDir }, target);
  assert.equal(state.latest, null);
  assert.equal(state.recent.length, 1);
  assert.equal(state.recent[0]?.id, "po_valid_recent");
});
