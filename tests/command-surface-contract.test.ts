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
const {
  listTerminalHelpTopics,
  listTerminalLeafHelpKeys,
} = require("../src/contracts/command-help-contract");
const {
  buildTerminalLeafHelp,
  buildTerminalTopicHelp,
} = require("../src/core/command-registry");

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
  assert.equal(findTerminalCommandManifest(" NOTE ", " AUTO ")?.action, "note.auto");
  assert.equal(findTerminalManifestByScriptName(" Note:Auto ")?.action, "note.auto");
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

test("public CLI help topics stay aligned with the manifest help topics", () => {
  const manifestTopics = Array.from(new Set(
    listTerminalCommandManifest()
      .map((entry: any) => entry.helpTopic)
      .filter((topic: string) => topic)
  )).sort();

  assert.deepEqual(listTerminalHelpTopics(), manifestTopics);
  for (const topic of manifestTopics) {
    assert.match(buildTerminalTopicHelp(topic), /\S/u);
  }
});

test("leaf-help actions all resolve to non-empty leaf help text", () => {
  const actionsById = new Map<string, any>(
    listCommandActions().map((action: any) => [action.action, action])
  );

  assert.deepEqual(
    listTerminalLeafHelpKeys().sort(),
    listCommandActions()
      .filter((action: any) => action.help?.detail === "leaf")
      .map((action: any) => action.help.leafKey)
      .sort()
  );

  for (const leafKey of listTerminalLeafHelpKeys()) {
    assert.match(buildTerminalLeafHelp(leafKey), /\S/u);
    assert.equal(actionsById.get(leafKey)?.help?.detail, "leaf");
  }
});
