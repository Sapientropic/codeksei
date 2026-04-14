const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { resolveTerminalCommandManifest } = require("../src/index");

test("root command flags do not masquerade as subcommands", () => {
  assert.equal(resolveTerminalCommandManifest("start", "--checkin")?.action, "app.start");
  assert.equal(resolveTerminalCommandManifest("doctor", "--json")?.action, "app.doctor");
  assert.equal(resolveTerminalCommandManifest("system", "checkin")?.action, "system.checkin_config");
  assert.equal(resolveTerminalCommandManifest("system", "checkin-trigger")?.action, "system.checkin_trigger");
  assert.equal(resolveTerminalCommandManifest("system", "checkin-tick")?.action, "system.checkin_tick");
  assert.equal(resolveTerminalCommandManifest(["operator", "hermes", "install-skill", "--dry-run"])?.action, "operator.hermes.install_skill");
});
