const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const { TimelineStore } = require("../src/timeline/runtime/infra/timeline/timeline-store");
const { buildTimelineViews } = require("../src/timeline/runtime/infra/timeline/timeline-analytics");
const { resolveTimelineScreenshotOptions } = require("../src/timeline/runtime/application/timeline/capture-screenshot");

test("TimelineStore persists canonical timeline state across state/taxonomy/facts files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-store-"));
  const timelineDir = path.join(tempRoot, "timeline");
  const stateFilePath = path.join(timelineDir, "timeline-state.json");
  const taxonomyFilePath = path.join(timelineDir, "timeline-taxonomy.json");
  const factsFilePath = path.join(timelineDir, "timeline-facts.json");

  const store = new TimelineStore({
    stateFilePath,
    taxonomyFilePath,
    factsFilePath,
    legacyFilePath: path.join(timelineDir, "timeline-db.json"),
  });

  const savedDay = store.replaceDay({
    date: "2026-04-05",
    status: "draft",
    events: [
      {
        startAt: "2026-04-05T09:00:00+08:00",
        endAt: "2026-04-05T09:45:00+08:00",
        title: "Deep Work",
        categoryId: "work",
        subcategoryId: "work.coding",
      },
    ],
  });

  assert.ok(savedDay);
  assert.equal(savedDay.events.length, 1);
  assert.match(savedDay.events[0].id, /^fact:/u);
  assert.equal(fs.existsSync(stateFilePath), true);
  assert.equal(fs.existsSync(taxonomyFilePath), true);
  assert.equal(fs.existsSync(factsFilePath), true);

  const factsPayload = JSON.parse(fs.readFileSync(factsFilePath, "utf8"));
  assert.equal(factsPayload.facts["2026-04-05"].events[0].categoryId, "work");
  assert.equal(store.getDay("2026-04-05")?.events[0].subcategoryId, "work.coding");
});

test("buildTimelineViews aggregates canonical timeline state into dashboard ranges", () => {
  const views = buildTimelineViews({
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
      eventNodes: [
        {
          id: "evt.deep_work",
          label: "Deep Work",
          aliases: [],
          parentId: "work.coding",
          status: "official",
        },
      ],
    },
    facts: {
      "2026-04-05": {
        status: "draft",
        updatedAt: "2026-04-05T10:00:00+08:00",
        source: null,
        events: [
          {
            id: "evt-1",
            startAt: "2026-04-05T09:00:00+08:00",
            endAt: "2026-04-05T10:00:00+08:00",
            title: "Deep Work",
            note: "Focus block",
            categoryId: "work",
            subcategoryId: "work.coding",
            eventNodeId: "evt.deep_work",
            tags: [],
            confidence: 0.9,
            sourceMessageIds: [],
          },
        ],
      },
    },
    proposals: [],
  });

  assert.equal(views.meta.latestDate, "2026-04-05");
  assert.equal(views.timelines.day["2026-04-05"].items.length, 1);
  assert.equal(views.ranges.day["2026-04-05"].categories[0].categoryId, "work");
  assert.equal(
    views.ranges.day["2026-04-05"].categoryDetails.work.events[0].label,
    "Deep Work",
  );
});

test("resolveTimelineScreenshotOptions normalizes selector aliases and range routing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-shot-"));
  const options = resolveTimelineScreenshotOptions(
    {
      chromeExecutablePath: "",
      stateDir: tempRoot,
      timelineDbFile: path.join(tempRoot, "timeline-db.json"),
      timelineDir: path.join(tempRoot, "timeline"),
      timelineFactsFile: path.join(tempRoot, "timeline-facts.json"),
      timelinePort: 4317,
      timelineSiteDir: path.join(tempRoot, "site"),
      timelineStateFile: path.join(tempRoot, "timeline-state.json"),
      timelineTaxonomyFile: path.join(tempRoot, "timeline-taxonomy.json"),
      timelineWriteLockDir: path.join(tempRoot, "timeline.lock"),
    },
    {
      selector: "分析区",
      range: "周",
      week: "2026-04-07",
      category: "工作",
      detail: "编码",
    },
  );

  assert.equal(options.selector, ".screenshot-target-analytics");
  assert.equal(options.range, "week");
  assert.equal(options.week, "2026-04-07");
  assert.equal(options.category, "工作");
  assert.equal(options.subcategory, "编码");
  assert.match(options.outputFile, /timeline-[\d-]+\.png$/u);
});
