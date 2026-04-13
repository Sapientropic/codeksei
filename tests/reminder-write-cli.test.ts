const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  normalizeBody,
  normalizeAbsoluteTimeString,
  parseDelay,
  resolveDueAtMs,
} = require("../src/app/reminder-write-cli");

test("reminder local absolute time follows configured timezone", () => {
  assert.equal(
    normalizeAbsoluteTimeString("2026-04-07 21:30", "America/New_York"),
    "2026-04-07T21:30:00-04:00"
  );
  assert.equal(
    normalizeAbsoluteTimeString("2026-12-07 21:30", "America/New_York"),
    "2026-12-07T21:30:00-05:00"
  );
});

test("reminder date-only absolute time defaults to 09:00 in configured timezone", () => {
  assert.equal(
    normalizeAbsoluteTimeString("2026-04-07", "Asia/Tokyo"),
    "2026-04-07T09:00:00+09:00"
  );
});

test("resolveDueAtMs rejects simultaneous delay and absolute time", () => {
  assert.throws(
    () => resolveDueAtMs({
      delay: "10m",
      at: "2026-04-07 21:30",
    }, "Asia/Shanghai"),
    /--delay 和 --at 不能同时传/
  );
});

test("reminder delay parser accepts compact chained units and rejects garbage", () => {
  assert.equal(parseDelay("1h30m"), 5_400_000);
  assert.equal(parseDelay("2d 4h 20m"), 188_400_000);
  assert.equal(parseDelay("soon"), 0);
});

test("reminder body normalization trims whitespace and normalizes line endings", () => {
  assert.equal(
    normalizeBody("  第一行\r\n第二行\r\n"),
    "第一行\n第二行"
  );
});
