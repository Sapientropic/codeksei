const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseTimelineEventArgs,
  buildTimelineEventWriteArgs,
  normalizeTimelineEventTimestamp,
} = require("../src/app/timeline-event-cli");

function extractJsonPayload(args) {
  const jsonIndex = args.indexOf("--json");
  assert.notEqual(jsonIndex, -1, "expected --json in args");
  return JSON.parse(args[jsonIndex + 1]);
}

test("timeline:event builds a single-event write payload from friendly flags", () => {
  const options = parseTimelineEventArgs([
    "--date", "2026-04-10",
    "--start", "09:30",
    "--end", "10:15",
    "--title", "看提交历史",
    "--category", "work",
    "--subcategory", "work.dev",
    "--tag", "codeksei",
    "--tag", "timeline",
  ]);

  const args = buildTimelineEventWriteArgs(options, "为了补日记和时间线先核对最近改动。");
  const payload = extractJsonPayload(args);

  assert.deepEqual(args.slice(0, 4), ["--date", "2026-04-10", "--mode", "merge"]);
  assert.equal(payload.date, "2026-04-10");
  assert.equal(payload.events.length, 1);
  assert.equal(payload.events[0].title, "看提交历史");
  assert.equal(payload.events[0].startAt, "2026-04-10T09:30:00+08:00");
  assert.equal(payload.events[0].endAt, "2026-04-10T10:15:00+08:00");
  assert.equal(payload.events[0].categoryId, "work");
  assert.equal(payload.events[0].subcategoryId, "work.dev");
  assert.deepEqual(payload.events[0].tags, ["codeksei", "timeline"]);
  assert.equal(payload.events[0].note, "为了补日记和时间线先核对最近改动。");
  assert.match(payload.events[0].id, /^evt_/);
});

test("timeline:event normalizes full local timestamps without offset", () => {
  assert.equal(
    normalizeTimelineEventTimestamp("2026-04-10", "2026-04-10 11:20", "--start"),
    "2026-04-10T11:20:00+08:00"
  );
});

test("timeline:event can derive DST-aware offsets from configured timezone", () => {
  const options = parseTimelineEventArgs([
    "--date", "2026-04-10",
    "--start", "09:30",
    "--end", "10:15",
    "--title", "纽约晨间整理",
    "--subcategory", "work.dev",
  ]);

  const args = buildTimelineEventWriteArgs(options, "", {
    timezone: "America/New_York",
  });
  const payload = extractJsonPayload(args);

  assert.equal(payload.events[0].startAt, "2026-04-10T09:30:00-04:00");
  assert.equal(payload.events[0].endAt, "2026-04-10T10:15:00-04:00");
});

test("timeline:event rejects missing timeline classification", () => {
  assert.throws(
    () => buildTimelineEventWriteArgs({
      date: "2026-04-10",
      start: "09:00",
      end: "09:30",
      title: "无分类事件",
      note: "",
      categoryId: "",
      subcategoryId: "",
      eventNodeId: "",
      mode: "merge",
      eventId: "",
      finalize: false,
      useStdin: false,
      tags: [],
    }),
    /缺少分类信息/
  );
});
