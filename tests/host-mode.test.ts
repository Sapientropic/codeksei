const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { readConfig } = require("../src/core/config");
const { createTerminalAppFacade } = require("../src/core/app-terminal-facade");
const {
  resolveHostMode,
  resolveRepoHermesSkillAssetPath,
  installHermesCompanionSkill,
} = require("../src/core/host-mode");
const { main: runSharedStart } = require("../src/shared/shared-start");

function withPatchedEnv<T>(patch: Record<string, string>, fn: () => T): T {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, original, patch);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, original);
  }
}

async function withPatchedEnvAsync<T>(patch: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, original, patch);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, original);
  }
}

test("readConfig infers Hermes hosted mode from runtime", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hosted-config-"));
  const config = withPatchedEnv({
    CODEKSEI_STATE_DIR: stateDir,
    CODEKSEI_RUNTIME: "hermes",
  }, () => readConfig());

  assert.equal(config.runtime, "hermes");
  assert.equal(config.channelProvider, "hermes");

  const resolved = resolveHostMode(config);
  assert.equal(resolved.profile, "hosted-hermes-weixin");
  assert.equal(resolved.mode, "hosted");
  assert.equal(resolved.supported, true);
  assert.equal(resolved.capabilities.supportsHostedSkillInstall, true);
});

test("doctor reports host mode and hosted Hermes diagnostics", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hosted-doctor-"));
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hosted-hermes-home-"));
  const config = withPatchedEnv({
    CODEKSEI_STATE_DIR: stateDir,
    CODEKSEI_RUNTIME: "hermes",
    CODEKSEI_CHANNEL_PROVIDER: "hermes",
    CODEKSEI_HERMES_HOME: hermesHome,
  }, () => readConfig());

  installHermesCompanionSkill(config);
  const report = createTerminalAppFacade(config).getDoctorReport();
  assert.equal(report.profile, "hosted-hermes-weixin");
  assert.equal(report.mode, "hosted");
  assert.equal(report.runtimeProvider, "hermes");
  assert.equal(report.channelProvider, "hermes");
  assert.equal(report.compatibility.supported, true);
  assert.equal(report.capabilities.supportsSemanticReviewHybrid, true);
  assert.ok(report.hostedHermes);
  assert.equal(report.hostedHermes.repoSkillAsset.exists, true);
  assert.equal(report.hostedHermes.installedSkill.inSync, true);
});

test("codeksei start fails fast in Hermes hosted mode", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hosted-start-"));
  const config = withPatchedEnv({
    CODEKSEI_STATE_DIR: stateDir,
    CODEKSEI_RUNTIME: "hermes",
    CODEKSEI_CHANNEL_PROVIDER: "hermes",
  }, () => readConfig());

  await assert.rejects(
    createTerminalAppFacade(config).start(),
    /Hermes Hosted Mode/u,
  );
});

test("shared:start rejects in Hermes hosted mode", async () => {
  await assert.rejects(
    withPatchedEnvAsync({
      CODEKSEI_RUNTIME: "hermes",
      CODEKSEI_CHANNEL_PROVIDER: "hermes",
    }, async () => runSharedStart()),
    /Hermes Hosted Mode/u,
  );
});

test("repo exposes the official Hermes companion skill asset", () => {
  const skillPath = resolveRepoHermesSkillAssetPath();
  assert.equal(fs.existsSync(skillPath), true);
  const content = fs.readFileSync(skillPath, "utf8");
  assert.match(content, /codeksei timeline event/u);
  assert.match(content, /codeksei diary write/u);
  assert.match(content, /codeksei reminder write/u);
  assert.match(content, /codeksei note auto/u);
  assert.match(content, /codeksei review nightly/u);
  assert.match(content, /Hermes Hosted Mode/u);
});
