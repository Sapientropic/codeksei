const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTerminalActionExample,
  buildTerminalEntryUsage,
} = require("../src/core/terminal-command-usage");

const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
const commandsDoc = fs.readFileSync(path.join(__dirname, "..", "docs", "commands.md"), "utf8");

test("README public quickstart prefers codeksei CLI while shared mode keeps repo scripts", () => {
  assert.ok(readme.includes(buildTerminalEntryUsage("app.help", "public")));
  assert.ok(readme.includes("codeksei review weekly --help"));
  assert.ok(readme.includes(buildTerminalEntryUsage("app.shared_start", "repo")));
});

test("docs/commands keeps public CLI examples aligned with the terminal usage source", () => {
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("app.login", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("timeline.event", "public")));
  assert.ok(commandsDoc.includes(buildTerminalActionExample("review.weekly", { audience: "public", includeArgs: false })));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("app.shared_status", "repo")));
});
