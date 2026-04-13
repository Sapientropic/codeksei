const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { buildTimelineViews } = require("../src/timeline/runtime/infra/timeline/timeline-analytics");

function createBaseState(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    timezone: "Asia/Shanghai",
    taxonomy: {
      categories: [
        {
          id: "work",
          label: "工作",
          color: "var(--cat-work)",
          children: [{ id: "work.coding", label: "编码" }],
        },
      ],
      eventNodes: [],
    },
    facts: {},
    proposals: [],
    ...overrides,
  };
}

test("buildTimelineViews returns empty timeline collections when there are no facts", () => {
  const views = buildTimelineViews(createBaseState(), {}, { locale: "zh-CN" });

  assert.equal(views.meta.latestDate, "");
  assert.deepEqual(views.meta.availableDates, []);
  assert.deepEqual(views.timelines.day, {});
  assert.deepEqual(views.timelines.week, {});
  assert.deepEqual(views.ranges.day, {});
  assert.deepEqual(views.ranges.week, {});
  assert.deepEqual(views.ranges.month, {});
});

test("buildTimelineViews anchors cross-day events onto a single reference day in week view", () => {
  const views = buildTimelineViews(createBaseState({
    facts: {
      "2026-04-05": {
        status: "draft",
        updatedAt: "2026-04-05T10:00:00+08:00",
        source: null,
        events: [
          {
            id: "evt-1",
            startAt: "2026-04-05T23:30:00+08:00",
            endAt: "2026-04-06T01:00:00+08:00",
            title: "Late Work",
            note: "",
            categoryId: "work",
            subcategoryId: "work.coding",
            eventNodeId: "",
            tags: [],
            confidence: 1,
            sourceMessageIds: [],
          },
        ],
      },
    },
  }), {}, { locale: "zh-CN" });

  const weekKeys = Object.keys(views.timelines.week);
  const weekKey = weekKeys[0];
  assert.equal(weekKeys.length, 1);
  assert.ok(weekKey);
  const week = views.timelines.week[weekKey];
  assert.equal(week.items.length, 1);
  assert.equal(week.items[0].start, "2000-01-01T23:30:00+08:00");
  assert.equal(week.items[0].end, "2000-01-02T01:00:00+08:00");
});

test("buildTimelineViews fills sparse week ranges to seven calendar days", () => {
  const views = buildTimelineViews(createBaseState({
    facts: {
      "2026-04-07": {
        status: "draft",
        updatedAt: "2026-04-07T10:00:00+08:00",
        source: null,
        events: [],
      },
      "2026-04-09": {
        status: "draft",
        updatedAt: "2026-04-09T10:00:00+08:00",
        source: null,
        events: [],
      },
    },
  }), {}, { locale: "zh-CN" });

  const weekKeys = Object.keys(views.ranges.week);
  const weekKey = weekKeys[0];
  assert.equal(weekKeys.length, 1);
  assert.ok(weekKey);
  const week = views.ranges.week[weekKey];
  assert.equal(Object.keys(views.timelines.week).length, 1);
  assert.equal(views.timelines.week[weekKey].groups.length, 7);
  assert.equal(week.label, `${weekKey} 当周`);
});

test("buildTimelineViews falls back to raw category identifiers when taxonomy entries are missing", () => {
  const views = buildTimelineViews(createBaseState({
    facts: {
      "2026-04-05": {
        status: "draft",
        updatedAt: "2026-04-05T10:00:00+08:00",
        source: null,
        events: [
          {
            id: "evt-unknown",
            startAt: "2026-04-05T09:00:00+08:00",
            endAt: "2026-04-05T10:00:00+08:00",
            title: "Mystery Block",
            note: "",
            categoryId: "mystery",
            subcategoryId: "mystery.unknown",
            eventNodeId: "",
            tags: [],
            confidence: 1,
            sourceMessageIds: [],
          },
        ],
      },
    },
  }), {}, { locale: "zh-CN" });

  const day = views.ranges.day["2026-04-05"];
  assert.equal(day.categories[0].categoryId, "mystery");
  assert.equal(day.categories[0].label, "mystery");
  assert.equal(day.categoryDetails.mystery.subcategories[0].label, "mystery.unknown");
});

test("buildTimelineViews localizes week labels and taxonomy when locale is english", () => {
  const views = buildTimelineViews(createBaseState({
    taxonomy: {
      categories: [
        {
          id: "life",
          label: "生活",
          color: "var(--cat-life)",
          children: [{ id: "life.meal", label: "吃饭" }],
        },
      ],
      eventNodes: [],
    },
    facts: {
      "2026-04-07": {
        status: "draft",
        updatedAt: "2026-04-07T10:00:00+08:00",
        source: null,
        events: [],
      },
    },
  }), {}, { locale: "en" });

  const weekKeys = Object.keys(views.ranges.week);
  const weekKey = weekKeys[0];
  assert.equal(views.taxonomy.categories[0].label, "Life");
  assert.equal(views.taxonomy.categories[0].children[0].label, "Meals");
  assert.equal(views.meta.locale, "en");
  assert.ok(weekKey);
  assert.match(views.timelines.week[weekKey].groups[0].content, /Mon|Tue|Wed|Thu|Fri|Sat|Sun/u);
  assert.match(views.ranges.week[weekKey].label, /^Week of /u);
});
