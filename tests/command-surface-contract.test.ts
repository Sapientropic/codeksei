const test = require("node:test");
const assert = require("node:assert/strict");
const packageJson = require("../package.json");
const {
  buildNodeRuntimeInvocation,
  resolveRuntimeEntrypoint,
} = require("../src/contracts/runtime-entrypoints");

const {
  findTerminalManifestByScriptName,
  listCommandActions,
  findTerminalCommandManifest,
  listCommandGroups,
  listTerminalCommandManifest,
} = require("../src/contracts/command-surface");
const {
  COMMAND_ACTION_DEFINITIONS,
  COMMAND_AUDIENCE_OVERRIDES,
  COMMAND_AUTH_OVERRIDES,
  COMMAND_MUTABILITY_OVERRIDES,
  COMMAND_SAFETY_OVERRIDES,
  resolveCommandAudienceDefinition,
  resolveCommandAuthRequirementDefinition,
  resolveCommandMutabilityDefinition,
  resolveCommandSafetyTierDefinition,
} = require("../src/contracts/command-surface-definitions");
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
  const keys = manifest.map((entry: { key: string }) => entry.key);
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
    .flatMap((group: { actions: Array<{ action: string; terminal: string[]; weixin: string[] }> }) => group.actions)
    .find((action: { action: string; terminal: string[]; weixin: string[] }) => action.action === "app.help");

  assert.ok(helpAction);
  assert.deepEqual(helpAction.terminal, ["help"]);
  assert.deepEqual(helpAction.weixin, ["/help"]);
});

test("active terminal actions all point at real package scripts", () => {
  const scripts = (packageJson.scripts || {}) as Record<string, unknown>;
  const missing = listCommandActions()
    .filter((action: { status: string; terminal: string[]; scriptName?: string }) => action.status === "active" && action.terminal.length && action.scriptName)
    .map((action: { scriptName?: string }) => action.scriptName as string)
    .filter((scriptName: string) => !(scriptName in scripts));

  assert.deepEqual(missing, []);
});

test("package scripts keep runtime entrypoints aligned with the published-runtime contract", () => {
  const scripts = (packageJson.scripts || {}) as Record<string, unknown>;
  assert.equal(packageJson.main, resolveRuntimeEntrypoint("cli"));
  assert.equal(packageJson.bin.codeksei, resolveRuntimeEntrypoint("cli"));

  const expectedScripts: Record<string, string> = {
    start: buildNodeRuntimeInvocation("cli", ["start"]),
    "start:checkin": buildNodeRuntimeInvocation("cli", ["start", "--checkin"]),
    login: buildNodeRuntimeInvocation("cli", ["login"]),
    accounts: buildNodeRuntimeInvocation("cli", ["accounts"]),
    doctor: buildNodeRuntimeInvocation("cli", ["doctor"]),
    help: buildNodeRuntimeInvocation("cli", ["help"]),
    "shared:start": buildNodeRuntimeInvocation("sharedStart"),
    "shared:open": buildNodeRuntimeInvocation("sharedOpen"),
    "shared:status": buildNodeRuntimeInvocation("sharedStatus"),
    "shared:supervisor": buildNodeRuntimeInvocation("sharedSupervisor"),
    "shared:watchdog": buildNodeRuntimeInvocation("sharedWatchdog"),
    "channel:send-file": buildNodeRuntimeInvocation("cli", ["channel", "send-file"]),
    "note:auto": buildNodeRuntimeInvocation("cli", ["note", "auto"]),
    "note:maybe": buildNodeRuntimeInvocation("cli", ["note", "maybe"]),
    "note:sync": buildNodeRuntimeInvocation("cli", ["note", "sync"]),
    "project:radar": buildNodeRuntimeInvocation("cli", ["project", "radar"]),
    "review:nightly": buildNodeRuntimeInvocation("cli", ["review", "nightly"]),
    "review:weekly": buildNodeRuntimeInvocation("cli", ["review", "weekly"]),
    "review:monthly": buildNodeRuntimeInvocation("cli", ["review", "monthly"]),
    "reminder:write": buildNodeRuntimeInvocation("cli", ["reminder", "write"]),
    "diary:write": buildNodeRuntimeInvocation("cli", ["diary", "write"]),
    "system:send": buildNodeRuntimeInvocation("cli", ["system", "send"]),
    "system:checkin": buildNodeRuntimeInvocation("cli", ["system", "checkin-poller"]),
    "timeline:event": buildNodeRuntimeInvocation("cli", ["timeline", "event"]),
    "timeline:write": buildNodeRuntimeInvocation("cli", ["timeline", "write"]),
    "timeline:read": buildNodeRuntimeInvocation("cli", ["timeline", "read"]),
    "timeline:categories": buildNodeRuntimeInvocation("cli", ["timeline", "categories"]),
    "timeline:proposals": buildNodeRuntimeInvocation("cli", ["timeline", "proposals"]),
    "timeline:build": buildNodeRuntimeInvocation("cli", ["timeline", "build"]),
    "timeline:serve": buildNodeRuntimeInvocation("cli", ["timeline", "serve"]),
    "timeline:dev": buildNodeRuntimeInvocation("cli", ["timeline", "dev"]),
    "timeline:screenshot": buildNodeRuntimeInvocation("cli", ["timeline", "screenshot"]),
    "smoke:shared:real:attach": buildNodeRuntimeInvocation("maintainerLiveSmoke", ["attach"]),
    "smoke:shared:real:reply": buildNodeRuntimeInvocation("maintainerLiveSmoke", ["reply"]),
    "smoke:shared:real:approval": buildNodeRuntimeInvocation("maintainerLiveSmoke", ["approval"]),
  };

  for (const [scriptName, expectedCommand] of Object.entries(expectedScripts)) {
    assert.equal(scripts[scriptName], expectedCommand, `${scriptName} should stay aligned with runtime-entrypoints.ts`);
  }
});

test("public CLI help topics stay aligned with the manifest help topics", () => {
  const manifestTopics = Array.from(new Set(
    listTerminalCommandManifest()
      .map((entry: { helpTopic?: string }) => entry.helpTopic)
      .filter((topic: string) => topic)
  )).sort();

  assert.deepEqual(listTerminalHelpTopics(), manifestTopics);
  for (const topic of manifestTopics) {
    assert.match(buildTerminalTopicHelp(topic), /\S/u);
  }
});

test("leaf-help actions all resolve to non-empty leaf help text", () => {
  const actionsById = new Map<string, { action: string; help?: { detail?: string } }>(
    listCommandActions().map((action: { action: string; help?: { detail?: string } }) => [action.action, action])
  );

  assert.deepEqual(
    listTerminalLeafHelpKeys().sort(),
    listCommandActions()
      .filter((action: { help?: { detail?: string; leafKey?: string } }) => action.help?.detail === "leaf")
      .map((action: { help?: { leafKey?: string } }) => action.help?.leafKey || "")
      .sort()
  );

  for (const leafKey of listTerminalLeafHelpKeys()) {
    assert.match(buildTerminalLeafHelp(leafKey), /\S/u);
    assert.equal(actionsById.get(leafKey)?.help?.detail, "leaf");
  }
});

test("command classification helpers cover representative explicit and default branches", () => {
  assert.equal(resolveCommandAudienceDefinition("app.shared_start", "script"), "operator");
  assert.equal(resolveCommandAudienceDefinition("timeline.build", "cli"), "public");
  assert.equal(resolveCommandAuthRequirementDefinition("timeline.screenshot"), "context_token");
  assert.equal(resolveCommandAuthRequirementDefinition("timeline.build"), "none");
  assert.equal(resolveCommandMutabilityDefinition("background.install"), "bootstrap");
  assert.equal(resolveCommandMutabilityDefinition("app.help"), "read");
  assert.equal(resolveCommandSafetyTierDefinition("timeline.write"), "warned");
  assert.equal(resolveCommandSafetyTierDefinition("app.schema"), "open");
});

test("every command action resolves through either an explicit classification override or the documented default", () => {
  const audienceOverrideIds = new Set(Object.keys(COMMAND_AUDIENCE_OVERRIDES));
  const authOverrideIds = new Set(Object.keys(COMMAND_AUTH_OVERRIDES));
  const mutabilityOverrideIds = new Set(Object.keys(COMMAND_MUTABILITY_OVERRIDES));
  const safetyOverrideIds = new Set(Object.keys(COMMAND_SAFETY_OVERRIDES));

  for (const action of COMMAND_ACTION_DEFINITIONS) {
    const expectedAudienceDefault = action.entrypointType === "script" ? "operator" : "public";
    const resolvedAudience = resolveCommandAudienceDefinition(action.action, action.entrypointType);
    if (!audienceOverrideIds.has(action.action)) {
      assert.equal(resolvedAudience, expectedAudienceDefault, `${action.action} should follow the documented audience default`);
    }

    const resolvedAuth = resolveCommandAuthRequirementDefinition(action.action);
    if (!authOverrideIds.has(action.action)) {
      assert.equal(resolvedAuth, "none", `${action.action} should use the default auth requirement when not overridden`);
    }

    const resolvedMutability = resolveCommandMutabilityDefinition(action.action);
    if (!mutabilityOverrideIds.has(action.action)) {
      assert.equal(resolvedMutability, "read", `${action.action} should use the default mutability when not overridden`);
    }

    const resolvedSafety = resolveCommandSafetyTierDefinition(action.action);
    if (!safetyOverrideIds.has(action.action)) {
      assert.equal(resolvedSafety, "open", `${action.action} should use the default safety tier when not overridden`);
    }
  }
});
