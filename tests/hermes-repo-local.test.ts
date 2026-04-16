const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { buildHermesRepoLocalEnv }: typeof import("../src/core/hermes-repo-local") = require("../src/core/hermes-repo-local");

test("buildHermesRepoLocalEnv mirrors Hermes home .env but preserves bridge-critical overrides", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-env-"));
  const hermesHome = path.join(tempRoot, ".hermes");
  const repoRoot = path.join(tempRoot, "hermes-agent");
  fs.mkdirSync(hermesHome, { recursive: true });
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(path.join(hermesHome, ".env"), [
    "HERMES_HOME=E:/wrong-home",
    "PYTHONPATH=E:/wrong-pythonpath",
    "WEIXIN_APP_ID=from-hermes-home",
  ].join("\n"), "utf8");

  const originalEnv = { ...process.env };
  process.env.PYTHONPATH = "E:/shell-pythonpath";
  delete process.env.PYTHONIOENCODING;
  delete process.env.PYTHONUTF8;
  try {
    const env = buildHermesRepoLocalEnv({ hermesHome, repoRoot });

    assert.equal(env.HERMES_HOME, hermesHome);
    assert.equal(env.PYTHONPATH, `${repoRoot}${path.delimiter}E:/shell-pythonpath`);
    assert.equal(env.PYTHONIOENCODING, "utf-8");
    assert.equal(env.PYTHONUTF8, "1");
    assert.equal(env.WEIXIN_APP_ID, "from-hermes-home");
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }
});
