const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildHermesRepoLocalEnv,
  syncCheckinCronViaHermesRepoLocal,
}: typeof import("../src/core/hermes-repo-local") = require("../src/core/hermes-repo-local");
const {
  createFakeHermesRepoLocalFixture,
  readFakeHermesRepoLocalLog,
} = require("./helpers/fake-hermes-repo-local.ts");

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

test("sync checkin cron resolves the unique matching Hermes session without HERMES_SESSION_KEY", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-session-autoresolve-"));
  const repoLocal = createFakeHermesRepoLocalFixture(tempRoot, {
    chatId: "wxid_target",
    sessionKey: "agent:main:weixin:dm:wxid_target",
    userId: "wxid_target",
  });
  const originalEnv = { ...process.env };
  delete process.env.HERMES_SESSION_KEY;
  delete process.env.HERMES_SESSION_CHAT_ID;
  delete process.env.HERMES_SESSION_PLATFORM;
  process.env.FAKE_HERMES_REPO_LOCAL_LOG = repoLocal.logFile;
  try {
    const result = syncCheckinCronViaHermesRepoLocal({
      hermesHome: repoLocal.hermesHome,
      hermesRepoLocalShimPath: repoLocal.shimPath,
      hermesRepoRoot: repoLocal.repoRoot,
    }, {
      plans: [
        {
          due_at_iso: new Date(Date.now() + 60_000).toISOString(),
          env: {
            CODEKSEI_RUNTIME: "hermes",
          },
          name: "ck-checkin-wake",
          prompt: "run hosted checkin",
          role: "wake",
          sender_id: "wxid_target",
          target_key: "wxid_target::/tmp/workspace",
          workspace_root: "/tmp/workspace",
        },
      ],
      sender_id: "wxid_target",
      target_key: "wxid_target::/tmp/workspace",
      workspace_root: "/tmp/workspace",
    });

    assert.equal(result.sessionKey, repoLocal.sessionKey);
    const requests = readFakeHermesRepoLocalLog(repoLocal.logFile);
    assert.equal(requests[0].session_key, repoLocal.sessionKey);
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }
});
