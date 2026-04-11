const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDiaryEntryPayload,
  buildDiaryWriteEntryPayloads,
  buildDiaryFileSkeleton,
  insertDiaryEntry,
  parseArgs,
} = require("../src/app/diary-write-cli");

function buildSkeleton() {
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
  assert.equal((done.match(/把药单发给 Alex/g) || []).length, 1);
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

test("todo done cutover writes timeline fact in the same command batch", () => {
  const payloads = buildDiaryWriteEntryPayloads({
    section: "todo",
    timeString: "23:04",
    body: "明天继续观察并收口 Cyberboss 微信回复重复 / 截断问题",
    todoState: "done",
    timelineText: "22:39-23:04 连续压测 Cyberboss 微信回复与 timeline 截图发送链路；这条问题今晚可以先收尾。",
  });

  const content = payloads.reduce(
    (draft, payload) => insertDiaryEntry(draft, payload, "2026-04-10"),
    buildSkeleton()
  );

  assert.match(content, /## Todo\n\n- \[x\] 明天继续观察并收口 Cyberboss 微信回复重复 \/ 截断问题/);
  assert.match(content, /## 时间线事实[\s\S]*- 22:39-23:04 连续压测 Cyberboss 微信回复与 timeline 截图发送链路；这条问题今晚可以先收尾。/);
});

test("todo done cutover synthesizes a minimal timeline fact for legacy callers", () => {
  const payloads = buildDiaryWriteEntryPayloads({
    section: "todo",
    timeString: "23:04",
    body: "明天继续观察并收口 Cyberboss 微信回复重复 / 截断问题",
    todoState: "done",
  });

  const content = payloads.reduce(
    (draft, payload) => insertDiaryEntry(draft, payload, "2026-04-10"),
    buildSkeleton()
  );

  assert.match(content, /## Todo\n\n- \[x\] 明天继续观察并收口 Cyberboss 微信回复重复 \/ 截断问题/);
  assert.match(content, /## 时间线事实[\s\S]*- 23:04 明天继续观察并收口 Cyberboss 微信回复重复 \/ 截断问题/);
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
    /--timeline-text 需要一个值/
  );
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
