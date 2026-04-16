const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { getCurrentDateStringInTimezone } = require("../src/core/timezone");
const { buildCheckinTargetKey } = require("../src/checkin");
const { CheckinScheduleStateStore } = require("../src/state/checkin-schedule-state-store");
const {
  refreshContextBoard,
  resolveContextBoardPath,
} = require("../src/context/board");
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
  assert.match(result.boardText, /待带进下一次主动判断的内部后续：午饭后 30 分钟重新接这条线。/u);
  assert.match(result.boardText, /## 重入入口/u);
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

