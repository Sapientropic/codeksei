const test = require("node:test");
const assert = require("node:assert/strict");
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
