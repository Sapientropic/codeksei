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

  assert.equal(options.send, true);
  assert.equal(options.user, "wxid_123");
  assert.deepEqual(options.forwardArgs, ["--selector", "timeline"]);
});

test("timeline screenshot captures locally by default without sending", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-shot-local-"));
  const outputFile = path.join(tempRoot, "timeline-shot.png");
  let delivered = false;

  const result = await runTimelineScreenshotCommand({
    runtime: "hermes",
    channelProvider: "hermes",
    stateDir: tempRoot,
    timelineStateDir: tempRoot,
  }, [
    "--selector", "timeline",
    "--output", outputFile,
  ], null, {
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
    deliverLocalFileToCurrentChat: async () => {
      delivered = true;
      throw new Error("should not deliver without --send");
    },
  });

  assert.equal(result.data.deliveryMode, "local_file");
  assert.equal(result.data.outputFile, outputFile);
  assert.equal(delivered, false);
});

test("hosted timeline screenshot captures locally then routes the artifact through the current host delivery seam", async () => {
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
  ], null, {
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
    deliverLocalFileToCurrentChat: async (
      _app: unknown,
      _config: unknown,
      args: { filePath: string; senderId?: string },
    ) => {
      delivered.push({ filePath: args.filePath });
      return {
        chatId: "wxid_sender",
        filePath: outputFile,
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
  assert.equal(firstDelivery.filePath, outputFile);
});

test("bridge timeline screenshot --send captures first, then reuses bridge file delivery", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-bridge-timeline-shot-"));
  const outputFile = path.join(tempRoot, "timeline-shot.png");
  const appCalls: Array<Record<string, unknown>> = [];

  const result = await runTimelineScreenshotCommand({
    runtime: "codex",
    channelProvider: "codeksei",
    stateDir: tempRoot,
    timelineStateDir: tempRoot,
  }, [
    "--send",
    "--user", "wxid_123",
    "--output", outputFile,
  ], {
    sendLocalFileToCurrentChat: async (
      { filePath, senderId }: { filePath: string; senderId: string },
    ) => {
      appCalls.push({ filePath, senderId });
      return { filePath };
    },
  }, {
    captureTimelineScreenshot: async () => {
      fs.writeFileSync(outputFile, "fake-png", "utf8");
      return {
        outputFile,
        selector: ".page",
        url: "http://127.0.0.1:4317",
        width: 1680,
        height: 1400,
      };
    },
  });

  assert.equal(result.data.deliveryMode, "current_host_delivery");
  assert.equal(appCalls.length, 1);
  const firstCall = appCalls[0];
  assert.ok(firstCall);
  assert.equal(firstCall.filePath, outputFile);
  assert.equal(firstCall.senderId, "wxid_123");
});
