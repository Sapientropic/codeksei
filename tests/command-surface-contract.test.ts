const test = require("node:test");
const assert = require("node:assert/strict");
const packageJson = require("../package.json");

const {
  findTerminalManifestByScriptName,
  listCommandActions,
  findTerminalCommandManifest,
  listCommandGroups,
  listTerminalCommandManifest,
} = require("../src/contracts/command-surface");

test("terminal manifest declares unique command keys", () => {
  const manifest = listTerminalCommandManifest();
  const keys = manifest.map((entry: any) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("command surface can resolve routed terminal commands from a single manifest", () => {
  assert.equal(findTerminalCommandManifest("note", "auto")?.action, "note.auto");
  assert.equal(findTerminalCommandManifest("timeline", "screenshot")?.runner, "timeline.screenshot");
  assert.equal(findTerminalCommandManifest("review", "weekly")?.argsSchemaKey, "review");
  assert.equal(findTerminalManifestByScriptName("note:auto")?.action, "note.auto");
});

test("command surface groups still expose terminal and weixin help entries", () => {
  const groups = listCommandGroups();
  const helpAction = groups
    .flatMap((group: any) => group.actions)
    .find((action: any) => action.action === "app.help");

  assert.ok(helpAction);
  assert.deepEqual(helpAction.terminal, ["help"]);
  assert.deepEqual(helpAction.weixin, ["/help"]);
});

test("active terminal actions all point at real package scripts", () => {
  const scripts = (packageJson.scripts || {}) as Record<string, unknown>;
  const missing = listCommandActions()
    .filter((action: any) => action.status === "active" && action.terminal.length && action.scriptName)
    .map((action: any) => action.scriptName as string)
    .filter((scriptName: string) => !(scriptName in scripts));

  assert.deepEqual(missing, []);
});
