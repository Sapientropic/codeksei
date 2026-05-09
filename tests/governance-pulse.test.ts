const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { CheckinScheduleStateStore } = require("../src/state/checkin-schedule-state-store");
const { buildCheckinTargetKey } = require("../src/checkin");
const { runCapabilitiesStatusCommand } = require("../src/app/capabilities-status-cli");
const { runContextInspectCommand } = require("../src/app/context-inspect-cli");
const { renderContextInspectText } = require("../src/context/inspect");
const { runPulseCommand } = require("../src/app/pulse-cli");
const { runHostManifestCommand } = require("../src/app/host-manifest-cli");
const { getCurrentDateStringInTimezone } = require("../src/core/timezone");
const { evaluateContextPacks } = require("../src/context/context-packs");
const { createOnboardingStateStore } = require("../src/onboarding/state");

function createGovernanceFixture(prefix: string) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const stateDir = path.join(workspaceRoot, ".codeksei-state");
  const diaryDir = path.join(stateDir, "diary");
  const codexDir = path.join(workspaceRoot, ".codex");
  const notesDir = path.join(workspaceRoot, "notes");
  const timezone = "Asia/Shanghai";
  const target = {
    senderId: "wx-user",
    senderSource: "explicit",
    workspaceRoot: workspaceRoot.replace(/\\/g, "/"),
    workspaceSource: "explicit",
  };
  fs.mkdirSync(diaryDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# Codeksei fixture\n", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "# Agent fixture\n", "utf8");
  fs.writeFileSync(path.join(notesDir, "Companion.md"), [
    "# Companion",
    "",
    "## 当前定位",
    "今天在收口 Codeksei 的治理解释层。",
    "",
    "## 支持偏好",
    "- 先给结论，再给细节。",
    "",
    "## 最近动作",
    "- 正在实现 capability status 和 pulse。",
    "",
    "## 下一步",
    "- 先把可解释层跑通，再考虑自动推送。",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(codexDir, "durable-note-schema.json"), JSON.stringify({
    workspaces: {
      [workspaceRoot.replace(/\\/g, "/")]: {
        notes: {
          companion: {
            path: "notes/Companion.md",
            sections: ["当前定位", "支持偏好", "最近动作", "下一步"],
            kinds: {
              preference: { section: "支持偏好", style: "bullet", maxItems: 8 },
            },
          },
        },
      },
    },
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(codexDir, "code-projects.json"), JSON.stringify({
    projects: [
      {
        slug: "codeksei",
        title: "Codeksei",
        repoRoot: workspaceRoot,
        notePath: "notes/Companion.md",
        overviewFiles: ["README.md"],
      },
    ],
  }, null, 2), "utf8");
  return {
    config: {
      allowedUserIds: [target.senderId],
      channel: "weixin",
      channelProvider: "hermes",
      checkinScheduleStateFile: path.join(stateDir, "checkin-schedule-state.json"),
      diaryDir,
      durableNoteSchemaConfigFile: path.join(codexDir, "durable-note-schema.json"),
      projectRadarConfigFile: path.join(codexDir, "code-projects.json"),
      runtime: "hermes",
      sessionsFile: path.join(stateDir, "sessions.json"),
      stateDir,
      timezone,
      userName: "Tester",
      workspaceBootstrapConfigFile: path.join(stateDir, "workspace-bootstrap.json"),
      workspaceRoot: target.workspaceRoot,
    },
    diaryDir,
    stateDir,
    target,
    timezone,
    workspaceRoot,
  };
}

function writeTodayDiary(fixture: ReturnType<typeof createGovernanceFixture>, lines: string[] = []) {
  const today = getCurrentDateStringInTimezone(fixture.timezone);
  fs.writeFileSync(path.join(fixture.diaryDir, `${today}.md`), [
    "# Diary",
    "",
    "## 时间线事实",
    "- 09:30 继续 Codeksei Pulse 设计",
    "- 10:20 排查 Hermes hosted handoff",
    "",
    "## Todo",
    "- [ ] 把 Pulse 卡片限制在 3 张以内",
    "- [x] 看 ETOS Daily Pulse 设计",
    "",
    "## 补充记录",
    "### 10:40 治理层",
    "Capability status 要解释可配置和当前可用的差异。",
    "",
    ...lines,
  ].join("\n"), "utf8");
  return today;
}

function writePendingHandoff(fixture: ReturnType<typeof createGovernanceFixture>) {
  new CheckinScheduleStateStore({ filePath: fixture.config.checkinScheduleStateFile }).setState({
    activeWake: null,
    lastCompletion: {
      completedAt: new Date("2026-04-25T00:00:00.000Z").toISOString(),
      nextWakeAt: new Date("2026-04-25T02:00:00.000Z").toISOString(),
      result: "silent",
      scheduleSource: "agent",
      triggerId: "trigger-old",
    },
    nextWakeAt: new Date("2026-04-25T02:00:00.000Z").toISOString(),
    pendingHandoff: {
      bookkeepingActions: [
        { kind: "project_note", status: "suggested", summary: "把 Pulse 的治理边界写进项目 note。" },
      ],
      followupContext: "主会话需要决定是否把 Pulse 作为今天第一张卡片。",
      handoffCreatedAt: new Date("2026-04-25T01:00:00.000Z").toISOString(),
      handoffExpiresAt: new Date("2026-04-25T03:00:00.000Z").toISOString(),
      observedCurrentState: "用户正在吸收 ETOS 的 Daily Pulse 和工具治理模型。",
      outcome: "backstage_only",
      triggerId: "trigger-pending",
      userVisibleMessage: "",
    },
    pendingTrigger: null,
    scheduleSource: "agent",
    senderId: fixture.target.senderId,
    targetKey: buildCheckinTargetKey(fixture.target),
    updatedAt: new Date("2026-04-25T01:00:00.000Z").toISOString(),
    workspaceRoot: fixture.target.workspaceRoot,
  });
}

function markOnboardingReady(fixture: ReturnType<typeof createGovernanceFixture>) {
  createOnboardingStateStore(fixture.config, fixture.target.senderId).setState({
    coverage: {
      domains: {
        biography: 1,
        experiences: 1,
        preferences: 1,
        psychometrics: 0,
        social_circle: 0,
        work: 1,
      },
      slots: {
        boundary: 1,
        current_status: 1,
        next: 1,
        preference: 1,
        rhythm: 1,
      },
    },
    missingSlots: [],
    sessionId: "ready-fixture",
    status: "ready",
    turnCount: 2,
    updatedAt: new Date("2026-04-25T00:00:00.000Z").toISOString(),
  });
}

test("capabilities status explains configured, available, and blocked commands", async () => {
  const fixture = createGovernanceFixture("codeksei-capabilities-");
  const result = await runCapabilitiesStatusCommand(fixture.config, [
    "--provider", "hermes",
    "--user", fixture.target.senderId,
    "--workspace", fixture.target.workspaceRoot,
  ]);

  assert.equal(Array.isArray(result.data.capabilities), true);
  const timeline = result.data.capabilities.find((entry: { id: string }) => entry.id === "timeline.event");
  assert.ok(timeline);
  assert.equal(timeline.configured, true);
  assert.equal(timeline.availableNow, true);
  assert.equal(timeline.status, "available");
  assert.deepEqual(timeline.hostProfiles, ["codex-mode", "claudecode-mode", "hosted-mode"]);
  assert.equal(timeline.mutability, "write");
  assert.equal(timeline.sideEffect, true);
  assert.equal(timeline.safetyTier, "warned");
  assert.ok(timeline.entrypoints.includes("codeksei timeline event"));

  const doctor = result.data.capabilities.find((entry: { id: string }) => entry.id === "app.doctor");
  assert.ok(doctor);
  assert.equal(doctor.sideEffect, false);

  const bridgeOnly = result.data.capabilities.find((entry: { id: string }) => entry.id === "app.login");
  assert.ok(bridgeOnly);
  assert.equal(bridgeOnly.configured, true);
  assert.equal(bridgeOnly.availableNow, false);
  assert.equal(bridgeOnly.status, "blocked");
  assert.match(bridgeOnly.reasons.join("\n"), /current host profile hosted-mode is not in supported profiles/u);
  assert.match(result.text, /timeline\.event/u);
  assert.match(result.text, /app\.login/u);
});

test("context inspect reports layers, exclusions, pending handoff, redaction, and context pack false positives", async () => {
  const fixture = createGovernanceFixture("codeksei-context-inspect-");
  writePendingHandoff(fixture);
  fs.writeFileSync(path.join(fixture.workspaceRoot, ".codex", "context-packs.json"), JSON.stringify({
    packs: [
      {
        id: "hermes-local-ops",
        enabled: true,
        scope: "workspace",
        triggers: {
          include: ["Hermes"],
          exclude: ["ETOS"],
        },
        modes: ["proactive", "review"],
        budgetChars: 120,
        cooldownHours: 12,
        content: "本机 Hermes 运维时必须先 dry-run，再 diff。",
      },
    ],
  }, null, 2), "utf8");

  const result = await runContextInspectCommand(fixture.config, [
    "--user", fixture.target.senderId,
    "--workspace", fixture.target.workspaceRoot,
    "--mode", "proactive",
    "--text", "ETOS 文档里提到了 Hermes 工具治理，但这不是本机 Hermes 运维。",
  ]);

  assert.equal(result.data.target.senderId, "wx-user");
  assert.equal(result.data.redaction.applied, true);
  assert.equal(result.data.pendingHandoff.exists, true);
  assert.equal(Array.isArray(result.data.layers), true);
  assert.ok(result.data.layers.some((entry: { id: string; included: boolean }) => entry.id === "todayDiary" && entry.included === false));
  assert.ok(result.data.excluded.some((entry: { id: string; reason: string }) => entry.id === "todayDiary" && entry.reason.includes("missing")));
  const packLayer = result.data.layers.find((entry: { id: string }) => entry.id === "contextPack:hermes-local-ops");
  assert.ok(packLayer);
  assert.equal(packLayer.included, false);
  assert.match(packLayer.reason, /exclude trigger/u);
  assert.equal(result.data.onboarding.status, "not_started");
  assert.equal(result.data.onboarding.readyForDailyLoop, false);
  assert.equal(result.data.sourceHealth.thin, true);
  assert.ok(result.data.sourceHealth.missing.includes("todayDiary"));
  assert.equal(typeof result.data.companionMemory.recentWriteCount, "number");
  assert.match(result.text, /onboarding: not_started/u);
  assert.match(result.text, /source health: thin/u);
  assert.doesNotMatch(result.text, new RegExp(fixture.workspaceRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("context inspect text redacts explicit target workspace paths", () => {
  const explicitWorkspace = path.join(os.tmpdir(), "codeksei-sensitive-explicit-workspace");
  const configWorkspace = path.join(os.tmpdir(), "codeksei-config-workspace");
  const text = renderContextInspectText({
    excluded: [],
    layers: [],
    mode: "proactive",
    pendingHandoff: { exists: false },
    redaction: {
      applied: true,
      strategy: "text output redacts sensitive tokens and local workspace/state paths",
    },
    staleReasons: [],
    stateCard: {},
    target: {
      senderId: "wx-user",
      senderSource: "explicit",
      workspaceRoot: explicitWorkspace,
      workspaceSource: "explicit",
    },
    updatedAt: new Date("2026-04-25T00:00:00.000Z").toISOString(),
  }, {
    stateDir: path.join(os.tmpdir(), "codeksei-state"),
    workspaceRoot: configWorkspace,
  });

  assert.doesNotMatch(text, new RegExp(explicitWorkspace.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(text, /<local-path>/u);
});

test("context packs enforce cooldown only after runtime match recording", () => {
  const fixture = createGovernanceFixture("codeksei-context-pack-cooldown-");
  fs.writeFileSync(path.join(fixture.workspaceRoot, ".codex", "context-packs.json"), JSON.stringify({
    packs: [
      {
        id: "daily-pulse-governance",
        enabled: true,
        scope: "workspace",
        triggers: {
          include: ["pulse"],
          exclude: [],
        },
        modes: ["proactive"],
        budgetChars: 120,
        cooldownHours: 2,
        content: "Pulse 命中后应进入冷却，避免连续重复注入。",
      },
    ],
  }, null, 2), "utf8");

  const first = evaluateContextPacks(fixture.config, {
    mode: "proactive",
    now: new Date("2026-04-25T00:00:00.000Z"),
    recordMatches: false,
    scanText: "pulse",
  });
  assert.equal(first.packs[0]?.included, true);

  const second = evaluateContextPacks(fixture.config, {
    mode: "proactive",
    now: new Date("2026-04-25T00:10:00.000Z"),
    recordMatches: true,
    scanText: "pulse",
  });
  assert.equal(second.packs[0]?.included, true);

  const cooled = evaluateContextPacks(fixture.config, {
    mode: "proactive",
    now: new Date("2026-04-25T00:20:00.000Z"),
    scanText: "pulse",
  });
  assert.equal(cooled.packs[0]?.included, false);
  assert.match(cooled.packs[0]?.reason || "", /cooldown active until 2026-04-25T02:10:00.000Z/u);

  const expired = evaluateContextPacks(fixture.config, {
    mode: "proactive",
    now: new Date("2026-04-25T02:11:00.000Z"),
    scanText: "pulse",
  });
  assert.equal(expired.packs[0]?.included, true);
});

test("pulse generate keeps at most three cards, applies feedback penalties, and carries tasks across days", async () => {
  const fixture = createGovernanceFixture("codeksei-pulse-");
  const today = writeTodayDiary(fixture);
  writePendingHandoff(fixture);
  markOnboardingReady(fixture);

  await runPulseCommand(fixture.config, [
    "feedback",
    "--card", "topic:negative-model-chat",
    "--kind", "dislike",
    "--topic", "多模型聊天客户端",
    "--text", "不要把 Codeksei 做成多模型聊天客户端。",
  ]);
  await runPulseCommand(fixture.config, [
    "feedback",
    "--card", "task:carry-pulse",
    "--kind", "task",
    "--topic", "Pulse 任务",
    "--text", "明天继续把 Pulse 做成可继续推进的卡片。",
  ]);
  await runPulseCommand(fixture.config, [
    "feedback",
    "--card", "topic:save-capability-governance",
    "--kind", "save",
    "--topic", "capability governance",
    "--text", "能力治理这条线值得继续保留。",
  ]);

  const result = await runPulseCommand(fixture.config, [
    "generate",
    "--user", fixture.target.senderId,
    "--workspace", fixture.target.workspaceRoot,
    "--date", today,
    "--focus", "今天重点推进 Pulse 和 capability governance",
  ]);

  assert.equal(result.data.date, today);
  assert.equal(result.data.cards.length <= 3, true);
  assert.equal(result.data.cards.some((card: { title: string }) => /多模型聊天客户端/u.test(card.title)), false);
  assert.equal(result.data.cards.some((card: { title: string; why: string }) => /Pulse/u.test(`${card.title} ${card.why}`)), true);
  assert.equal(result.data.cards.some((card: { scoreBreakdown: Record<string, number> }) => card.scoreBreakdown.unfinishedTask === 3), true);
  assert.equal(result.data.cards.some((card: { scoreBreakdown: Record<string, number> }) => card.scoreBreakdown.pendingHandoff === 3), true);
  assert.equal(result.data.cards.some((card: { scoreBreakdown: Record<string, number> }) => card.scoreBreakdown.positiveFeedback === 3), true);
  assert.match(result.text, /Codeksei Pulse/u);

  const todayResult = await runPulseCommand(fixture.config, ["today", "--date", today]);
  assert.equal(todayResult.data.cards.length, result.data.cards.length);
});

test("pulse prioritizes activation repair cards when onboarding and context are thin", async () => {
  const fixture = createGovernanceFixture("codeksei-pulse-thin-");
  const result = await runPulseCommand(fixture.config, [
    "generate",
    "--user", fixture.target.senderId,
    "--workspace", fixture.target.workspaceRoot,
    "--date", "2026-04-25",
  ]);

  assert.equal(result.data.cards.length <= 3, true);
  assert.match(result.data.headline, new RegExp(`${result.data.cards.length} 张卡片`, "u"));
  assert.equal(result.data.cards[0]?.type, "onboarding");
  assert.match(`${result.data.cards[0]?.title} ${result.data.cards[0]?.why}`, /画像|onboarding|上下文/u);
  assert.equal(result.data.cards.some((card: { type: string }) => card.type === "project"), false);
});

test("pulse generate does not leak missing-whereabouts diagnostics or local paths into visible cards", async () => {
  const fixture = createGovernanceFixture("codeksei-pulse-sanitized-");
  const today = writeTodayDiary(fixture);

  const result = await runPulseCommand(fixture.config, [
    "generate",
    "--user", fixture.target.senderId,
    "--workspace", fixture.target.workspaceRoot,
    "--date", today,
    "--focus", "继续 diary",
  ]);

  const renderedCards = JSON.stringify(result.data.cards);
  assert.doesNotMatch(renderedCards, /whereabouts 还没有本地位置事件/u);
  assert.doesNotMatch(renderedCards, /stale_companion_and_checkin_handoff/u);
  assert.doesNotMatch(
    renderedCards,
    new RegExp(fixture.workspaceRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
});

test("pulse focus scoring ignores generic continuation words and only boosts true topic matches", async () => {
  const fixture = createGovernanceFixture("codeksei-pulse-focus-");
  const today = writeTodayDiary(fixture);

  const result = await runPulseCommand(fixture.config, [
    "generate",
    "--user", fixture.target.senderId,
    "--workspace", fixture.target.workspaceRoot,
    "--date", today,
    "--focus", "继续 diary",
  ]);

  const focusBoosted = result.data.cards.filter((card: { scoreBreakdown: { focus: number } }) => card.scoreBreakdown.focus > 0);
  assert.equal(focusBoosted.length, 1);
  assert.equal(focusBoosted[0]?.type, "focus");
});

test("pulse feedback rejects missing card and invalid kind without writing state", async () => {
  const fixture = createGovernanceFixture("codeksei-pulse-feedback-invalid-");

  await assert.rejects(
    () => runPulseCommand(fixture.config, [
      "feedback",
      "--card", "pulse:bad-kind",
      "--kind", "hdie",
      "--topic", "typo feedback",
    ]),
    /不支持的 Pulse feedback kind/u,
  );
  await assert.rejects(
    () => runPulseCommand(fixture.config, [
      "feedback",
      "--kind", "hide",
      "--topic", "missing card",
    ]),
    /缺少 --card/u,
  );

  assert.equal(fs.existsSync(path.join(fixture.stateDir, "pulse", "feedback", "feedback.json")), false);
});

test("host manifest exposes governance and pulse entrypoints", async () => {
  const fixture = createGovernanceFixture("codeksei-host-manifest-governance-");
  const result = await runHostManifestCommand(fixture.config, ["--provider", "hermes"]);

  assert.deepEqual(result.data.entrypoints.capabilitiesStatus, ["codeksei", "capabilities", "status", "--provider", "hermes", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.contextInspect, ["codeksei", "context", "inspect", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.pulseToday, ["codeksei", "pulse", "today", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.pulseGenerate, ["codeksei", "pulse", "generate", "--format", "json"]);
  assert.deepEqual(result.data.entrypoints.pulseFeedback, ["codeksei", "pulse", "feedback", "--format", "json"]);
  assert.equal(result.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "daily_pulse_review"), true);
  assert.equal(result.data.recommendedWorkflows.some((entry: { id: string }) => entry.id === "capability_governance_check"), true);
});
