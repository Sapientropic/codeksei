const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildRuntimeInboundText,
  hasRpcId,
  resolveTimelineScreenshotOutput,
} = require("../src/core/app-runtime-helpers");

test("app runtime helpers extract the explicit timeline screenshot output path", () => {
  assert.equal(
    resolveTimelineScreenshotOutput(["--selector", "timeline", "--output", "C:/tmp/shot.png"]),
    "C:/tmp/shot.png"
  );
  assert.equal(resolveTimelineScreenshotOutput(["--selector", "timeline"]), "");
});

test("app runtime helpers keep attachment guidance and local time in inbound text", () => {
  const text = buildRuntimeInboundText({
    text: "请先看图。",
    receivedAt: "2026-04-12T09:30:00+08:00",
  }, {
    saved: [
      {
        kind: "image",
        absolutePath: "C:/tmp/shot.png",
        sourceFileName: "shot.png",
      },
    ],
    failed: [],
  }, {
    userName: "单道杨",
    userGender: "male",
    timezone: "Asia/Shanghai",
  });

  assert.match(text, /\[2026-04-12 09:30/u);
  assert.match(text, /请先看图。/u);
  assert.match(text, /单道杨 sent image\/file attachments/u);
  assert.match(text, /C:\/tmp\/shot\.png/u);
});

test("app runtime helpers keep rpc id detection strict but non-empty", () => {
  assert.equal(hasRpcId("123"), true);
  assert.equal(hasRpcId(123), true);
  assert.equal(hasRpcId("   "), false);
  assert.equal(hasRpcId(null), false);
});
