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

test("readConfig prefers CODEKSEI_* over CYBERBOSS_*", () => {
  const originalArgv = process.argv;
  process.argv = ["node", "codeksei.js"];

  try {
    const config = withPatchedEnv({
      CODEKSEI_USER_NAME: "NewName",
      CYBERBOSS_USER_NAME: "LegacyName",
      CODEKSEI_WORKSPACE_ROOT: "E:/new-workspace",
      CYBERBOSS_WORKSPACE_ROOT: "E:/legacy-workspace",
      CODEKSEI_WEIXIN_REPLY_MODE: "settled",
      CYBERBOSS_WEIXIN_REPLY_MODE: "stream",
    }, () => readConfig());

    assert.equal(config.userName, "NewName");
    assert.equal(config.workspaceRoot, "E:/new-workspace");
    assert.equal(config.weixinReplyMode, "settled");
  } finally {
    process.argv = originalArgv;
  }
});

test("readConfig still accepts legacy CYBERBOSS_* values", () => {
  const originalArgv = process.argv;
  process.argv = ["node", "codeksei.js"];

  try {
    const config = withPatchedEnv({
      CYBERBOSS_USER_NAME: "LegacyName",
      CYBERBOSS_WORKSPACE_ROOT: "E:/legacy-workspace",
    }, () => readConfig());

    assert.equal(config.userName, "LegacyName");
    assert.equal(config.workspaceRoot, "E:/legacy-workspace");
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
  } finally {
    process.argv = originalArgv;
  }
});

test("resolveStateDir reuses legacy directory until new directory exists", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-home-"));
  const legacyStateDir = path.join(tempHome, ".cyberboss");
  const newStateDir = path.join(tempHome, ".codeksei");
  const originalHomedir = os.homedir;

  os.homedir = () => tempHome;
  try {
    fs.mkdirSync(legacyStateDir, { recursive: true });
    assert.equal(branding.resolveStateDir({ env: {} }), legacyStateDir);

    fs.mkdirSync(newStateDir, { recursive: true });
    assert.equal(branding.resolveStateDir({ env: {} }), newStateDir);
  } finally {
    os.homedir = originalHomedir;
  }
});
