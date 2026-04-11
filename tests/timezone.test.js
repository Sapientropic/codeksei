const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildZonedIsoString,
  formatDateInTimezone,
  resolveTimelineStateFiles,
  resolveTimezoneConfig,
} = require("../src/core/timezone");

test("buildZonedIsoString keeps DST-aware offsets stable", () => {
  assert.equal(
    buildZonedIsoString("2026-04-10", "09:30", "America/New_York"),
    "2026-04-10T09:30:00-04:00"
  );
  assert.equal(
    buildZonedIsoString("2026-12-10", "09:30", "America/New_York"),
    "2026-12-10T09:30:00-05:00"
  );
});

test("formatDateInTimezone buckets the same instant by requested timezone", () => {
  const instant = "2026-04-10T00:30:00+08:00";
  assert.equal(formatDateInTimezone(instant, "Asia/Shanghai"), "2026-04-10");
  assert.equal(formatDateInTimezone(instant, "America/Los_Angeles"), "2026-04-09");
});

test("resolveTimezoneConfig preserves non-legacy timeline timezone over machine fallback", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timezone-"));
  fs.writeFileSync(path.join(tempDir, "timeline-state.json"), JSON.stringify({
    version: 1,
    timezone: "America/New_York",
    taxonomy: {},
    facts: {},
    proposals: [],
  }, null, 2), "utf8");

  const resolved = resolveTimezoneConfig({
    explicitTimezone: "",
    timelineStateDir: tempDir,
  });

  assert.equal(resolved.timezone, "America/New_York");
  assert.equal(resolved.source, "timeline_state");
});

test("resolveTimezoneConfig lets explicit env override stored timeline timezone", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timezone-env-"));
  fs.writeFileSync(path.join(tempDir, "timeline-state.json"), JSON.stringify({
    version: 1,
    timezone: "America/New_York",
    taxonomy: {},
    facts: {},
    proposals: [],
  }, null, 2), "utf8");

  const resolved = resolveTimezoneConfig({
    explicitTimezone: "Europe/Paris",
    timelineStateDir: tempDir,
  });

  assert.equal(resolved.timezone, "Europe/Paris");
  assert.equal(resolved.source, "env");
});

test("resolveTimelineStateFiles defaults fresh roots to the nested timeline layout", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timezone-layout-"));
  const files = resolveTimelineStateFiles(tempDir);

  assert.equal(files.stateFile.replace(/\\/g, "/"), `${tempDir.replace(/\\/g, "/")}/timeline/timeline-state.json`);
  assert.equal(files.taxonomyFile.replace(/\\/g, "/"), `${tempDir.replace(/\\/g, "/")}/timeline/timeline-taxonomy.json`);
  assert.equal(files.factsFile.replace(/\\/g, "/"), `${tempDir.replace(/\\/g, "/")}/timeline/timeline-facts.json`);
});
