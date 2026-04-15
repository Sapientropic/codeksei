const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTerminalActionExample,
  buildTerminalEntryUsage,
} = require("../src/core/terminal-command-usage");

const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
const readmeEn = fs.readFileSync(path.join(__dirname, "..", "README.en.md"), "utf8");
const commandsDoc = fs.readFileSync(path.join(__dirname, "..", "docs", "commands.md"), "utf8");
const timelineIntegrationDoc = fs.readFileSync(path.join(__dirname, "..", "docs", "timeline-integration.md"), "utf8");

const readmeDocs: Array<{ name: string; content: string; modeHeading: string }> = [
  {
    name: "README.md",
    content: readme,
    modeHeading: "## 模式化拉起",
  },
  {
    name: "README.en.md",
    content: readmeEn,
    modeHeading: "## Mode-Specific Bring-Up",
  },
];

function assertSharedReadmeCliContract(doc: string, name: string) {
  assert.ok(doc.includes(buildTerminalEntryUsage("app.help", "public")), `${name} should mention public help discovery`);
  assert.ok(doc.includes("codeksei review weekly --help"), `${name} should mention review weekly help`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.manifest", "public")), `${name} should mention host manifest`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.bootstrap", "public")), `${name} should mention host bootstrap`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.doctor", "public")), `${name} should mention host doctor`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.smoke", "public")), `${name} should mention host smoke`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.seed_proactive", "public")), `${name} should mention host seed-proactive`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.claim_checkin", "public")), `${name} should mention host claim-checkin`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.settle_checkin", "public")), `${name} should mention host settle-checkin`);
  assert.ok(doc.includes("codeksei system checkin-trigger"), `${name} should mention checkin-trigger`);
  assert.ok(doc.includes("codeksei system checkin-complete"), `${name} should mention checkin-complete`);
  assert.ok(doc.includes("codeksei operator hermes sync-checkin"), `${name} should mention hermes sync-checkin`);
  assert.ok(doc.includes(buildTerminalEntryUsage("app.shared_start", "repo")), `${name} should keep repo shared:start`);
  assert.ok(doc.includes("./docs/timeline-integration.md"), `${name} should link timeline integration docs`);
  assert.ok(doc.includes("CODEKSEI_TIMELINE_LOCALE"), `${name} should mention timeline locale`);
}

function assertAgentNativeAnchors(doc: string, name: string, modeHeading: string) {
  assert.ok(doc.includes("CODEKSEI_HOSTKIT.json"), `${name} should mention CODEKSEI_HOSTKIT.json`);
  assert.ok(doc.includes("Node.js >= 22"), `${name} should mention Node.js >= 22`);
  assert.ok(doc.includes("## SETUP"), `${name} should contain a dedicated SETUP section`);
  assert.ok(doc.includes(modeHeading), `${name} should contain a mode-specific bring-up section`);
  assert.ok(doc.includes("### Bridge Mode"), `${name} should contain Bridge Mode bring-up`);
  assert.ok(doc.includes("### Hermes Hosted Mode"), `${name} should contain Hermes Hosted Mode bring-up`);
}

test("README docs keep bilingual public discovery aligned while shared mode stays on repo scripts", () => {
  for (const { name, content } of readmeDocs) {
    assertSharedReadmeCliContract(content, name);
  }
});

test("README docs keep bilingual agent-native setup anchors aligned", () => {
  for (const { name, content, modeHeading } of readmeDocs) {
    assertAgentNativeAnchors(content, name, modeHeading);
  }
});

test("docs/commands keeps public CLI examples aligned with the terminal usage source", () => {
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("app.login", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.manifest", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.bootstrap", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.doctor", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.claim_checkin", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.settle_checkin", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("timeline.event", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("system.checkin_trigger", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("system.checkin_tick", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("system.checkin_complete", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("operator.hermes.sync_checkin", "public")));
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
