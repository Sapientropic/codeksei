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
  assert.ok(doc.includes(buildTerminalEntryUsage("companion.remember", "public")), `${name} should mention companion remember`);
  assert.ok(doc.includes(buildTerminalEntryUsage("context.briefing", "public")), `${name} should mention context briefing`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.seed_proactive", "public")), `${name} should mention host seed-proactive`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.claim_checkin", "public")), `${name} should mention host claim-checkin`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.settle_checkin", "public")), `${name} should mention host settle-checkin`);
  assert.ok(doc.includes(buildTerminalEntryUsage("host.finalize_checkin", "public")), `${name} should mention host finalize-checkin`);
  assert.ok(doc.includes("codeksei system checkin-trigger"), `${name} should mention checkin-trigger`);
  assert.ok(doc.includes("codeksei system checkin-complete"), `${name} should mention checkin-complete`);
  assert.ok(doc.includes(buildTerminalEntryUsage("app.shared_start", "repo")), `${name} should keep repo shared:start`);
  assert.ok(doc.includes("./docs/timeline-integration.md"), `${name} should link timeline integration docs`);
  assert.ok(doc.includes("CODEKSEI_TIMELINE_LOCALE"), `${name} should mention timeline locale`);
}

function assertAgentNativeAnchors(doc: string, name: string, modeHeading: string) {
  assert.ok(doc.includes("CODEKSEI_HOSTKIT.json"), `${name} should mention CODEKSEI_HOSTKIT.json`);
  assert.ok(doc.includes("Node.js >= 22"), `${name} should mention Node.js >= 22`);
  assert.ok(doc.includes("## SETUP"), `${name} should contain a dedicated SETUP section`);
  assert.ok(doc.includes(modeHeading), `${name} should contain a mode-specific bring-up section`);
  assert.ok(doc.includes("### Codex Mode"), `${name} should contain Codex Mode bring-up`);
  assert.ok(doc.includes("### Hosted Mode"), `${name} should contain Hosted Mode bring-up`);
}

test("README docs keep bilingual public discovery aligned while shared mode stays on repo scripts", () => {
  for (const { name, content } of readmeDocs) {
    assertSharedReadmeCliContract(content, name);
  }
  assert.ok(readme.includes("## Agent 安装后的第一天闭环"));
  assert.ok(readme.includes("用户不需要学习这些命令"));
  assert.ok(readme.includes("codeksei onboarding status --user <id>"));
  assert.ok(readme.includes("codeksei context inspect --user <id> --workspace <path>"));
  assert.ok(readme.includes("codeksei pulse today --user <id> --workspace <path>"));
  assert.ok(readme.includes("codeksei frame serve"));
  assert.ok(readme.includes("codeksei review nightly"));
  assert.ok(readmeEn.includes("## First Day Agent Loop"));
  assert.ok(readmeEn.includes("The user does not need to learn these commands"));
  assert.ok(readmeEn.includes("codeksei onboarding status --user <id>"));
  assert.ok(readmeEn.includes("codeksei context inspect --user <id> --workspace <path>"));
  assert.ok(readmeEn.includes("codeksei pulse today --user <id> --workspace <path>"));
  assert.ok(readmeEn.includes("codeksei frame serve"));
  assert.ok(readmeEn.includes("codeksei review nightly"));
});

test("README docs keep bilingual agent-native setup anchors aligned", () => {
  for (const { name, content, modeHeading } of readmeDocs) {
    assertAgentNativeAnchors(content, name, modeHeading);
  }
});

test("docs/commands keeps public CLI examples aligned with the terminal usage source", () => {
  assert.ok(commandsDoc.includes("## Agent 服务路径导航"));
  assert.ok(commandsDoc.includes("这不是给终端用户背命令的清单"));
  assert.ok(commandsDoc.includes("激活："));
  assert.ok(commandsDoc.includes("记录："));
  assert.ok(commandsDoc.includes("继续："));
  assert.ok(commandsDoc.includes("收口："));
  assert.ok(commandsDoc.includes("接入："));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("app.login", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.manifest", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.bootstrap", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.doctor", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("companion.remember", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("context.briefing", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.claim_checkin", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.finalize_checkin", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("host.settle_checkin", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("timeline.event", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("system.checkin_trigger", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("system.checkin_tick", "public")));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("system.checkin_complete", "public")));
  assert.ok(commandsDoc.includes(buildTerminalActionExample("review.weekly", { audience: "public", includeArgs: false })));
  assert.ok(commandsDoc.includes(buildTerminalEntryUsage("app.shared_status", "repo")));
  assert.ok(commandsDoc.includes("./timeline-integration.md"));
  assert.doesNotMatch(commandsDoc, /sync-checkin/u);
  assert.doesNotMatch(commandsDoc, /--delivery proactive/u);
  assert.doesNotMatch(commandsDoc, /--ensure-daemon/u);
  assert.doesNotMatch(commandsDoc, /--sleep-for 6h/u);
});

test("public docs remove fixed 6h anchors and stale proactive/bootstrap compatibility flags", () => {
  for (const { name, content } of readmeDocs) {
    assert.doesNotMatch(content, /--sleep-for 6h/u, `${name} should not anchor hosted checkins to 6h`);
    assert.doesNotMatch(content, /delivery proactive/u, `${name} should not mention removed proactive reminder flag`);
    assert.doesNotMatch(content, /sync-checkin/u, `${name} should not mention removed sync-checkin surface`);
    assert.doesNotMatch(content, /--ensure-daemon/u, `${name} should not mention removed ensure-daemon flag`);
  }
});

test("timeline integration doc is the canonical deep-dive for timeline support and agent routing", () => {
  assert.match(timelineIntegrationDoc, /Windows、macOS、Linux 都可跑 timeline CLI/u);
  assert.match(timelineIntegrationDoc, /Node\.js >= 22/u);
  assert.match(timelineIntegrationDoc, /CODEKSEI_TIMELINE_LOCALE=zh-CN\|en/u);
  assert.match(timelineIntegrationDoc, /categories.*read.*event.*write.*build.*serve.*dev.*screenshot/us);
  assert.match(timelineIntegrationDoc, /未来 MCP .*复用 `src\/timeline\/runtime\/application\/timeline/u);
});
