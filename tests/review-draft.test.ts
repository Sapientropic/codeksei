const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildReviewDraft,
  mergeReviewDraft,
  resolveReviewWindow,
}: typeof import("../src/review/review-draft") = require("../src/review/review-draft");
import type { DiaryReviewEntry, ReviewProfile, ReviewWindow } from "../src/review/review-types";

function createNightlyProfile(): ReviewProfile {
  return {
    kind: "nightly",
    titleSuffix: "睡前收口",
  };
}

function createWeeklyProfile(): ReviewProfile {
  return {
    kind: "weekly",
    titleSuffix: "周复盘",
  };
}

test("review draft nightly keeps carry-forward and friction heuristics deterministic", () => {
  const draft = buildReviewDraft(
    createNightlyProfile(),
    { label: "2026-04-10", startDate: "2026-04-10", endDate: "2026-04-10", timezone: "Asia/Shanghai" } satisfies ReviewWindow,
    [{
      date: "2026-04-10",
      todo: {
        open: ["明天验证 Apple Watch 提醒链路"],
        done: ["收住回复重复发送问题"],
      },
      timeline: ["Apple Watch 提醒实验先走最小验证"],
      fragment: ["注册营养师模板对 C 档仍偏重"],
      supplement: [
        { time: "20:10", title: "点外卖时容易被手机岔走", body: "这是很典型的 ADHD 模式" },
      ],
      summary: [
        "Apple Watch 提醒实验先走最小验证",
        "明天先把提醒链路补完整",
      ],
    }] satisfies DiaryReviewEntry[],
    []
  );

  assert.deepEqual(draft.insights.progress, ["Apple Watch 提醒实验先走最小验证"]);
  assert.match(draft.insights.friction.join("\n"), /偏重|岔走/u);
  assert.match(draft.content["carry-forward"], /明天先把提醒链路补完整/u);
});

test("review draft weekly resolves explicit week and monthly windows without changing semantics", () => {
  assert.deepEqual(
    resolveReviewWindow("weekly", { week: "2026-W15", timezone: "Asia/Shanghai" }),
    {
      label: "2026-W15",
      startDate: "2026-04-06",
      endDate: "2026-04-12",
      timezone: "Asia/Shanghai",
    }
  );
  assert.deepEqual(
    resolveReviewWindow("monthly", { month: "2026-04", timezone: "Asia/Shanghai" }),
    {
      label: "2026-04",
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      timezone: "Asia/Shanghai",
    }
  );
});

test("review draft merges semantic replacements only when payload is non-empty", () => {
  const deterministic = buildReviewDraft(
    createWeeklyProfile(),
    { label: "2026-W15", startDate: "2026-04-06", endDate: "2026-04-12", timezone: "Asia/Shanghai" } satisfies ReviewWindow,
    [{
      date: "2026-04-10",
      todo: { open: ["继续补 Apple Watch"], done: [] },
      timeline: ["Apple Watch 提醒实验完成最小验证"],
      fragment: ["今天有点偏重"],
      supplement: [],
      summary: ["下周先把 Apple Watch 提醒链路接上"],
    }] satisfies DiaryReviewEntry[],
    []
  );

  const unchanged = mergeReviewDraft("weekly", deterministic, null);
  assert.deepEqual(unchanged, deterministic);

  const merged = mergeReviewDraft("weekly", deterministic, {
    progress: ["Apple Watch 提醒实验不再只是折腾设备。"],
    friction: [],
    carryForward: ["下次先补提醒链路。"],
  });
  assert.deepEqual(merged.insights.progress, ["Apple Watch 提醒实验不再只是折腾设备。"]);
  assert.match(merged.content["carry-forward"], /下次先补提醒链路/u);
  assert.match(merged.content.friction, /偏重/u);
});
