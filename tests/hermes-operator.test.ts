const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  runHermesInstallSkillCommand,
  runHermesSmokeCommand,
  runHermesStatusCommand,
} = require("../src/app/hermes-operator-cli");
const { createFakeHermesCommand } = require("./helpers/fake-hermes-command.ts");

test("operator hermes install-skill installs and syncs the companion skill", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-install-"));
  const hermesHome = path.join(tempRoot, ".hermes");

  const result = await runHermesInstallSkillCommand({
    hermesHome,
    runtime: "hermes",
    channelProvider: "hermes",
  });

  assert.equal(result.data.installedSkill.exists, true);
  assert.equal(result.data.installedSkill.inSync, true);
  assert.equal(fs.existsSync(result.data.installedPath), true);
});

test("operator hermes install-skill dry-run previews side effects without writing files", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-install-dry-run-"));
  const hermesHome = path.join(tempRoot, ".hermes");

  const result = await runHermesInstallSkillCommand({
    hermesHome,
    runtime: "hermes",
    channelProvider: "hermes",
  }, ["--dry-run"]);

  assert.equal(result.meta.dryRun, true);
  assert.equal(result.data.willWrite, true);
  assert.equal(fs.existsSync(path.join(hermesHome, "skills", "codeksei-companion", "SKILL.md")), false);
});

test("operator hermes status reports catalog and semantic availability", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-status-"));
  const hermesHome = path.join(tempRoot, ".hermes");
  const accountsDir = path.join(hermesHome, "weixin", "accounts");
  fs.mkdirSync(accountsDir, { recursive: true });
  fs.writeFileSync(path.join(accountsDir, "acct-1.json"), JSON.stringify({ accountId: "acct-1" }), "utf8");

  const { commandPath } = createFakeHermesCommand(tempRoot);
  await runHermesInstallSkillCommand({
    hermesHome,
    runtime: "hermes",
    channelProvider: "hermes",
  });

  const result = await runHermesStatusCommand({
    hermesHome,
    hermesCommand: commandPath,
    reviewSemanticHost: "hermes",
    runtime: "hermes",
    channelProvider: "hermes",
    workspaceRoot: tempRoot,
  });

  assert.equal(result.data.hostProfile.profile, "hosted-hermes-weixin");
  assert.equal(result.data.hermes.installedSkill.inSync, true);
  assert.equal(result.data.skillCatalog.listed, true);
  assert.equal(result.data.hermes.semanticReview.available, true);
});

test("operator hermes smoke returns partial when hosted prerequisites are missing", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-smoke-"));
  const result = await runHermesSmokeCommand({
    hermesHome: path.join(tempRoot, ".hermes"),
    runtime: "hermes",
    channelProvider: "hermes",
  });

  assert.equal(result.ok, "partial");
  assert.equal(result.data.ok, false);
  assert.match(result.data.checks.weixinAccounts.reason, /Weixin/u);
});
