const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { loadEnvStack }: typeof import("../src/core/env-loader") = require("../src/core/env-loader");

test("loadEnvStack re-resolves the state env after the repo env defines CODEKSEI_STATE_DIR", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-env-loader-"));
  const stateDir = path.join(tempRoot, "state");
  fs.mkdirSync(stateDir, { recursive: true });

  fs.writeFileSync(path.join(tempRoot, ".env"), [
    `CODEKSEI_STATE_DIR=${stateDir}`,
    "CODEKSEI_USER_NAME=repo-user",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(stateDir, ".env"), [
    "CODEKSEI_RUNTIME=hermes",
  ].join("\n"), "utf8");

  const env: Record<string, string | undefined> = {};
  const loaded = loadEnvStack({ cwd: tempRoot, env });

  assert.deepEqual(loaded, [
    path.join(tempRoot, ".env"),
    path.join(stateDir, ".env"),
  ]);
  assert.equal(env.CODEKSEI_STATE_DIR, stateDir);
  assert.equal(env.CODEKSEI_USER_NAME, "repo-user");
  assert.equal(env.CODEKSEI_RUNTIME, "hermes");
});

test("loadEnvStack never overrides keys that are already present in the process env", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-env-loader-"));
  const stateDir = path.join(tempRoot, "state");
  fs.mkdirSync(stateDir, { recursive: true });

  fs.writeFileSync(path.join(tempRoot, ".env"), [
    `CODEKSEI_STATE_DIR=${stateDir}`,
    "CODEKSEI_USER_NAME=repo-user",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(stateDir, ".env"), [
    "CODEKSEI_USER_NAME=state-user",
    "CODEKSEI_RUNTIME=state-runtime",
  ].join("\n"), "utf8");

  const env: Record<string, string | undefined> = {
    CODEKSEI_USER_NAME: "shell-user",
  };
  loadEnvStack({ cwd: tempRoot, env });

  assert.equal(env.CODEKSEI_USER_NAME, "shell-user");
  assert.equal(env.CODEKSEI_RUNTIME, "state-runtime");
});
