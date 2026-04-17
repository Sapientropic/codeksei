const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  collectHermesHostedDoctorReport,
  installHermesCompanionSkill,
  previewHermesCompanionSkillInstall,
  resolveRepoHermesSkillAssetPath,
  runHermesHostedSmoke,
} = require("../src/core/host-mode");
const {
  createFakeHermesRepoLocalFixture,
} = require("./helpers/fake-hermes-repo-local.ts");

test("repo exposes the official Hermes companion skill asset", () => {
  const skillPath = resolveRepoHermesSkillAssetPath();
  assert.equal(fs.existsSync(skillPath), true);
  const content = fs.readFileSync(skillPath, "utf8");
  assert.match(content, /codeksei timeline event/u);
  assert.match(content, /codeksei diary write/u);
  assert.match(content, /codeksei reminder write/u);
  assert.match(content, /Hosted Mode \/ Hermes recipe/u);
});

test("hosted Hermes doctor reports repo-local diagnostics and installed skill state", () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hosted-hermes-home-"));
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hosted-hermes-repo-local-"))
  );
  const config = {
    runtime: "hermes",
    channelProvider: "hermes",
    hermesHome,
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
  };

  installHermesCompanionSkill(config);
  const report = collectHermesHostedDoctorReport(config);

  assert.equal(report.available, false);
  assert.equal(report.repoLocal.ready, true);
  assert.equal(report.repoSkillAsset.exists, true);
  assert.equal(report.installedSkill.inSync, true);
  assert.equal(report.semanticReview.activeHost, "hermes");
});

test("skill preview/install and smoke keep hosted Hermes readiness explicit", () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hosted-hermes-home-"));
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hosted-hermes-repo-local-"))
  );
  const config = {
    runtime: "hermes",
    channelProvider: "hermes",
    hermesHome,
    hermesRepoRoot: repoLocal.repoRoot,
    hermesRepoLocalShimPath: repoLocal.shimPath,
  };

  const beforeInstall = previewHermesCompanionSkillInstall(config);
  assert.equal(beforeInstall.willCreate, true);

  const installResult = installHermesCompanionSkill(config);
  assert.equal(installResult.installedSkill.inSync, true);

  const smoke = runHermesHostedSmoke(config);
  assert.equal(smoke.hostProfile.profile, "hosted-mode");
  assert.equal(smoke.checks.repoLocal.ok, true);
  assert.equal(smoke.checks.installedSkill.ok, true);
  assert.equal(smoke.checks.hermesCommand.ok, false);
});
