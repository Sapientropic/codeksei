const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadEnvStack } = require("../src/core/env-loader");

function normalizeFilePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

test("loadEnvStack recalculates state-dir .env after repo .env sets CODEKSEI_STATE_DIR", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-env-loader-"));
  const stateDir = path.join(repoRoot, "state-dir");
  fs.mkdirSync(stateDir, { recursive: true });

  fs.writeFileSync(path.join(repoRoot, ".env"), [
    "PROCESS_WINS=repo",
    "DUPLICATE_KEY=repo",
    "REPO_ONLY=repo",
    `CODEKSEI_STATE_DIR=${normalizeFilePath(stateDir)}`,
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(stateDir, ".env"), [
    "DUPLICATE_KEY=state",
    "STATE_ONLY=state",
  ].join("\n"), "utf8");

  const env = {
    PROCESS_WINS: "process",
  };
  const loadedPaths = loadEnvStack({ cwd: repoRoot, env });

  assert.deepEqual(
    loadedPaths.map(normalizeFilePath),
    [
      path.join(repoRoot, ".env"),
      path.join(stateDir, ".env"),
    ].map(normalizeFilePath)
  );
  assert.equal(env.PROCESS_WINS, "process");
  assert.equal(env.DUPLICATE_KEY, "repo");
  assert.equal(env.REPO_ONLY, "repo");
  assert.equal(env.STATE_ONLY, "state");
  assert.equal(normalizeFilePath(env.CODEKSEI_STATE_DIR), normalizeFilePath(stateDir));
});

test("loadEnvStack itself does not create the default state directory before env loading", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-env-loader-no-mkdir-"));
  const impossibleHome = path.join(repoRoot, "fake-home");
  const defaultStateDir = path.join(impossibleHome, ".codeksei");

  fs.writeFileSync(path.join(repoRoot, ".env"), "CODEKSEI_USER_NAME=RepoOnly\n", "utf8");

  const originalHomedir = os.homedir;
  os.homedir = () => impossibleHome;
  try {
    const env = {};
    loadEnvStack({ cwd: repoRoot, env });
    assert.equal(fs.existsSync(defaultStateDir), false);
    assert.equal(env.CODEKSEI_USER_NAME, "RepoOnly");
  } finally {
    os.homedir = originalHomedir;
  }
});
