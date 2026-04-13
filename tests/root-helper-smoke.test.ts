const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function readScript(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("root shell helpers point at dist runtime entrypoints and keep key args", () => {
  const startSharedWechat = readScript("scripts/start_shared_wechat.sh");
  const openSharedWechat = readScript("scripts/open_shared_wechat_thread.sh");
  const timelineScreenshot = readScript("scripts/timeline-screenshot.sh");
  const distStartPattern = /dist\\?\/src\\?\/index\\?\.js start --checkin/u;

  assert.match(startSharedWechat, distStartPattern);
  assert.match(startSharedWechat, /node \.\/dist\/src\/index\.js start --checkin &/u);
  assert.match(openSharedWechat, distStartPattern);
  assert.match(timelineScreenshot, /exec node \.\/dist\/src\/index\.js timeline screenshot "\$\{ARGS\[@\]\}"/u);
});

test("root PowerShell runner points at dist shared helpers and preserves interval forwarding", () => {
  const sharedTaskRunner = readScript("scripts/shared-task-runner.ps1");

  assert.match(sharedTaskRunner, /dist\\src\\shared\\shared-start\.js/u);
  assert.match(sharedTaskRunner, /dist\\src\\shared\\shared-supervisor\.js/u);
  assert.match(sharedTaskRunner, /dist\\src\\shared\\shared-watchdog\.js/u);
  assert.match(sharedTaskRunner, /--interval-minutes=\$IntervalMinutes/u);
});

test("root helper scripts no longer execute deleted repo-root JS wrappers", () => {
  const helperFiles = [
    "scripts/open_shared_wechat_thread.sh",
    "scripts/open_wechat_thread.sh",
    "scripts/show_shared_status.sh",
    "scripts/start_shared_app_server.sh",
    "scripts/start_shared_wechat.sh",
    "scripts/timeline-screenshot.sh",
    "scripts/install-background-tasks.ps1",
    "scripts/shared-task-runner.ps1",
    "scripts/uninstall-background-tasks.ps1",
  ];

  const legacyWrapperPattern = /bin\/codeksei\.js|scripts\/shared-(?:start|open|status|supervisor|watchdog)\.js/u;
  for (const relativePath of helperFiles) {
    const source = readScript(relativePath);
    assert.doesNotMatch(source, legacyWrapperPattern, `${relativePath} should not execute deleted JS wrappers`);
  }
});

test("dist runtime entrypoint executes main when invoked directly", () => {
  const entrypoint = path.join(__dirname, "..", "dist", "src", "index.js");
  const result = spawnSync(process.execPath, [entrypoint, "help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || "expected help command to succeed");
  assert.match(result.stdout, /用法: codeksei <command> \[subcommand\]/u);
});

test("help entrypoints stay read-only and do not create the state dir", () => {
  const entrypoint = path.join(__dirname, "..", "dist", "src", "index.js");
  const stateDir = path.join(fs.mkdtempSync(path.join(require("node:os").tmpdir(), "codeksei-help-root-")), "state");
  const env = { ...process.env, CODEKSEI_STATE_DIR: stateDir };

  const rootHelp = spawnSync(process.execPath, [entrypoint, "help"], {
    encoding: "utf8",
    env,
  });
  const leafHelp = spawnSync(process.execPath, [entrypoint, "review", "weekly", "--help"], {
    encoding: "utf8",
    env,
  });
  const timelineServeHelp = spawnSync(process.execPath, [entrypoint, "timeline", "serve", "--help"], {
    encoding: "utf8",
    env,
  });
  const timelineDevHelp = spawnSync(process.execPath, [entrypoint, "timeline", "dev", "--help"], {
    encoding: "utf8",
    env,
  });
  const topicHelp = spawnSync(process.execPath, [entrypoint, "timeline", "--help"], {
    encoding: "utf8",
    env,
  });

  assert.equal(rootHelp.status, 0, rootHelp.stderr || "expected root help to succeed");
  assert.equal(leafHelp.status, 0, leafHelp.stderr || "expected leaf help to succeed");
  assert.equal(timelineServeHelp.status, 0, timelineServeHelp.stderr || "expected timeline serve help to succeed");
  assert.equal(timelineDevHelp.status, 0, timelineDevHelp.stderr || "expected timeline dev help to succeed");
  assert.equal(topicHelp.status, 0, topicHelp.stderr || "expected topic help to succeed");
  assert.match(timelineServeHelp.stdout, /codeksei timeline serve \[--port 4317\]/u);
  assert.match(timelineDevHelp.stdout, /codeksei timeline dev \[--port 4317\]/u);
  assert.equal(fs.existsSync(stateDir), false);
});
