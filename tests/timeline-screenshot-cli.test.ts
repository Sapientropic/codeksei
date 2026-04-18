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
    "--demo",
    "--selector", "timeline",
    "--output", "shot.png",
  ]);

  assert.equal(options.outputFile, path.resolve("shot.png"));
  assert.deepEqual(options.forwardArgs, ["--selector", "timeline"]);
});

test("timeline screenshot rejects legacy --send and points to channel send-file", async () => {
  await assert.rejects(
    () => runTimelineScreenshotCommand({
      runtime: "hermes",
      channelProvider: "hermes",
      stateDir: "E:/state",
      timelineStateDir: "E:/state",
    }, ["--send", "--selector", "timeline"]),
    /channel send-file/u,
  );
});

test("timeline screenshot rejects legacy --user and points to channel send-file", async () => {
  await assert.rejects(
    () => runTimelineScreenshotCommand({
      runtime: "hermes",
      channelProvider: "hermes",
      stateDir: "E:/state",
      timelineStateDir: "E:/state",
    }, ["--user", "wxid_123", "--selector", "timeline"]),
    /channel send-file/u,
  );
});

test("timeline screenshot captures locally by default without sending", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-shot-local-"));
  const outputFile = path.join(tempRoot, "timeline-shot.png");

  const result = await runTimelineScreenshotCommand({
    runtime: "hermes",
    channelProvider: "hermes",
    stateDir: tempRoot,
    timelineStateDir: tempRoot,
  }, [
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
  });

  assert.equal(result.data.deliveryMode, "local_file");
  assert.equal(result.data.outputFile, outputFile);
});
