const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildReview,
  writeReview,
} = require("../src/core/review");

function setupReviewFixture() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-review-"));
  const diaryDir = path.join(workspaceRoot, "日记");
  const codexDir = path.join(workspaceRoot, ".codex");
  fs.mkdirSync(diaryDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });

  fs.writeFileSync(path.join(diaryDir, "2026-04-10.md"), [
    "---",
    "created: 2026-04-10T12:22",
    "updated: 2026-04-10",
    "type: diary",
    "---",
    "## Todo",
    "- [ ] 明天验证一条 Apple Watch 提醒链路",
    "- [x] 收住 Cyberboss 回复重复发送问题",
    "",
    "## 时间线事实",
    "- 18:59-20:46 回到注册营养师 Part 1 Intake，继续做配套图表并把今天第一轮真正收住。",
    "- 21:49-22:43 继续压测 Cyberboss workflow；截断基本收住，重复发送还在观察。",
    "",
    "## 今日碎片",
    "- Apple Watch 这条线更像生活助理触达链路实验，不是单纯折腾设备",
    "",
    "## 补充记录",
    "### 21:04 注册营养师日卡对 C 档仍偏重",
    "",
    "21:04 完成今天注册营养师 Part 1 Intake 的第一轮启动后，明确反馈：虽然今天选的是状态 C，但按现有模板完整做下来还是明显偏累。",
    "",
    "### 21:28 点外卖时容易被手机岔走",
    "",
    "21:28 这是很典型的 ADHD 模式：做琐事时很容易被另一件琐事把注意力岔开。",
    "",
    "## 总结",
    "今天有两条主线：",
    "- 生活助理链路：Apple Watch 提醒实验先走最小验证",
    "- 工程主线：继续收共享桥接、代码项目路由和 timeline 命令链路",
    "- 注册营养师：今天已经把第一张日卡真正启动起来了，但也确认了模板对 C 档还是偏重",
    "",
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(codexDir, "review-schema.json"), JSON.stringify({
    workspaces: {
      [workspaceRoot.replace(/\\/g, "/")]: {
        reviews: {
          nightly: {
            folder: "项目/Cyberboss 生活助理/复盘/Nightly",
            titleSuffix: "睡前收口",
            carryLabel: "明天第一步",
            intro: "Cyberboss 睡前收口",
          },
          weekly: {
            folder: "项目/Cyberboss 生活助理/复盘/Weekly",
            titleSuffix: "周复盘",
            carryLabel: "下周第一步",
            intro: "Cyberboss 周复盘",
          },
          monthly: {
            folder: "项目/Cyberboss 生活助理/复盘/Monthly",
            titleSuffix: "月复盘",
            carryLabel: "下月第一步",
            intro: "Cyberboss 月复盘",
          },
        },
      },
    },
  }, null, 2), "utf8");

  return {
    workspaceRoot,
    diaryDir,
    config: {
      workspaceRoot,
      diaryDir,
      reviewSchemaConfigFile: path.join(codexDir, "review-schema.json"),
    },
  };
}

test("review:nightly builds a nightly closeout note from diary truth source", () => {
  const fixture = setupReviewFixture();
  const preview = buildReview(fixture.config, "nightly", { date: "2026-04-10" });

  assert.equal(preview.draft.periodLabel, "2026-04-10");
  assert.match(preview.notePath, /Nightly\/2026-04-10\.md$/u);
  assert.match(preview.draft.insights.closeout.join("\n"), /Apple Watch 提醒实验/u);

  const result = writeReview(fixture.config, "nightly", { date: "2026-04-10" });
  assert.equal(result.changed, true);
  const content = fs.readFileSync(preview.notePath, "utf8");
  assert.match(content, /# 2026-04-10 睡前收口/u);
  assert.match(content, /## 睡前收口摘录/u);
  assert.match(content, /## 值得带走的信号/u);
});

test("review:weekly builds a weekly review note from diary truth source", () => {
  const fixture = setupReviewFixture();
  writeReview(fixture.config, "nightly", { date: "2026-04-10" });
  const preview = buildReview(fixture.config, "weekly", { week: "2026-W15" });

  assert.equal(preview.draft.periodLabel, "2026-W15");
  assert.equal(preview.draft.sourceNightlyDays, 1);
  assert.match(preview.notePath, /Weekly\/2026-W15\.md$/u);
  assert.match(preview.draft.insights.progress.join("\n"), /Apple Watch 提醒实验/u);
  assert.match(preview.draft.insights.friction.join("\n"), /偏重/u);

  const result = writeReview(fixture.config, "weekly", { week: "2026-W15" });
  assert.equal(result.changed, true);
  const content = fs.readFileSync(preview.notePath, "utf8");
  assert.match(content, /# 2026-W15 周复盘/u);
  assert.match(content, /source_nightly_days: 1/u);
  assert.match(content, /## 这段时间最真实的推进/u);
  assert.match(content, /## 下周第一步/u);
  assert.match(content, /cyberboss-review:daily-summaries:start/u);
});

test("review:monthly rewrites managed blocks idempotently", () => {
  const fixture = setupReviewFixture();
  const first = writeReview(fixture.config, "monthly", { month: "2026-04" });
  const second = writeReview(fixture.config, "monthly", { month: "2026-04" });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);

  const notePath = path.join(fixture.workspaceRoot, "项目", "Cyberboss 生活助理", "复盘", "Monthly", "2026-04.md");
  const content = fs.readFileSync(notePath, "utf8");
  assert.match(content, /# 2026-04 月复盘/u);
  assert.match(content, /明天验证一条 Apple Watch 提醒链路/u);
});
