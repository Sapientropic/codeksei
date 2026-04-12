const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveTerminalCommandManifest } = require("../src/index");

test("root command flags do not masquerade as subcommands", () => {
  assert.equal(resolveTerminalCommandManifest("start", "--checkin")?.action, "app.start");
  assert.equal(resolveTerminalCommandManifest("doctor", "--json")?.action, "app.doctor");
});
