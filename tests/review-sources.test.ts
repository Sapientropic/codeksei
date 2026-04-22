const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  collectDiaryEntries,
  collectNightlyEntries,
} = require("../src/review/review-sources");

test("review sources tolerate missing diary and nightly folders", () => {
  assert.deepEqual(collectDiaryEntries("", "2026-04-01", "2026-04-30"), []);
  assert.deepEqual(collectNightlyEntries("", "2026-04-01", "2026-04-30"), []);
});

test("review sources parse diary todo metadata and supplement sections deterministically", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-review-sources-"));
  const diaryDir = path.join(tempRoot, "日记");
  fs.mkdirSync(diaryDir, { recursive: true });
  fs.writeFileSync(path.join(diaryDir, "2026-04-10.md"), [
    "## Todo",
    "- [ ] 明天验证提醒链路 <!-- codeksei-todo:start=08:40 -->",
    "- [x] 收住 shared bridge <!-- codeksei-todo:start=21:49 -->",
    "",
    "## 时间线事实",
    "- Apple Watch 提醒实验先走最小验证",
    "",
    "## 今日碎片",
    "- 注册营养师模板对 C 档仍偏重",
    "",
    "## 补充记录",
    "### 21:28 点外卖时容易被手机岔走",
    "",
    "21:28 这是很典型的 ADHD 模式。",
    "",
    "## 总结",
    "今天有两条主线：",
    "- 明天先把提醒链路补完整",
  ].join("\n"), "utf8");

  const entries = collectDiaryEntries(diaryDir, "2026-04-10", "2026-04-10");
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].todo.open, ["明天验证提醒链路"]);
  assert.deepEqual(entries[0].todo.done, ["收住 shared bridge"]);
  assert.deepEqual(entries[0].supplement, [{
    time: "21:28",
    title: "点外卖时容易被手机岔走",
    body: "21:28 这是很典型的 ADHD 模式。",
  }]);
  assert.deepEqual(entries[0].summary, ["明天先把提醒链路补完整"]);
});

test("review sources parse english diary headings without breaking old chinese files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-review-sources-en-"));
  const diaryDir = path.join(tempRoot, "diary");
  fs.mkdirSync(diaryDir, { recursive: true });
  fs.writeFileSync(path.join(diaryDir, "2026-04-11.md"), [
    "---",
    "codeksei_locale: en",
    "---",
    "## Todo",
    "- [ ] Check the Codex bootstrap smoke <!-- codeksei-todo:start=09:00 -->",
    "- [x] Draft the host recipe tests <!-- codeksei-todo:start=08:30 -->",
    "",
    "## Timeline Facts",
    "- 08:30-09:00 Drafted host recipe tests",
    "",
    "## Daily Fragments",
    "- English diary headings should remain review-readable.",
    "",
    "## Supplement",
    "### 09:10 Bootstrap boundary",
    "",
    "Codex bootstrap should not depend on Hermes.",
    "",
    "## Summary",
    "- Continue with final-only delivery tests.",
  ].join("\n"), "utf8");

  const entries = collectDiaryEntries(diaryDir, "2026-04-11", "2026-04-11");

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].todo.open, ["Check the Codex bootstrap smoke"]);
  assert.deepEqual(entries[0].todo.done, ["Draft the host recipe tests"]);
  assert.deepEqual(entries[0].timeline, ["08:30-09:00 Drafted host recipe tests"]);
  assert.deepEqual(entries[0].fragment, ["English diary headings should remain review-readable."]);
  assert.deepEqual(entries[0].supplement, [{
    time: "09:10",
    title: "Bootstrap boundary",
    body: "Codex bootstrap should not depend on Hermes.",
  }]);
  assert.deepEqual(entries[0].summary, ["Continue with final-only delivery tests."]);
});

test("review sources drop generated fallback bullets when reading nightly reviews", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-review-sources-"));
  fs.writeFileSync(path.join(tempRoot, "2026-04-10.md"), [
    "## 值得带走的信号",
    "<!-- codeksei-review:signals:start -->",
    "- 今天还没有稳定到值得带走的信号。",
    "- 忙起来容易和饥饿信号断开",
    "<!-- codeksei-review:signals:end -->",
  ].join("\n"), "utf8");

  const entries = collectNightlyEntries(tempRoot, "2026-04-10", "2026-04-10");
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].signals, ["忙起来容易和饥饿信号断开"]);
});
