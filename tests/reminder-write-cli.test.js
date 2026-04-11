const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeAbsoluteTimeString,
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
