const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  detectTimelineWriteFailure,
  extractTimelineCommandFailure,
  normalizeTimelineArgs,
  shouldForwardTimelineStdin,
} = require("../src/integrations/timeline");

test("timeline integration forwards stdin only for non-tty --stdin writes", () => {
  assert.equal(shouldForwardTimelineStdin(["write", "--stdin"], { isTTY: false }), true);
  assert.equal(shouldForwardTimelineStdin(["write", "--stdin"], { isTTY: true }), false);
  assert.equal(shouldForwardTimelineStdin(["write", "--json", "{\"events\":[]}"], { isTTY: false }), false);
});

test("timeline integration surfaces structured write-missing failures", () => {
  const message = detectTimelineWriteFailure("status: missing\nevents: 0\n", "");
  assert.match(message, /没有写入任何事件/u);
  assert.match(message, /有效 JSON events/u);
});

test("timeline integration surfaces timeline validation details before generic exit code text", () => {
  const detail = extractTimelineCommandFailure("", "Error: timeline 事件无效: startAt 必填\n");
  assert.equal(detail, "Error: timeline 事件无效: startAt 必填");
});

test("timeline integration still recovers swallowed --date tokens", () => {
  assert.deepEqual(
    normalizeTimelineArgs("write", ["2026-04-11", "--mode=merge"]),
    ["--date", "2026-04-11", "--mode", "merge"]
  );
});
