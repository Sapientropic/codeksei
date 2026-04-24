const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const { spawnSync }: typeof import("node:child_process") = require("node:child_process");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { getCurrentDateStringInTimezone } = require("../src/core/timezone");
const { buildCheckinTargetKey } = require("../src/checkin");
const { CheckinScheduleStateStore } = require("../src/state/checkin-schedule-state-store");
const {
  refreshContextBoard,
  resolveContextBoardPath,
} = require("../src/context/board");
const {
  normalizeProactiveObservation,
} = require("../src/proactive/observation-normalize");
const { runContextBriefingCommand } = require("../src/app/context-briefing-cli");

function createContextFixture() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-context-board-"));
  const stateDir = path.join(workspaceRoot, ".codeksei-state");
  const diaryDir = path.join(stateDir, "diary");
  const codexDir = path.join(workspaceRoot, ".codex");
  const companionNotePath = path.join(workspaceRoot, "notes", "Companion.md");
  const timezone = "Asia/Shanghai";
  const today = getCurrentDateStringInTimezone(timezone);
  const target = {
    senderId: "wx-user",
    senderSource: "explicit",
    workspaceRoot: workspaceRoot.replace(/\\/g, "/"),
    workspaceSource: "explicit",
  };
  const checkinScheduleStateFile = path.join(stateDir, "checkin-schedule-state.json");

  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(path.dirname(companionNotePath), { recursive: true });
  fs.mkdirSync(diaryDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "# Workspace Contract\n", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# README\n", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "Home.md"), "# Home\n", "utf8");
  fs.writeFileSync(companionNotePath, [
    "# Companion",
    "",
    "## 当前定位",
    "今天节奏放慢，午饭后再开始工作。",
    "",
    "## 支持偏好",
    "- 提醒要短，不要催债。",
    "",
    "## 最近动作",
    "- issue #9 在做 context board。",
    "",
    "## 下一步",
    "- 把 hosted checkin script 注入接上。",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(diaryDir, `${today}.md`), [
    "# Diary",
    "",
    "## 时间线事实",
    "- 10:20 起床",
    "- 12:30 吃完午饭",
    "",
    "## Todo",
    "- [x] 处理 issue #9",
    "- [ ] 写 context board 测试",
    "",
    "## 补充记录",
    "### 12:40 节奏",
    "上午先休息，下午再继续。",
    "",
    "## 总结",
    "- 今天先把主动判断的上下文层接起来。",
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
    checkinScheduleStateFile,
    config: {
      allowedUserIds: [target.senderId],
      checkinScheduleStateFile,
      diaryDir,
      durableNoteSchemaConfigFile: path.join(codexDir, "durable-note-schema.json"),
      projectRadarConfigFile: path.join(codexDir, "code-projects.json"),
      sessionsFile: path.join(stateDir, "sessions.json"),
      stateDir,
      timezone,
      workspaceBootstrapConfigFile: path.join(stateDir, "workspace-bootstrap.json"),
      workspaceRoot: target.workspaceRoot,
    },
    stateDir,
    target,
    today,
    workspaceRoot,
  };
}

function createContextGitRepo(tempRoot: string, slug: string): string {
  const repoRoot = path.join(tempRoot, slug);
  fs.mkdirSync(repoRoot, { recursive: true });
  runContextGit(repoRoot, ["init", "--initial-branch", "main"]);
  runContextGit(repoRoot, ["config", "user.email", "bot@example.com"]);
  runContextGit(repoRoot, ["config", "user.name", "Codeksei Bot"]);
  fs.writeFileSync(path.join(repoRoot, "README.md"), `# ${slug}\n`, "utf8");
  runContextGit(repoRoot, ["add", "README.md"]);
  runContextGit(repoRoot, ["commit", "-m", `${slug} initial`]);
  return repoRoot;
}

function runContextGit(repoRoot: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(" ")} failed`);
}

test("context board refresh builds a deterministic handoff with fresh diary and companion context", () => {
  const fixture = createContextFixture();
  const result = refreshContextBoard(fixture.config, fixture.target, {
    followupContext: "午饭后 30 分钟重新接这条线。",
    mode: "proactive",
  });

  assert.equal(result.stale, false);
  assert.equal(fs.existsSync(resolveContextBoardPath(fixture.config, fixture.target)), true);
  assert.match(result.briefingText, /Codeksei context board \(proactive\)/u);
  assert.match(result.briefingText, /10:20 起床/u);
  assert.match(result.briefingText, /提醒要短，不要催债/u);
  assert.match(result.briefingText, /伴随状态卡/u);
  assert.equal(result.stateCard.sourceThickness, "strong");
  assert.match(result.stateCard.activeThread, /issue #9/u);
  assert.match(result.stateCard.easiestReentryStep, /hosted checkin script/u);
  assert.match(result.boardText, /待带进下一次主动判断的内部后续：午饭后 30 分钟重新接这条线。/u);
  assert.match(result.boardText, /## 重入入口/u);
});

test("context board keeps tracked project candidates when current workspace is the vault", () => {
  const fixture = createContextFixture();
  const reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-context-board-repos-"));
  const codekseiRepo = createContextGitRepo(reposRoot, "codeksei");
  const otherRepo = createContextGitRepo(reposRoot, "other");
  fs.writeFileSync(path.join(codekseiRepo, "current.txt"), "dirty work\n", "utf8");
  fs.writeFileSync(path.join(fixture.workspaceRoot, "notes", "Codeksei.md"), "# Codeksei note\n", "utf8");
  fs.writeFileSync(path.join(fixture.workspaceRoot, "notes", "Other.md"), "# Other note\n", "utf8");
  fs.writeFileSync(fixture.config.projectRadarConfigFile, JSON.stringify({
    projects: [
      {
        slug: "other",
        title: "Other",
        repoRoot: otherRepo,
        notePath: "notes/Other.md",
        overviewFiles: ["README.md"],
      },
      {
        slug: "codeksei",
        title: "Codeksei",
        repoRoot: codekseiRepo,
        notePath: "notes/Codeksei.md",
        overviewFiles: ["README.md"],
      },
    ],
  }, null, 2), "utf8");

  const result = refreshContextBoard(fixture.config, fixture.target, {
    mode: "proactive",
  });

  assert.match(result.briefingText, /tracked project candidates/u);
  assert.match(result.briefingText, /codeksei/u);
  assert.doesNotMatch(result.briefingText, /workspace_not_tracked/u);
});

test("context board renders proactive observation without mutating deterministic state card", () => {
  const fixture = createContextFixture();
  const observation = normalizeProactiveObservation({
    annoyanceRisk: "low",
    confidence: 0.86,
    currentStateHypothesis: "用户正在把本地小模型观察层接进 Codeksei。",
    evidence: ["用户明确要求先优化这层，为后续小模型发挥能力做准备。"],
    likelyBlocker: "担心直接让小模型决定投递会污染调度真相。",
    memoryCandidates: [
      {
        confidence: 0.72,
        evidence: "用户希望小模型以后接照片、音频、生活记录。",
        kind: "next",
        slotId: "next",
        text: "后续希望小模型把照片、音频、生活记录结构化为主 agent 记忆层。",
      },
    ],
    modalityHints: ["text"],
    reentryCandidate: "先实现 ProactiveObservation，再设计 Gemma 4 E2B-it eval。",
    stateSignals: ["project_reentry", "memory_candidate"],
    suggestedTone: "短、自然，给一个下一步。",
    surfaceRisk: "low",
    userEnergy: "medium",
  }, {
    host: "local",
    minConfidence: 0.55,
    model: "gemma-4-E2B-it",
    now: new Date("2026-04-21T08:00:00.000Z"),
    sourceHash: "context-hash",
  });
  assert.ok(observation);

  const result = refreshContextBoard(fixture.config, fixture.target, {
    mode: "proactive",
    observation,
  });

  assert.equal(result.observation?.id, observation.id);
  assert.match(result.briefingText, /小模型观察/u);
  assert.match(result.boardText, /先实现 ProactiveObservation/u);
  assert.doesNotMatch(result.stateCard.easiestReentryStep, /ProactiveObservation/u);
  assert.match(result.stateCard.easiestReentryStep, /hosted checkin script/u);
  assert.doesNotMatch(result.stateCard.toneHint, /给一个下一步/u);
});

test("context board marks stale when today diary and recent handoff are both thin", () => {
  const fixture = createContextFixture();
  fs.rmSync(path.join(fixture.stateDir, "diary"), { recursive: true, force: true });
  fs.rmSync(path.join(fixture.workspaceRoot, "notes"), { recursive: true, force: true });
  new CheckinScheduleStateStore({ filePath: fixture.checkinScheduleStateFile }).setState({
    activeWake: null,
    lastCompletion: {
      completedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
      nextWakeAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
      result: "silent",
      scheduleSource: "fallback",
      triggerId: "trigger-old",
    },
    nextWakeAt: "",
    pendingTrigger: null,
    scheduleSource: "fallback",
    senderId: fixture.target.senderId,
    targetKey: buildCheckinTargetKey(fixture.target),
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
    workspaceRoot: fixture.target.workspaceRoot,
  });

  const result = refreshContextBoard(fixture.config, fixture.target, {
    mode: "proactive",
  });

  assert.equal(result.stale, true);
  assert.deepEqual(result.staleReasons, ["missing_today_diary", "stale_companion_and_checkin_handoff"]);
  assert.equal(result.stateCard.sourceThickness, "thin");
  assert.match(result.briefingText, /\[⚠️ 需确认\]/u);
});

test("context board preserves follow-up context across refresh and clears it on completion-style refresh", () => {
  const fixture = createContextFixture();
  refreshContextBoard(fixture.config, fixture.target, {
    followupContext: "下午一点提醒继续写测试。",
  });

  const preserved = refreshContextBoard(fixture.config, fixture.target, {});
  assert.match(preserved.boardText, /下午一点提醒继续写测试/u);

  const cleared = refreshContextBoard(fixture.config, fixture.target, {
    clearFollowupContext: true,
  });
  assert.doesNotMatch(cleared.boardText, /下午一点提醒继续写测试/u);
});

test("context board surfaces pending proactive handoff for the main session", () => {
  const fixture = createContextFixture();
  new CheckinScheduleStateStore({ filePath: fixture.checkinScheduleStateFile }).setState({
    activeWake: {
      createdAt: new Date().toISOString(),
      dueAt: new Date().toISOString(),
      kind: "checkin",
      senderId: fixture.target.senderId,
      source: "checkin_trigger",
      startedAt: new Date().toISOString(),
      text: "observer prompt",
      triggerId: "lease-handoff",
      workspaceRoot: fixture.target.workspaceRoot,
    },
    lastCompletion: null,
    nextWakeAt: "",
    pendingHandoff: {
      bookkeepingActions: [
        {
          kind: "timeline",
          status: "suggested",
          summary: "确认这段工作块后补到 timeline。",
        },
      ],
      followupContext: "主会话回来时先确认这条线有没有继续。",
      handoffCreatedAt: new Date().toISOString(),
      handoffExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      observedCurrentState: "最近还在 codeksei 这条线上，但是否切走需要再问一句。",
      outcome: "silent",
      triggerId: "lease-handoff",
      userVisibleMessage: "",
    },
    pendingTrigger: null,
    scheduleSource: "agent",
    senderId: fixture.target.senderId,
    targetKey: buildCheckinTargetKey(fixture.target),
    updatedAt: new Date().toISOString(),
    workspaceRoot: fixture.target.workspaceRoot,
  });

  const result = refreshContextBoard(fixture.config, fixture.target, {
    mode: "proactive",
  });

  assert.equal(result.checkin.pendingHandoff.exists, true);
  assert.match(result.briefingText, /待主会话收尾的 proactive handoff/u);
  assert.match(result.briefingText, /子 agent 当前观察/u);
});

test("context briefing command refreshes board and returns prompt-ready text", async () => {
  const fixture = createContextFixture();
  const result = await runContextBriefingCommand(fixture.config, [
    "--user", fixture.target.senderId,
    "--workspace", fixture.target.workspaceRoot,
    "--mode", "review",
  ]);

  assert.equal(result.data.mode, "review");
  assert.equal(result.data.stale, false);
  assert.match(String(result.text || ""), /Codeksei context board \(review framing\)/u);
  assert.match(String(result.data.boardText || ""), /## 当前状态/u);
});

test("context briefing honors english locale for prompt-ready board text", async () => {
  const fixture = createContextFixture();
  const result = await runContextBriefingCommand({
    ...fixture.config,
    locale: "en",
    userLanguage: "en",
  }, [
    "--user", fixture.target.senderId,
    "--workspace", fixture.target.workspaceRoot,
    "--mode", "proactive",
  ]);

  assert.equal(result.data.mode, "proactive");
  assert.match(String(result.text || ""), /Codeksei context board \(proactive\)/u);
  assert.match(String(result.text || ""), /## Current Status/u);
  assert.match(String(result.text || ""), /## Today Facts/u);
  assert.doesNotMatch(String(result.text || ""), /## 当前状态/u);
});
