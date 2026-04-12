const fs: typeof import("node:fs") = require("node:fs");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const {
  buildDiaryEntryPayload,
  buildDiaryWriteEntryPayloads,
  buildDiaryFileSkeleton,
  insertDiaryEntry,
  parseArgs,
  parseTodoLine,
  resolveTodoDoneTimelineText,
  runDiaryWriteCommand,
} = require("../src/app/diary-write-cli");

type DiaryEntryPayload = ReturnType<typeof buildDiaryEntryPayload>;

function buildSkeleton(): string {
  return buildDiaryFileSkeleton({
    createdAt: "2026-04-10T00:00",
    updated: "2026-04-10",
  });
}

test("todo entries update state in place without duplicate lines", () => {
  const opened = insertDiaryEntry(
    buildSkeleton(),
    buildDiaryEntryPayload({
      section: "todo",
      timeString: "18:00",
      body: "把药单发给 Alex",
      todoState: "open",
    }),
    "2026-04-10"
  );

  assert.match(opened, /## Todo\n\n- \[ \] 把药单发给 Alex/);
  assert.match(opened, /<!-- codeksei-todo:start=18:00 -->/);

  const done = insertDiaryEntry(
    opened,
    buildDiaryEntryPayload({
      section: "todo",
      timeString: "18:30",
      body: "把药单发给 Alex",
      todoState: "done",
    }),
    "2026-04-10"
  );

  assert.match(done, /## Todo\n\n- \[x\] 把药单发给 Alex/);
  assert.match(done, /<!-- codeksei-todo:start=18:00 -->/);
  assert.equal((done.match(/把药单发给 Alex/g) || []).length, 1);
});

test("repeated todo open keeps the original start time while the item is still open", () => {
  const opened = insertDiaryEntry(
    buildSkeleton(),
    buildDiaryEntryPayload({
      section: "todo",
      timeString: "18:00",
      body: "把药单发给 Alex",
      todoState: "open",
    }),
    "2026-04-10"
  );

  const reopenedWhileStillOpen = insertDiaryEntry(
    opened,
    buildDiaryEntryPayload({
      section: "todo",
      timeString: "18:12",
      body: "把药单发给 Alex",
      todoState: "open",
    }),
    "2026-04-10"
  );

  assert.match(reopenedWhileStillOpen, /## Todo\n\n- \[ \] 把药单发给 Alex <!-- codeksei-todo:start=18:00 -->/);
});

test("timeline, fragment, and summary entries land in their own sections", () => {
  let content = buildSkeleton();
  content = insertDiaryEntry(
    content,
    buildDiaryEntryPayload({
      section: "timeline",
      timeString: "17:58",
      body: "17:30-17:58 把药单发出去了",
    }),
    "2026-04-10"
  );
  content = insertDiaryEntry(
    content,
    buildDiaryEntryPayload({
      section: "fragment",
      timeString: "18:05",
      body: "今天切换点统一收口比边聊边记更稳。",
    }),
    "2026-04-10"
  );
  content = insertDiaryEntry(
    content,
    buildDiaryEntryPayload({
      section: "summary",
      timeString: "23:10",
      body: "明天第一步先验证 Apple Watch 最小提醒链路。",
    }),
    "2026-04-10"
  );

  assert.match(content, /## 时间线事实\n\n- 17:30-17:58 把药单发出去了/);
  assert.match(content, /## 今日碎片\n\n- 今天切换点统一收口比边聊边记更稳。/);
  assert.match(content, /## 总结\n\n- 明天第一步先验证 Apple Watch 最小提醒链路。/);
});

test("runDiaryWriteCommand accepts fragment writes without requiring todo state", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-diary-write-"));
  const originalArgv = process.argv;
  process.argv = [
    "node",
    "./dist/src/index.js",
    "diary",
    "write",
    "--section",
    "fragment",
    "--date",
    "2026-04-11",
    "--time",
    "19:14",
    "--text",
    "今天忙了一整天，晚饭前明显感觉能量很低，还有点晕。",
  ];

  try {
    await runDiaryWriteCommand({
      diaryDir: tempRoot,
      timezone: "Asia/Shanghai",
    }, process.argv.slice(4));

    const content = fs.readFileSync(path.join(tempRoot, "2026-04-11.md"), "utf8");
    assert.match(content, /## 今日碎片\n\n- 今天忙了一整天，晚饭前明显感觉能量很低，还有点晕。/);
    assert.deepEqual(
      fs.readdirSync(tempRoot).filter((entry) => entry.endsWith(".tmp")),
      []
    );
  } finally {
    process.argv = originalArgv;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("todo done cutover writes timeline fact in the same command batch", () => {
  const payloads = buildDiaryWriteEntryPayloads({
    section: "todo",
    timeString: "23:04",
    body: "明天继续观察并收口 Codeksei 微信回复重复 / 截断问题",
    todoState: "done",
    timelineText: "22:39-23:04 连续压测 Codeksei 微信回复与 timeline 截图发送链路；这条问题今晚可以先收尾。",
  });

  const content = payloads.reduce(
    (draft: string, payload: DiaryEntryPayload) => insertDiaryEntry(draft, payload, "2026-04-10"),
    buildSkeleton()
  );

  assert.match(content, /## Todo\n\n- \[x\] 明天继续观察并收口 Codeksei 微信回复重复 \/ 截断问题/);
  assert.match(content, /## 时间线事实[\s\S]*- 22:39-23:04 连续压测 Codeksei 微信回复与 timeline 截图发送链路；这条问题今晚可以先收尾。/);
});

test("todo done cutover reuses the captured Todo start time when --timeline-text is omitted", () => {
  const opened = insertDiaryEntry(
    buildSkeleton(),
    buildDiaryEntryPayload({
      section: "todo",
      timeString: "22:39",
      body: "明天继续观察并收口 Codeksei 微信回复重复 / 截断问题",
      todoState: "open",
    }),
    "2026-04-10"
  );

  const payloads = buildDiaryWriteEntryPayloads({
    existingContent: opened,
    section: "todo",
    timeString: "23:04",
    body: "明天继续观察并收口 Codeksei 微信回复重复 / 截断问题",
    todoState: "done",
  });

  const content = payloads.reduce(
    (draft: string, payload: DiaryEntryPayload) => insertDiaryEntry(draft, payload, "2026-04-10"),
    buildSkeleton()
  );

  assert.match(content, /## Todo\n\n- \[x\] 明天继续观察并收口 Codeksei 微信回复重复 \/ 截断问题/);
  assert.match(content, /## 时间线事实[\s\S]*- 22:39-23:04 明天继续观察并收口 Codeksei 微信回复重复 \/ 截断问题/);
});

test("todo done cutover still synthesizes a point-in-time fact when no Todo start was captured", () => {
  const payloads = buildDiaryWriteEntryPayloads({
    section: "todo",
    timeString: "23:04",
    body: "明天继续观察并收口 Codeksei 微信回复重复 / 截断问题",
    todoState: "done",
  });

  const content = payloads.reduce(
    (draft: string, payload: DiaryEntryPayload) => insertDiaryEntry(draft, payload, "2026-04-10"),
    buildSkeleton()
  );

  assert.match(content, /## Todo\n\n- \[x\] 明天继续观察并收口 Codeksei 微信回复重复 \/ 截断问题/);
  assert.match(content, /## 时间线事实[\s\S]*- 23:04 明天继续观察并收口 Codeksei 微信回复重复 \/ 截断问题/);
});

test("todo reopen with the same text resets the captured start time for the new block", () => {
  const opened = insertDiaryEntry(
    buildSkeleton(),
    buildDiaryEntryPayload({
      section: "todo",
      timeString: "17:30",
      body: "把药单发给 Alex",
      todoState: "open",
    }),
    "2026-04-10"
  );
  const finished = insertDiaryEntry(
    opened,
    buildDiaryEntryPayload({
      section: "todo",
      timeString: "17:58",
      body: "把药单发给 Alex",
      todoState: "done",
    }),
    "2026-04-10"
  );
  const reopened = insertDiaryEntry(
    finished,
    buildDiaryEntryPayload({
      section: "todo",
      timeString: "20:00",
      body: "把药单发给 Alex",
      todoState: "open",
    }),
    "2026-04-10"
  );

  assert.match(reopened, /## Todo\n\n- \[ \] 把药单发给 Alex <!-- codeksei-todo:start=20:00 -->/);

  const payloads = buildDiaryWriteEntryPayloads({
    existingContent: reopened,
    section: "todo",
    timeString: "20:30",
    body: "把药单发给 Alex",
    todoState: "done",
  });

  const content = payloads.reduce(
    (draft: string, payload: DiaryEntryPayload) => insertDiaryEntry(draft, payload, "2026-04-10"),
    buildSkeleton()
  );

  assert.match(content, /## 时间线事实[\s\S]*- 20:00-20:30 把药单发给 Alex/);
  assert.doesNotMatch(content, /17:30-20:30 把药单发给 Alex/);
});

test("--timeline-text still rejects non todo-done writes", () => {
  assert.throws(
    () => buildDiaryWriteEntryPayloads({
      section: "todo",
      timeString: "23:04",
      body: "还没完成的事情",
      todoState: "open",
      timelineText: "23:04 单独写 timeline",
    }),
    /--timeline-text 只支持和 --section todo --state done 一起使用/
  );
});

test("parseArgs reports missing option values explicitly", () => {
  assert.throws(
    () => parseArgs(["--section", "todo", "--state", "done", "--text", "x", "--timeline-text", "--time", "22:00"]),
    /参数缺少值: --timeline-text/
  );
});

test("resolveTodoDoneTimelineText reports whether it used captured Todo start time or point fallback", () => {
  const opened = insertDiaryEntry(
    buildSkeleton(),
    buildDiaryEntryPayload({
      section: "todo",
      timeString: "17:30",
      body: "把药单发给 Alex",
      todoState: "open",
    }),
    "2026-04-10"
  );

  const fromTodo = resolveTodoDoneTimelineText({
    existingContent: opened,
    section: "todo",
    timeString: "17:58",
    body: "把药单发给 Alex",
    todoState: "done",
  });
  assert.equal(fromTodo.mode, "range_from_todo");
  assert.equal(fromTodo.text, "17:30-17:58 把药单发给 Alex");

  const fallback = resolveTodoDoneTimelineText({
    section: "todo",
    timeString: "17:58",
    body: "把药单发给 Alex",
    todoState: "done",
  });
  assert.equal(fallback.mode, "point_in_time");
  assert.equal(fallback.text, "17:58 把药单发给 Alex");
});

test("parseTodoLine keeps visible text separate from hidden start-time metadata", () => {
  const parsed = parseTodoLine("- [x] 把药单发给 Alex <!-- codeksei-todo:start=17:30 -->");

  assert.deepEqual(parsed, {
    todoState: "done",
    text: "把药单发给 Alex",
    todoStartedAt: "17:30",
  });
});

test("supplement remains the default section and dedupes identical body/title pairs", () => {
  const payload = buildDiaryEntryPayload({
    timeString: "21:00",
    title: "probe",
    body: "hello",
  });
  assert.equal(payload.section, "supplement");

  const inserted = insertDiaryEntry(buildSkeleton(), payload, "2026-04-10");
  const deduped = insertDiaryEntry(inserted, payload, "2026-04-10");

  assert.match(inserted, /## 补充记录\n\n### 21:00 probe\n\nhello\n\n## 总结/);
  assert.equal((deduped.match(/### 21:00 probe/g) || []).length, 1);
});
