const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const { spawnSync }: typeof import("node:child_process") = require("node:child_process");

const repoRoot = path.join(__dirname, "..");
const timelineEntrypoint = path.join(repoRoot, "dist", "src", "timeline", "index.js");

interface TimelineCommandResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

test("first-party timeline runtime can build a static site from the published dist tree", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-build-"));
  const result = runTimelineCommand(["build"], {
    CODEKSEI_STATE_DIR: stateDir,
    CODEKSEI_TIMELINE_STATE_DIR: stateDir,
  });

  assert.equal(result.status, 0, result.stderr || "expected timeline build to succeed");
  assert.match(result.stdout, /timeline dashboard built:/u);
  assert.equal(fs.existsSync(path.join(stateDir, "timeline", "site", "index.html")), true);
  assert.equal(fs.existsSync(path.join(stateDir, "timeline", "site", "assets", "dashboard.js")), true);
  assert.equal(fs.existsSync(path.join(stateDir, "timeline", "site", "assets", "dashboard.css")), true);
  assert.equal(fs.existsSync(path.join(stateDir, "timeline", "site", "dashboard-data.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "dist", "src", "timeline", "examples", "demo-facts.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "dist", "src", "timeline", "runtime", "timeline", "css", "dashboard.css")), true);
});

test("first-party timeline runtime honors CODEKSEI_TIMELINE_LOCALE when building demo dashboard output", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-build-en-"));
  const result = runTimelineCommand(["build"], {
    CODEKSEI_STATE_DIR: stateDir,
    CODEKSEI_TIMELINE_LOCALE: "en",
    CODEKSEI_TIMELINE_STATE_DIR: stateDir,
  });

  assert.equal(result.status, 0, result.stderr || "expected english timeline build to succeed");
  const html = fs.readFileSync(path.join(stateDir, "timeline", "site", "index.html"), "utf8");
  const payload = JSON.parse(fs.readFileSync(path.join(stateDir, "timeline", "site", "dashboard-data.json"), "utf8"));
  assert.match(html, /<html lang="en">/u);
  assert.equal(payload.meta.locale, "en");
  assert.equal(payload.taxonomy.categories[0].label, "Life");
});

test("first-party timeline runtime still accepts legacy TIMELINE_FOR_AGENT_LOCALE for compatibility", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-build-legacy-locale-"));
  const result = runTimelineCommand(["build"], {
    CODEKSEI_STATE_DIR: stateDir,
    CODEKSEI_TIMELINE_STATE_DIR: stateDir,
    TIMELINE_FOR_AGENT_LOCALE: "en",
  });

  assert.equal(result.status, 0, result.stderr || "expected legacy-locale timeline build to succeed");
  const payload = JSON.parse(fs.readFileSync(path.join(stateDir, "timeline", "site", "dashboard-data.json"), "utf8"));
  assert.equal(payload.meta.locale, "en");
});

test("first-party timeline runtime covers categories, write, read, proposals, and screenshot help", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-timeline-roundtrip-"));
  const env = {
    CODEKSEI_STATE_DIR: stateDir,
    CODEKSEI_TIMELINE_STATE_DIR: stateDir,
  };

  const categoriesResult = runTimelineCommand(["categories"], env);
  assert.equal(categoriesResult.status, 0, categoriesResult.stderr || "expected categories to succeed");
  const categoriesPayload = JSON.parse(categoriesResult.stdout);
  const category = categoriesPayload.categories[0];
  const subcategory = category.children[0];
  assert.equal(typeof subcategory.id, "string");

  const newEventNodeId = "work.synthetic-check";
  const writePayload = JSON.stringify({
    date: "2026-04-05",
    newEventNodes: [
      {
        id: newEventNodeId,
        label: "Synthetic Check",
        parentId: subcategory.id,
      },
    ],
    events: [
      {
        id: "evt_roundtrip_1",
        startAt: "2026-04-05T09:00:00+08:00",
        endAt: "2026-04-05T09:30:00+08:00",
        title: "Roundtrip timeline write",
        eventNodeId: newEventNodeId,
      },
    ],
  });

  const writeResult = runTimelineCommand(["write", "--date", "2026-04-05", "--json", writePayload], env);
  assert.equal(writeResult.status, 0, writeResult.stderr || "expected write to succeed");
  assert.match(writeResult.stdout, /events: 1/u);

  const readResult = runTimelineCommand(["read", "--date", "2026-04-05"], env);
  assert.equal(readResult.status, 0, readResult.stderr || "expected read to succeed");
  const readPayload = JSON.parse(readResult.stdout);
  assert.equal(readPayload.exists, true);
  assert.equal(readPayload.eventCount, 1);
  assert.equal(readPayload.events[0].eventNodeId, newEventNodeId);

  const proposalsResult = runTimelineCommand(["proposals", "--date", "2026-04-05"], env);
  assert.equal(proposalsResult.status, 0, proposalsResult.stderr || "expected proposals to succeed");
  const proposalsPayload = JSON.parse(proposalsResult.stdout);
  assert.equal(proposalsPayload.proposalCount, 1);
  assert.equal(proposalsPayload.proposals[0].proposedNodeId, newEventNodeId);

  const screenshotHelp = runTimelineCommand(["screenshot", "--help"], env);
  assert.equal(screenshotHelp.status, 0, screenshotHelp.stderr || "expected screenshot help to succeed");
  assert.match(screenshotHelp.stdout, /codeksei timeline screenshot/u);
});

function runTimelineCommand(args: string[], extraEnv: Record<string, string>): TimelineCommandResult {
  const result = spawnSync(process.execPath, [timelineEntrypoint, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  return {
    status: result.status,
    stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? ""),
    stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? ""),
  };
}
