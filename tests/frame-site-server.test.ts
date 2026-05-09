const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const { resolveFrameRuntimeConfig }: typeof import("../src/frame/runtime-config") = require("../src/frame/runtime-config");
const { buildFrameSite }: typeof import("../src/frame/runtime/application/frame/build-site") = require("../src/frame/runtime/application/frame/build-site");
const { startFrameSiteServer }: typeof import("../src/frame/runtime/application/frame/serve-site") = require("../src/frame/runtime/application/frame/serve-site");
const { closeFrameSiteServer }: typeof import("../src/frame/runtime/infra/frame/frame-site-server") = require("../src/frame/runtime/infra/frame/frame-site-server");
const { ReminderQueueStore }: typeof import("../src/state/reminder-queue-store") = require("../src/state/reminder-queue-store");
const { CheckinScheduleStateStore }: typeof import("../src/state/checkin-schedule-state-store") = require("../src/state/checkin-schedule-state-store");

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
  const reminderQueue = new ReminderQueueStore({ filePath: config.reminderQueueFile });
  reminderQueue.enqueue({
    id: "reminder-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text: "喝水",
    dueAtMs: Date.parse("2026-04-20T13:00:00.000Z"),
    createdAt: "2026-04-20T10:00:00.000Z",
  });
  new CheckinScheduleStateStore({ filePath: config.checkinScheduleStateFile }).setState({
    activeWake: null,
    lastCompletion: null,
    nextWakeAt: "",
    pendingHandoff: null,
    pendingTrigger: {
      createdAt: "2026-04-20T10:00:00.000Z",
      dueAt: "2026-04-20T13:00:00.000Z",
      kind: "checkin",
      senderId: "user-1",
      source: "checkin_trigger",
      text: "check in",
      triggerId: "trigger-1",
      workspaceRoot: tempRoot,
    },
    scheduleSource: "fallback",
    senderId: "user-1",
    targetKey: `user-1::${tempRoot}`,
    updatedAt: "2026-04-20T10:00:00.000Z",
    workspaceRoot: tempRoot,
  });

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
    assert.equal(stateJson.actionAvailability?.reminderActions?.available, true);
    assert.equal(stateJson.actionAvailability?.checkinActions?.available, true);
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
      body: JSON.stringify({ id: "reminder-1", action: "settle" }),
    });
    assert.equal(reminder.status, 200);
    const reminderJson = await reminder.json() as { ok?: boolean; data?: { removed?: { id?: string } } };
    assert.equal(reminderJson.ok, true);
    assert.equal(reminderJson.data?.removed?.id, "reminder-1");
    assert.deepEqual(new ReminderQueueStore({ filePath: config.reminderQueueFile }).state.reminders, []);

    const checkin = await fetch(`${info.url}/checkin/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "later", triggerId: "trigger-1" }),
    });
    assert.equal(checkin.status, 200);
    const checkinJson = await checkin.json() as { ok?: boolean; data?: { completion?: { triggerId?: string; result?: string } } };
    assert.equal(checkinJson.ok, true);
    assert.equal(checkinJson.data?.completion?.triggerId, "trigger-1");
    assert.equal(checkinJson.data?.completion?.result, "silent");
    const checkinState = new CheckinScheduleStateStore({ filePath: config.checkinScheduleStateFile }).getState();
    assert.equal(checkinState?.activeWake, null);
    assert.equal(checkinState?.pendingTrigger, null);
    assert.equal(checkinState?.lastCompletion?.triggerId, "trigger-1");

    new CheckinScheduleStateStore({ filePath: config.checkinScheduleStateFile }).setState({
      activeWake: null,
      lastCompletion: null,
      nextWakeAt: "",
      pendingHandoff: null,
      pendingTrigger: {
        createdAt: "2026-04-20T11:00:00.000Z",
        dueAt: "2026-04-20T14:00:00.000Z",
        kind: "checkin",
        senderId: "user-1",
        source: "checkin_trigger",
        text: "check in",
        triggerId: "trigger-2",
        workspaceRoot: tempRoot,
      },
      scheduleSource: "fallback",
      senderId: "user-1",
      targetKey: `user-1::${tempRoot}`,
      updatedAt: "2026-04-20T11:00:00.000Z",
      workspaceRoot: tempRoot,
    });
    const hereCheckin = await fetch(`${info.url}/checkin/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "here", triggerId: "trigger-2" }),
    });
    assert.equal(hereCheckin.status, 200);
    const hereJson = await hereCheckin.json() as { data?: { completion?: { result?: string } } };
    assert.equal(hereJson.data?.completion?.result, "backstage_only");
  } finally {
    await closeFrameSiteServer(server);
  }
});
