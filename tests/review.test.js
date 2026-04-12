const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildReview,
  writeReview,
} = require("../src/core/review");
const { clearJsonConfigCache } = require("../src/core/config-loader");

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
    "- [ ] 明天验证一条 Apple Watch 提醒链路 <!-- codeksei-todo:start=08:40 -->",
    "- [x] 收住 Cyberboss 回复重复发送问题 <!-- codeksei-todo:start=21:49 -->",
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
      reviewSemanticMode: "deterministic",
    },
  };
}

test("review:nightly builds a nightly closeout note from diary truth source", async () => {
  const fixture = setupReviewFixture();
  const preview = await buildReview(fixture.config, "nightly", { date: "2026-04-10" });

  assert.equal(preview.draft.periodLabel, "2026-04-10");
  assert.match(preview.notePath, /Nightly\/2026-04-10\.md$/u);
  assert.match(preview.draft.insights.closeout.join("\n"), /Apple Watch 提醒实验/u);

  const result = await writeReview(fixture.config, "nightly", { date: "2026-04-10" });
  assert.equal(result.changed, true);
  const content = fs.readFileSync(preview.notePath, "utf8");
  assert.match(content, /# 2026-04-10 睡前收口/u);
  assert.match(content, /## 睡前收口摘录/u);
  assert.match(content, /## 值得带走的信号/u);
  assert.doesNotMatch(content, /codeksei-todo:start/u);
  assert.deepEqual(
    fs.readdirSync(path.dirname(preview.notePath)).filter((entry) => entry.endsWith(".tmp")),
    []
  );
});

test("review:weekly builds a weekly review note from diary truth source", async () => {
  const fixture = setupReviewFixture();
  await writeReview(fixture.config, "nightly", { date: "2026-04-10" });
  const preview = await buildReview(fixture.config, "weekly", { week: "2026-W15" });

  assert.equal(preview.draft.periodLabel, "2026-W15");
  assert.equal(preview.draft.sourceNightlyDays, 1);
  assert.match(preview.notePath, /Weekly\/2026-W15\.md$/u);
  assert.match(preview.draft.insights.progress.join("\n"), /Apple Watch 提醒实验/u);
  assert.match(preview.draft.insights.friction.join("\n"), /偏重/u);

  const result = await writeReview(fixture.config, "weekly", { week: "2026-W15" });
  assert.equal(result.changed, true);
  const content = fs.readFileSync(preview.notePath, "utf8");
  assert.match(content, /# 2026-W15 周复盘/u);
  assert.match(content, /source_nightly_days: 1/u);
  assert.match(content, /## 这段时间最真实的推进/u);
  assert.match(content, /## 下周第一步/u);
  assert.match(content, /codeksei-review:daily-summaries:start/u);
});

test("review:monthly rewrites managed blocks idempotently", async () => {
  const fixture = setupReviewFixture();
  const first = await writeReview(fixture.config, "monthly", { month: "2026-04" });
  const second = await writeReview(fixture.config, "monthly", { month: "2026-04" });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);

  const notePath = path.join(fixture.workspaceRoot, "项目", "Cyberboss 生活助理", "复盘", "Monthly", "2026-04.md");
  const content = fs.readFileSync(notePath, "utf8");
  assert.match(content, /# 2026-04 月复盘/u);
  assert.match(content, /明天验证一条 Apple Watch 提醒链路/u);
  assert.doesNotMatch(content, /codeksei-todo:start/u);
});

test("review hybrid v2 lets semantic pass replace noisy deterministic lines", async () => {
  const fixture = setupReviewFixture();
  fixture.config.reviewSemanticMode = "hybrid";
  fixture.config.reviewSemanticGenerator = async ({ profile }) => {
    if (profile.kind === "weekly") {
      return {
        progress: [
          "Apple Watch 提醒实验先完成最小验证，不把设备折腾当成主线。",
          "Cyberboss 共享桥接与 timeline 命令链路继续收口。",
        ],
        friction: [
          "注册营养师模板对低能量 C 档仍偏重，启动成本偏高。",
        ],
        open_loops: [
          "先把注册营养师 C 档压轻，再继续推进。",
        ],
        carry_forward: [
          "下次先从压轻 C 档最低完成标准开始。",
        ],
        daily_summaries: [
          {
            date: "2026-04-10",
            lines: [
              "Apple Watch 提醒实验完成最小验证。",
              "注册营养师日卡真正启动，但确认 C 档还需要压轻。",
            ],
          },
        ],
        supplement_groups: [
          {
            date: "2026-04-10",
            title: "本周值得带走的模式",
            body_lines: [
              "忙起来容易和饥饿信号断开，不适合只靠自发想起吃饭。",
            ],
          },
        ],
      };
    }
    return null;
  };

  const review = await buildReview(fixture.config, "weekly", { week: "2026-W15" });
  assert.equal(review.semantic.used, true);
  assert.equal(review.semantic.source, "injected");
  assert.deepEqual(review.draft.insights.progress, [
    "Apple Watch 提醒实验先完成最小验证，不把设备折腾当成主线。",
    "Cyberboss 共享桥接与 timeline 命令链路继续收口。",
  ]);
  assert.doesNotMatch(review.draft.content.progress, /00:21 本来想刷牙/u);
  assert.match(review.draft.content.supplements, /本周值得带走的模式/u);
});

test("review can upgrade legacy managed markers to codeksei markers", async () => {
  const fixture = setupReviewFixture();
  const legacyNotePath = path.join(fixture.workspaceRoot, "项目", "Cyberboss 生活助理", "复盘", "Monthly", "2026-04.md");
  fs.mkdirSync(path.dirname(legacyNotePath), { recursive: true });
  fs.writeFileSync(legacyNotePath, [
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
    "  - cyberboss",
    "---",
    "# 2026-04 月复盘",
    "",
    "## 每天收口摘录",
    "<!-- cyberboss-review:daily-summaries:start -->",
    "- 旧内容",
    "<!-- cyberboss-review:daily-summaries:end -->",
    "",
  ].join("\n"), "utf8");

  const result = await writeReview(fixture.config, "monthly", { month: "2026-04" });
  assert.equal(result.changed, true);
  const content = fs.readFileSync(legacyNotePath, "utf8");
  assert.match(content, /codeksei-review:daily-summaries:start/u);
  assert.doesNotMatch(content, /cyberboss-review:daily-summaries:start/u);
});

test("review falls back to deterministic draft when semantic generator errors", async () => {
  const fixture = setupReviewFixture();
  fixture.config.reviewSemanticMode = "hybrid";
  fixture.config.reviewSemanticGenerator = async () => {
    throw new Error("semantic boom");
  };

  const review = await buildReview(fixture.config, "weekly", { week: "2026-W15" });
  assert.equal(review.semantic.used, false);
  assert.match(review.semantic.reason, /semantic boom/u);
  assert.match(review.draft.content.progress, /Apple Watch 提醒实验/u);
});

test("review weekly still works when nightly profile is absent", async () => {
  const fixture = setupReviewFixture();
  const schemaPath = fixture.config.reviewSchemaConfigFile;
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  delete schema.workspaces[fixture.workspaceRoot.replace(/\\/g, "/")].reviews.nightly;
  fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2), "utf8");
  clearJsonConfigCache(schemaPath);

  const review = await buildReview(fixture.config, "weekly", { week: "2026-W15" });
  assert.equal(review.nightlyEntries.length, 0);
  assert.equal(review.draft.sourceNightlyDays, 0);
  assert.match(review.draft.content.progress, /Apple Watch 提醒实验/u);
});
