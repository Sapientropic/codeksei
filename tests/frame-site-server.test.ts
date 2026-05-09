const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const { resolveFrameRuntimeConfig }: typeof import("../src/frame/runtime-config") = require("../src/frame/runtime-config");
const { buildFrameSite }: typeof import("../src/frame/runtime/application/frame/build-site") = require("../src/frame/runtime/application/frame/build-site");
const { startFrameSiteServer }: typeof import("../src/frame/runtime/application/frame/serve-site") = require("../src/frame/runtime/application/frame/serve-site");
const { closeFrameSiteServer }: typeof import("../src/frame/runtime/infra/frame/frame-site-server") = require("../src/frame/runtime/infra/frame/frame-site-server");

test("frame build copies the static site and assets into state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-frame-build-"));
  const config = resolveFrameRuntimeConfig({ stateDir: tempRoot });

  const result = buildFrameSite(config);

  assert.equal(result.siteDir, config.frameSiteDir);
  assert.equal(fs.existsSync(path.join(config.frameSiteDir, "index.html")), true);
  assert.equal(fs.existsSync(path.join(config.frameAssetsDir, "character.png")), true);
  assert.equal(fs.existsSync(path.join(config.frameAssetsDir, "character_day.png")), true);
  assert.equal(fs.existsSync(path.join(config.frameAssetsDir, "fonts", "cormorant-latin-400-normal.woff2")), true);
  assert.equal(fs.existsSync(path.join(config.frameAssetsDir, "fonts", "inter-latin-400-normal.woff2")), true);
});

test("frame server serves page state and write endpoints without fake success", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-frame-server-"));
  const diaryDir = path.join(tempRoot, "diary");
  const config = {
    ...resolveFrameRuntimeConfig({ stateDir: tempRoot }),
    checkinConfigFile: path.join(tempRoot, "checkin-config.json"),
    checkinScheduleStateFile: path.join(tempRoot, "checkin-schedule-state.json"),
    diaryDir,
    reminderQueueFile: path.join(tempRoot, "reminder-queue.json"),
    stateDir: tempRoot,
    timezone: "Asia/Shanghai",
    workspaceRoot: tempRoot,
  };
  const { server, info } = await startFrameSiteServer(config, { port: 0 });

  try {
    const page = await fetch(info.url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Codeksei Frame/u);
    assert.doesNotMatch(html, /fonts\.googleapis/u);
    assert.doesNotMatch(html, /fonts\.gstatic/u);
    assert.doesNotMatch(html, /chinese-font\.netlify/u);
    assert.doesNotMatch(html, /user-scalable=no/u);
    assert.doesNotMatch(html, /innerHTML/u);
    assert.match(html, /freshnessLine/u);
    assert.match(html, /actionAvailability/u);
    assert.doesNotMatch(html, /\.timeline-slot\s+\.slot-label\s*\{[^}]*display:\s*none/su);
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/gu)) {
      assert.doesNotThrow(() => new Function(match[1] || ""));
    }

    const state = await fetch(`${info.url}/state`);
    assert.equal(state.status, 200);
    const stateJson = await state.json() as {
      actionAvailability?: {
        checkinActions?: { available?: boolean; reason?: string };
        reminderActions?: { available?: boolean; reason?: string };
      };
      diary?: { fragments?: unknown[] };
      freshness?: { stale?: boolean; warnings?: string[] };
    };
    assert.deepEqual(stateJson.diary?.fragments, []);
    assert.equal(stateJson.actionAvailability?.reminderActions?.available, false);
    assert.equal(stateJson.actionAvailability?.checkinActions?.available, false);
    assert.match(stateJson.actionAvailability?.reminderActions?.reason || "", /not wired/u);
    assert.equal(stateJson.freshness?.stale, true);

    const write = await fetch(`${info.url}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "<script>alert(1)</script>" }),
    });
    assert.equal(write.status, 200);
    assert.equal(fs.readdirSync(diaryDir).some((entry) => entry.endsWith(".md")), true);

    const reminder = await fetch(`${info.url}/reminder/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "missing", action: "settle" }),
    });
    assert.equal(reminder.status, 501);
    const reminderJson = await reminder.json() as { ok?: boolean };
    assert.equal(reminderJson.ok, false);
  } finally {
    await closeFrameSiteServer(server);
  }
});
