const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const branding = require("../src/core/branding");
const { parseEnvConfig, readConfig } = require("../src/core/config");

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

test("readConfig uses CODEKSEI_* values", () => {
  const originalArgv = process.argv;
  process.argv = ["node", "codeksei.js"];

  try {
    const config = withPatchedEnv({
      CODEKSEI_USER_LANGUAGE: "en",
      CODEKSEI_USER_NAME: "NewName",
      CODEKSEI_WORKSPACE_ROOT: "E:/new-workspace",
      CODEKSEI_WEIXIN_REPLY_MODE: "settled",
    }, () => readConfig());

    assert.equal(config.userName, "NewName");
    assert.equal(config.userLanguage, "en");
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

    const actual = config.stateDir.replace(/\\/g, "/");
    const expected = path.join(tempRoot, ".codeksei-state").replace(/\\/g, "/");
    assert.equal(
      actual === expected || actual === `/private${expected}`,
      true,
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

test("parseEnvConfig keeps the default bridge host shape explicit", () => {
  const config = parseEnvConfig({
    CODEKSEI_STATE_DIR: "E:/state",
  });

  assert.equal(config.channel, "weixin");
  assert.equal(config.runtime, "codex");
  assert.equal(config.channelProvider, "codeksei");
  assert.equal(config.reminderQueueFile.replace(/\\/g, "/"), "E:/state/reminder-queue.json");
  assert.equal(config.systemMessageQueueFile.replace(/\\/g, "/"), "E:/state/system-message-queue.json");
  assert.equal(config.timelineScreenshotQueueFile.replace(/\\/g, "/"), "E:/state/timeline-screenshot-queue.json");
});

test("parseEnvConfig derives hosted Hermes defaults and normalizes reply/access modes", () => {
  const config = parseEnvConfig({
    CODEKSEI_STATE_DIR: "E:/state",
    CODEKSEI_RUNTIME: "hermes",
    CODEKSEI_WEIXIN_REPLY_MODE: "SETTLED",
    CODEKSEI_RUNTIME_ACCESS_MODE: "default",
  });

  assert.equal(config.runtime, "hermes");
  assert.equal(config.channelProvider, "hermes");
  assert.equal(config.weixinReplyMode, "settled");
  assert.equal(config.runtimeAccessMode, "current");
  assert.match(config.hermesRepoRoot.replace(/\\/g, "/"), /\/hermes-agent$/u);
  assert.match(config.hermesRepoLocalShimPath.replace(/\\/g, "/"), /\/tools\/hermes_repo_local\/bridge\.py$/u);
});

test("parseEnvConfig lets workspaceRoot override env and keeps workspace-scoped config files aligned", () => {
  const config = parseEnvConfig({
    CODEKSEI_STATE_DIR: "E:/state",
    CODEKSEI_WORKSPACE_ROOT: "E:/workspace/from-env",
  }, {
    workspaceRoot: "E:/workspace/from-cli",
  });

  assert.equal(config.workspaceRoot, "E:/workspace/from-cli");
  assert.equal(
    config.projectRadarConfigFile.replace(/\\/g, "/"),
    "E:/workspace/from-cli/.codex/code-projects.json",
  );
  assert.equal(
    config.reviewSchemaConfigFile.replace(/\\/g, "/"),
    "E:/workspace/from-cli/.codex/review-schema.json",
  );
});
