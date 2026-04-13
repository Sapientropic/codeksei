const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const {
  captureTimelineScreenshot,
  resolveTimelineScreenshotOptions,
} = require("../src/timeline/runtime/application/timeline/capture-screenshot");

function createRuntimeConfig(tempRoot: string) {
  const timelineDir = path.join(tempRoot, "timeline");
  return {
    chromeExecutablePath: "",
    stateDir: tempRoot,
    timelineDbFile: path.join(timelineDir, "timeline-db.json"),
    timelineDir,
    timelineFactsFile: path.join(timelineDir, "timeline-facts.json"),
    timelineLocale: "zh-CN",
    timelinePort: 4317,
    timelineSiteDir: path.join(timelineDir, "site"),
    timelineStateFile: path.join(timelineDir, "timeline-state.json"),
    timelineTaxonomyFile: path.join(timelineDir, "timeline-taxonomy.json"),
    timelineWriteLockDir: path.join(timelineDir, "timeline-write.lock"),
  };
}

function createFakePage({ screenshotImpl }: { screenshotImpl?: (filePath: string) => void } = {}) {
  return {
    async goto() {},
    async emulateMedia() {},
    async addStyleTag() {},
    async waitForFunction() {},
    locator(selector: string) {
      return {
        async waitFor() {},
        async screenshot(options: { path: string }) {
          if (selector === ".page" && typeof options?.path === "string") {
            return;
          }
          if (screenshotImpl) {
            screenshotImpl(options.path);
            return;
          }
          fs.writeFileSync(options.path, Buffer.from("png"));
        },
      };
    },
  };
}

test("captureTimelineScreenshot uses injected deps and writes the requested screenshot", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-shot-runtime-"));
  const config = createRuntimeConfig(tempRoot);
  const outputFile = path.join(tempRoot, "shots", "dashboard.png");
  const calls: string[] = [];
  const fakePage = createFakePage({
    screenshotImpl(filePath) {
      calls.push(`screenshot:${path.basename(filePath)}`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, Buffer.from("fake-png"));
    },
  });
  const fakeBrowser = {
    async newPage() {
      calls.push("newPage");
      return fakePage;
    },
    async close() {
      calls.push("browser.close");
    },
  };
  const fakeServer = { close() {} };

  const result = await captureTimelineScreenshot(config, {
    selector: "timeline",
    outputFile,
  }, {
    async buildTimelineSite() {
      calls.push("buildSite");
    },
    async startTimelineSiteServer() {
      calls.push("startServer");
      return { server: fakeServer, info: { url: "http://127.0.0.1:4317" } };
    },
    async closeTimelineSiteServer() {
      calls.push("server.close");
    },
    async launchBrowser() {
      calls.push("launchBrowser");
      return fakeBrowser as never;
    },
    async applyScreenshotControls() {
      calls.push("applyControls");
    },
    async waitForDashboardReady() {
      calls.push("waitForDashboardReady");
    },
  });

  assert.equal(result.outputFile, outputFile);
  assert.equal(result.selector, ".screenshot-target-timeline");
  assert.equal(fs.existsSync(outputFile), true);
  assert.deepEqual(calls, [
    "buildSite",
    "startServer",
    "launchBrowser",
    "newPage",
    "applyControls",
    "waitForDashboardReady",
    "screenshot:dashboard.png",
    "browser.close",
    "server.close",
  ]);
});

test("captureTimelineScreenshot still closes the browser and server when screenshot capture fails", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-shot-fail-"));
  const config = createRuntimeConfig(tempRoot);
  const calls: string[] = [];
  const fakePage = createFakePage({
    screenshotImpl() {
      throw new Error("shot failed");
    },
  });
  const fakeBrowser = {
    async newPage() {
      return fakePage;
    },
    async close() {
      calls.push("browser.close");
    },
  };

  await assert.rejects(
    () => captureTimelineScreenshot(config, {
      selector: "events",
      outputFile: path.join(tempRoot, "events.png"),
    }, {
      async buildTimelineSite() {},
      async startTimelineSiteServer() {
        return { server: { close() {} }, info: { url: "http://127.0.0.1:4317" } };
      },
      async closeTimelineSiteServer() {
        calls.push("server.close");
      },
      async launchBrowser() {
        return fakeBrowser as never;
      },
      async applyScreenshotControls() {},
      async waitForDashboardReady() {},
    }),
    /shot failed/u,
  );

  assert.deepEqual(calls, ["browser.close", "server.close"]);
});

test("captureTimelineScreenshot surfaces chrome-resolution failures after the site server is started and still cleans up", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-chrome-miss-"));
  const config = createRuntimeConfig(tempRoot);
  const calls: string[] = [];

  await assert.rejects(
    () => captureTimelineScreenshot(config, {
      selector: "main",
      outputFile: path.join(tempRoot, "main.png"),
    }, {
      async buildTimelineSite() {
        calls.push("buildSite");
      },
      async startTimelineSiteServer() {
        calls.push("startServer");
        return { server: { close() {} }, info: { url: "http://127.0.0.1:4317" } };
      },
      async closeTimelineSiteServer() {
        calls.push("server.close");
      },
      resolveChromeExecutablePath() {
        throw new Error("missing chrome");
      },
      async launchBrowser(runtimeConfig: Record<string, unknown>, resolveChromePath: (config: Record<string, unknown>) => string) {
        calls.push("launchBrowser");
        resolveChromePath(runtimeConfig);
        throw new Error("unreachable");
      },
    }),
    /missing chrome/u,
  );

  assert.deepEqual(calls, ["buildSite", "startServer", "launchBrowser", "server.close"]);
});

test("resolveTimelineScreenshotOptions rejects conflicting detail and subcategory filters", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-shot-options-"));
  const config = createRuntimeConfig(tempRoot);

  assert.throws(
    () => resolveTimelineScreenshotOptions(config, {
      detail: "编码",
      subcategory: "读书",
    }),
    /detail 和 subcategory 不能同时传不同值/u,
  );
});
