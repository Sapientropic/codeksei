const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const { buildFrameState }: typeof import("../src/frame/runtime/application/frame/state") = require("../src/frame/runtime/application/frame/state");
const { ReminderQueueStore }: typeof import("../src/state/reminder-queue-store") = require("../src/state/reminder-queue-store");
const { CheckinScheduleStateStore }: typeof import("../src/state/checkin-schedule-state-store") = require("../src/state/checkin-schedule-state-store");

test("frame state returns stable empty shape when optional sources are missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-frame-state-empty-"));
  const state = buildFrameState({
    stateDir: tempRoot,
    timezone: "Asia/Shanghai",
  }, new Date("2026-04-20T10:00:00.000Z"));

  assert.equal(state.timezone, "Asia/Shanghai");
  assert.deepEqual(state.timeline.slots, []);
  assert.deepEqual(state.diary.fragments, []);
  assert.deepEqual(state.reminders, []);
  assert.deepEqual(state.projects, []);
  assert.equal(state.checkIn.status, "scheduled");
  assert.equal(state.freshness.stale, true);
  assert.ok(state.freshness.warnings.includes("diary_dir_missing"));
});

test("frame state projects reminders diary and checkin into the dashboard shape", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-frame-state-rich-"));
  const diaryDir = path.join(tempRoot, "diary");
  fs.mkdirSync(diaryDir, { recursive: true });
  fs.writeFileSync(
    path.join(diaryDir, "2026-04-20.md"),
    [
      "# 2026-04-20",
      "",
      "- 17:20 <img src=x onerror=alert(1)>",
      "",
      "## 总结",
      "今天比较稳。",
    ].join("\n"),
    "utf8",
  );

  const reminderQueueFile = path.join(tempRoot, "reminder-queue.json");
  new ReminderQueueStore({ filePath: reminderQueueFile }).enqueue({
    id: "rem-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text: "提醒 <script>",
    dueAtMs: Date.parse("2026-04-20T13:00:00.000Z"),
    createdAt: "2026-04-20T10:00:00.000Z",
  });

  const checkinScheduleStateFile = path.join(tempRoot, "checkin-schedule-state.json");
  new CheckinScheduleStateStore({ filePath: checkinScheduleStateFile }).setState({
    activeWake: null,
    lastCompletion: null,
    nextWakeAt: "",
    pendingHandoff: null,
    pendingTrigger: {
      createdAt: "2026-04-20T10:00:00.000Z",
      dueAt: "2026-04-20T13:00:00.000Z",
      kind: "checkin",
      senderId: "user-1",
      source: "checkin_trigger",
      text: "check in",
      triggerId: "trig-1",
      workspaceRoot: tempRoot,
    },
    scheduleSource: "fallback",
    senderId: "user-1",
    targetKey: `user-1::${tempRoot}`,
    updatedAt: "2026-04-20T10:00:00.000Z",
    workspaceRoot: tempRoot,
  });

  const state = buildFrameState({
    checkinScheduleStateFile,
    diaryDir,
    reminderQueueFile,
    stateDir: tempRoot,
    timezone: "Asia/Shanghai",
  }, new Date("2026-04-20T12:00:00.000Z"));

  assert.equal(state.diary.fragments[0]?.text, "<img src=x onerror=alert(1)>");
  assert.equal(state.diary.todaySummary, "今天比较稳。");
  assert.equal(state.reminders[0]?.text, "提醒 <script>");
  assert.equal(state.checkIn.status, "due");
  assert.equal(state.checkIn.triggerId, "trig-1");
});
