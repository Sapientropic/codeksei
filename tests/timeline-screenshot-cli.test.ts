const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  parseTimelineScreenshotArgs,
  runTimelineScreenshotCommand,
} = require("../src/app/timeline-screenshot-cli");

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

test("hosted timeline screenshot captures locally then routes the artifact through Hermes repo-local delivery", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hosted-timeline-shot-"));
  const outputFile = path.join(tempRoot, "timeline-shot.png");
  const delivered: Array<Record<string, unknown>> = [];

  const result = await runTimelineScreenshotCommand({
    runtime: "hermes",
    channelProvider: "hermes",
    stateDir: tempRoot,
    timelineStateDir: tempRoot,
  }, [
    "--send",
    "--selector", "timeline",
    "--output", outputFile,
  ], {
    captureTimelineScreenshot: async () => {
      fs.writeFileSync(outputFile, "fake-png", "utf8");
      return {
        outputFile,
        selector: ".screenshot-target-timeline",
        url: "http://127.0.0.1:4317",
        width: 1680,
        height: 1400,
      };
    },
    sendFileViaHermesRepoLocal: () => {
      delivered.push({ outputFile });
      return {
        chatId: "wxid_sender",
        filePath: outputFile,
        mirrored: true,
        platform: "weixin",
        sessionId: "sess-123",
        sessionKey: "agent:main:weixin:dm:wxid_sender",
        threadId: "",
      };
    },
  });

  assert.equal(result.data.outputFile, outputFile);
  assert.equal(result.data.platform, "weixin");
  assert.equal(delivered.length, 1);
  const firstDelivery = delivered[0];
  assert.ok(firstDelivery);
  assert.equal(firstDelivery.outputFile, outputFile);
});
