const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDiaryEntryPayload,
  buildDiaryFileSkeleton,
  insertDiaryEntry,
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
