const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildReviewFileSkeleton,
  buildReviewSections,
  parseManagedBulletList,
  syncReviewContent,
} = require("../src/core/review-document");

function createReviewFixture() {
  const sections = buildReviewSections("monthly", "下月第一步");
  return {
    profile: {
      kind: "monthly",
      intro: "Codeksei 月复盘",
      tags: ["codeksei", "review"],
      sections,
    },
    window: {
      timezone: "Asia/Shanghai",
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    },
    draft: {
      periodLabel: "2026-04",
      periodTitle: "2026-04 月复盘",
      sourceDiaryDays: 3,
      sourceNightlyDays: 1,
      content: {
        window: "- 时间范围：2026-04-01 ~ 2026-04-30",
        progress: "- 收口 shared bridge",
        friction: "- 低能量时启动偏重",
        "open-loops": "- Apple Watch 提醒链路还没完全接上",
        "carry-forward": "- 下月先补最小提醒验证",
        "daily-summaries": "### 2026-04-10\n- 收口 shared bridge",
        supplements: "### 2026-04-10 本周值得带走的模式\n- 忙起来容易断开饥饿信号",
      },
    },
    diaryEntries: [{}, {}, {}],
    nightlyEntries: [{}],
  };
}

test("review document skeleton creates managed blocks for every generated section", () => {
  const review = createReviewFixture();
  const content = buildReviewFileSkeleton(review, new Date("2026-04-12T12:00:00.000Z"));

  assert.match(content, /# 2026-04 月复盘/u);
  assert.match(content, /codeksei-review:progress:start/u);
  assert.match(content, /## Agent 判断/u);
});

test("review document sync upgrades legacy managed markers and refreshes frontmatter", () => {
  const review = createReviewFixture();
  const legacy = [
    "---",
    "created: 2026-04-11T00:00",
    "updated: 2026-04-11",
    "type: review",
    "review_period: monthly",
    "period_label: 2026-04",
    "period_start: 2026-04-01",
    "period_end: 2026-04-30",
    "source_diary_days: 1",
    "source_nightly_days: 0",
    "status: working",
    "tags:",
    "  - codeksei",
    "---",
    "# 2026-04 月复盘",
    "",
    "## 每天收口摘录",
    "<!-- cyberboss-review:daily-summaries:start -->",
    "- 旧内容",
    "<!-- cyberboss-review:daily-summaries:end -->",
    "",
  ].join("\n");

  const synced = syncReviewContent(legacy, review, new Date("2026-04-12T12:00:00.000Z"));
  assert.match(synced, /updated: 2026-04-12/u);
  assert.match(synced, /source_diary_days: 3/u);
  assert.match(synced, /source_nightly_days: 1/u);
  assert.match(synced, /codeksei-review:daily-summaries:start/u);
  assert.doesNotMatch(synced, /cyberboss-review:daily-summaries:start/u);
});

test("review document parser ignores generated fallback bullets inside managed blocks", () => {
  const content = [
    "## 值得带走的信号",
    "<!-- codeksei-review:signals:start -->",
    "- 今天还没有稳定到值得带走的信号。",
    "- 忙起来容易和饥饿信号断开",
    "<!-- codeksei-review:signals:end -->",
  ].join("\n");

  assert.deepEqual(parseManagedBulletList(content, "signals"), [
    "忙起来容易和饥饿信号断开",
  ]);
});
