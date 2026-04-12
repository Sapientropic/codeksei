const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { parseTimelineScreenshotArgs } = require("../src/app/timeline-screenshot-cli");

test("timeline screenshot parser ignores --send and --demo while forwarding other args", () => {
  const options = parseTimelineScreenshotArgs([
    "--send",
    "--demo",
    "--selector", "timeline",
    "--user", "wxid_123",
  ]);

  assert.equal(options.user, "wxid_123");
  assert.deepEqual(options.forwardArgs, ["--selector", "timeline"]);
});
