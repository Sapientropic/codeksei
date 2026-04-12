const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

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
