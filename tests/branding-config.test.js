const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const branding = require("../src/core/branding");
const { readConfig } = require("../src/core/config");

function withPatchedEnv(patch, fn) {
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

test("readConfig uses CODEKSEI_* values", () => {
  const originalArgv = process.argv;
  process.argv = ["node", "codeksei.js"];

  try {
    const config = withPatchedEnv({
      CODEKSEI_USER_NAME: "NewName",
      CODEKSEI_WORKSPACE_ROOT: "E:/new-workspace",
      CODEKSEI_WEIXIN_REPLY_MODE: "settled",
    }, () => readConfig());

    assert.equal(config.userName, "NewName");
    assert.equal(config.workspaceRoot, "E:/new-workspace");
    assert.equal(config.weixinReplyMode, "settled");
  } finally {
    process.argv = originalArgv;
  }
});

test("readConfig leaves userName empty when no name is configured", () => {
  const originalArgv = process.argv;
  process.argv = ["node", "codeksei.js"];

  try {
    const config = withPatchedEnv({}, () => readConfig());
    assert.equal(config.userName, "");
  } finally {
    process.argv = originalArgv;
  }
});

test("readConfig exposes local overlay files and lets env override them", () => {
  const originalArgv = process.argv;
  process.argv = ["node", "codeksei.js"];

  try {
    const config = withPatchedEnv({
      CODEKSEI_STATE_DIR: "E:/state",
      CODEKSEI_WEIXIN_INSTRUCTIONS_OVERLAY_FILE: "E:/custom/persona.local.md",
    }, () => readConfig());

    assert.equal(config.weixinInstructionsOverlayFile, "E:/custom/persona.local.md");
    assert.equal(
      config.weixinOperationsOverlayFile.replace(/\\/g, "/"),
      "E:/state/weixin-operations.local.md"
    );
    assert.equal(
      config.workspaceBootstrapConfigFile.replace(/\\/g, "/"),
      "E:/state/workspace-bootstrap.json"
    );
  } finally {
    process.argv = originalArgv;
  }
});

test("readConfig uses the repo persona template by default instead of a stale state snapshot", () => {
  const originalArgv = process.argv;
  process.argv = ["node", "codeksei.js"];

  try {
    const config = withPatchedEnv({
      CODEKSEI_STATE_DIR: "E:/state",
    }, () => readConfig());

    assert.equal(
      config.weixinInstructionsFile.replace(/\\/g, "/"),
      path.join(__dirname, "..", "templates", "weixin-instructions.md").replace(/\\/g, "/")
    );
    assert.equal(
      config.weixinInstructionsOverlayFile.replace(/\\/g, "/"),
      "E:/state/weixin-instructions.local.md"
    );
  } finally {
    process.argv = originalArgv;
  }
});

test("readConfig keeps Windows workspace roots absolute across platforms", () => {
  const originalArgv = process.argv;
  process.argv = ["node", "codeksei.js"];

  try {
    const config = withPatchedEnv({
      CODEKSEI_WORKSPACE_ROOT: "E:/workspace/codeksei",
    }, () => readConfig());

    assert.equal(
      config.projectRadarConfigFile.replace(/\\/g, "/"),
      "E:/workspace/codeksei/.codex/code-projects.json"
    );
    assert.equal(
      config.durableNoteSchemaConfigFile.replace(/\\/g, "/"),
      "E:/workspace/codeksei/.codex/durable-note-schema.json"
    );
    assert.equal(
      config.reviewSchemaConfigFile.replace(/\\/g, "/"),
      "E:/workspace/codeksei/.codex/review-schema.json"
    );
  } finally {
    process.argv = originalArgv;
  }
});

test("resolveStateDir still resolves relative explicit paths from cwd", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-relative-state-"));
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  process.argv = ["node", "codeksei.js"];

  process.chdir(tempRoot);
  try {
    const config = withPatchedEnv({
      CODEKSEI_STATE_DIR: ".codeksei-state",
    }, () => readConfig());

    assert.equal(
      config.stateDir.replace(/\\/g, "/"),
      `${tempRoot.replace(/\\/g, "/")}/.codeksei-state`
    );
  } finally {
    process.chdir(originalCwd);
    process.argv = originalArgv;
  }
});

test("readConfig exposes unified timezone metadata", () => {
  const originalArgv = process.argv;
  process.argv = ["node", "codeksei.js"];

  try {
    const config = withPatchedEnv({
      CODEKSEI_TIMEZONE: "Europe/Paris",
      CODEKSEI_STATE_DIR: "E:/state",
    }, () => readConfig());

    assert.equal(config.timezone, "Europe/Paris");
    assert.equal(config.timezoneSource, "env");
    assert.equal(config.timezoneExplicit, true);
  } finally {
    process.argv = originalArgv;
  }
});

test("resolveStateDir defaults to the codeksei state directory", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-home-"));
  const stateDir = path.join(tempHome, ".codeksei");
  const originalHomedir = os.homedir;

  os.homedir = () => tempHome;
  try {
    assert.equal(branding.resolveStateDir({ env: {} }), stateDir);
  } finally {
    os.homedir = originalHomedir;
  }
});
