const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { ensureTimelineStateTimezone } = require("../src/integrations/timeline/state-sync");
const { resolveTimelineStateFiles } = require("../src/core/timezone");

interface TimelineStateSnapshotFixture {
  timezone: string;
  taxonomy?: Record<string, unknown>;
  facts?: Record<string, unknown>;
  proposals?: unknown[];
}

function writeTimelineSnapshot(dirPath: string, snapshot: TimelineStateSnapshotFixture) {
  const files = resolveTimelineStateFiles(dirPath);
  fs.mkdirSync(files.dir, { recursive: true });
  fs.writeFileSync(files.stateFile, JSON.stringify({
    version: 1,
    timezone: snapshot.timezone,
    taxonomy: snapshot.taxonomy || {},
    facts: snapshot.facts || {},
    proposals: snapshot.proposals || [],
  }, null, 2), "utf8");
  fs.writeFileSync(files.taxonomyFile, JSON.stringify({
    version: 1,
    timezone: snapshot.timezone,
    taxonomy: snapshot.taxonomy || {},
  }, null, 2), "utf8");
  fs.writeFileSync(files.factsFile, JSON.stringify({
    version: 1,
    timezone: snapshot.timezone,
    facts: snapshot.facts || {},
    proposals: snapshot.proposals || [],
  }, null, 2), "utf8");
}

function readTimelineState(dirPath: string): {
  timezone: string;
  facts: Record<string, { events: Array<{ id: string }> }>;
} {
  const files = resolveTimelineStateFiles(dirPath);
  return JSON.parse(fs.readFileSync(files.stateFile, "utf8"));
}

test("timeline state sync migrates legacy Asia/Shanghai buckets into current timezone", () => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-sync-"));
  writeTimelineSnapshot(dirPath, {
    timezone: "Asia/Shanghai",
    facts: {
      "2026-04-10": {
        status: "draft",
        updatedAt: "2026-04-10T01:00:00.000Z",
        source: null,
        events: [{
          id: "evt-1",
          startAt: "2026-04-10T00:30:00+08:00",
          endAt: "2026-04-10T01:00:00+08:00",
          title: "凌晨事件",
        }],
      },
    },
  });

  ensureTimelineStateTimezone({
    timelineStateDir: dirPath,
    timezone: "America/Los_Angeles",
    timezoneSource: "system",
    timezoneExplicit: false,
  });

  const state = readTimelineState(dirPath);
  assert.equal(state.timezone, "America/Los_Angeles");
  assert.ok(state.facts["2026-04-09"]);
  assert.equal(state.facts["2026-04-09"].events[0].id, "evt-1");
});

test("timeline state sync does not rewrite a custom timezone just because the machine differs", () => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-custom-"));
  writeTimelineSnapshot(dirPath, {
    timezone: "America/New_York",
    facts: {
      "2026-04-10": {
        status: "draft",
        updatedAt: "2026-04-10T01:00:00.000Z",
        source: null,
        events: [{
          id: "evt-1",
          startAt: "2026-04-10T09:30:00-04:00",
          endAt: "2026-04-10T10:00:00-04:00",
          title: "custom timezone event",
        }],
      },
    },
  });

  ensureTimelineStateTimezone({
    timelineStateDir: dirPath,
    timezone: "America/Los_Angeles",
    timezoneSource: "system",
    timezoneExplicit: false,
  });

  const state = readTimelineState(dirPath);
  assert.equal(state.timezone, "America/New_York");
  assert.ok(state.facts["2026-04-10"]);
  assert.equal(state.facts["2026-04-10"].events[0].id, "evt-1");
});

test("timeline state sync bootstraps timezone metadata for an empty state dir", () => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-empty-"));

  ensureTimelineStateTimezone({
    timelineStateDir: dirPath,
    timezone: "Europe/Paris",
    timezoneSource: "env",
    timezoneExplicit: true,
  });

  const state = readTimelineState(dirPath);
  assert.equal(state.timezone, "Europe/Paris");
  assert.deepEqual(state.facts, {});
});
