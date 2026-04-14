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
const timelineIntegrationDoc = fs.readFileSync(path.join(__dirname, "..", "docs", "timeline-integration.md"), "utf8");

test("README public quickstart prefers codeksei CLI while shared mode keeps repo scripts", () => {
  assert.ok(readme.includes(buildTerminalEntryUsage("app.help", "public")));
  assert.ok(readme.includes("codeksei review weekly --help"));
  assert.ok(readme.includes("codeksei system checkin-trigger"));
  assert.ok(readme.includes("codeksei system checkin-complete"));
  assert.ok(readme.includes(buildTerminalEntryUsage("app.shared_start", "repo")));
  assert.ok(readme.includes("./docs/timeline-integration.md"));
  assert.ok(readme.includes("CODEKSEI_TIMELINE_LOCALE"));
});

test("docs/commands keeps public CLI examples aligned with the terminal usage source", () => {
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("app.login", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("timeline.event", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("system.checkin_trigger", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("system.checkin_tick", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("system.checkin_complete", "public")));
  assert.ok(commandsDoc.includes(buildTerminalActionExample("review.weekly", { audience: "public", includeArgs: false })));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("app.shared_status", "repo")));
  assert.ok(commandsDoc.includes("./timeline-integration.md"));
});

test("timeline integration doc is the canonical deep-dive for timeline support and agent routing", () => {
  assert.match(timelineIntegrationDoc, /Windows、macOS、Linux 都可跑 timeline CLI/u);
  assert.match(timelineIntegrationDoc, /Node\.js >= 22/u);
  assert.match(timelineIntegrationDoc, /CODEKSEI_TIMELINE_LOCALE=zh-CN\|en/u);
  assert.match(timelineIntegrationDoc, /categories.*read.*event.*write.*build.*serve.*dev.*screenshot/us);
  assert.match(timelineIntegrationDoc, /未来 MCP .*复用 `src\/timeline\/runtime\/application\/timeline/u);
});
