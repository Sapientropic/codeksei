const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const os: typeof import("node:os") = require("node:os");
const childProcess: typeof import("node:child_process") = require("node:child_process");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  collectHermesRepoLocalReport,
  resolveHermesRepoRoot,
  sendFileViaHermesRepoLocal,
} = require("../src/core/hermes-repo-local");
const {
  createFakeHermesRepoLocalFixture,
  readFakeHermesRepoLocalLog,
} = require("./helpers/fake-hermes-repo-local.ts");

test("repo-local report recognizes a sibling hermes-agent checkout when present", () => {
  const siblingRepo = resolveHermesRepoRoot();
  if (!fs.existsSync(siblingRepo)) {
    return;
  }

  const report = collectHermesRepoLocalReport();
  assert.equal(path.resolve(report.repoRoot), path.resolve(siblingRepo));
  assert.equal(report.exists, true);
  assert.equal(report.weixinAdapterFound, true);
  assert.equal(report.deliveryFound, true);
  assert.equal(report.cronFound, true);
  assert.equal(report.sessionContextMode, "contextvars");
});

test("repo-local bridge loads Hermes home .env for hosted sends without overriding bridge wiring", () => {
  const pythonCommand = resolveTestPythonCommand();
  if (!pythonCommand) {
    return;
  }

  const fixture = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-repo-local-env-"))
  );
  const artifactPath = path.join(fixture.repoRoot, "artifact.txt");
  fs.writeFileSync(artifactPath, "artifact", "utf8");
  fs.writeFileSync(
    path.join(fixture.hermesHome, ".env"),
    [
      "WEIXIN_TOKEN=loaded-from-hermes-home",
      "PYTHONPATH=from-hermes-home-pythonpath",
      "HERMES_HOME=from-hermes-home",
      "",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(fixture.shimPath, [
    "import json",
    "import os",
    "import sys",
    "",
    "request = json.load(sys.stdin)",
    "log_file = os.environ.get('FAKE_HERMES_REPO_LOCAL_LOG', '')",
    "if log_file:",
    "    with open(log_file, 'a', encoding='utf-8') as handle:",
    "        handle.write(json.dumps({",
    "            'env_token': os.environ.get('WEIXIN_TOKEN', ''),",
    "            'pythonpath': os.environ.get('PYTHONPATH', ''),",
    "            'hermes_home': os.environ.get('HERMES_HOME', ''),",
    "        }, ensure_ascii=False) + '\\n')",
    "payload = {",
    "    'file_path': request.get('payload', {}).get('file_path', ''),",
    "    'session_key': request.get('session_key', ''),",
    "    'session_id': 'sess-123',",
    "    'origin': {'platform': 'weixin', 'chat_id': 'wxid_sender', 'thread_id': ''},",
    "    'mirrored': True,",
    "}",
    "print(json.dumps({'ok': True, 'data': payload}, ensure_ascii=False))",
  ].join("\n"), "utf8");

  const previousSessionKey = process.env.HERMES_SESSION_KEY;
  const previousWeixinToken = process.env.WEIXIN_TOKEN;
  const previousLogFile = process.env.FAKE_HERMES_REPO_LOCAL_LOG;
  process.env.HERMES_SESSION_KEY = fixture.sessionKey;
  process.env.FAKE_HERMES_REPO_LOCAL_LOG = fixture.logFile;
  delete process.env.WEIXIN_TOKEN;

  try {
    const result = sendFileViaHermesRepoLocal({
      CODEKSEI_HERMES_HOME: fixture.hermesHome,
      CODEKSEI_HERMES_PYTHON_COMMAND: pythonCommand,
      CODEKSEI_HERMES_REPO_LOCAL_SHIM_PATH: fixture.shimPath,
      CODEKSEI_HERMES_REPO_ROOT: fixture.repoRoot,
    }, {
      file_path: artifactPath,
    });

    assert.equal(result.filePath, artifactPath);
    const log = readFakeHermesRepoLocalLog(fixture.logFile);
    assert.equal(log.length, 1);
    assert.equal(log[0].env_token, "loaded-from-hermes-home");
    assert.equal(log[0].hermes_home, fixture.hermesHome);
    assert.equal(String(log[0].pythonpath || "").split(path.delimiter)[0], fixture.repoRoot);
    assert.match(String(log[0].pythonpath || ""), /from-hermes-home-pythonpath/u);
  } finally {
    if (previousSessionKey === undefined) {
      delete process.env.HERMES_SESSION_KEY;
    } else {
      process.env.HERMES_SESSION_KEY = previousSessionKey;
    }
    if (previousWeixinToken === undefined) {
      delete process.env.WEIXIN_TOKEN;
    } else {
      process.env.WEIXIN_TOKEN = previousWeixinToken;
    }
    if (previousLogFile === undefined) {
      delete process.env.FAKE_HERMES_REPO_LOCAL_LOG;
    } else {
      process.env.FAKE_HERMES_REPO_LOCAL_LOG = previousLogFile;
    }
  }
});

test("repo-local bridge falls back to python3 when python is unavailable", () => {
  if (process.platform === "win32") {
    return;
  }
  const pythonCommand = resolveTestPythonCommand();
  if (!pythonCommand) {
    return;
  }

  const fixture = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-repo-local-python3-"))
  );
  const artifactPath = path.join(fixture.repoRoot, "artifact.txt");
  fs.writeFileSync(artifactPath, "artifact", "utf8");

  const shimBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-python3-path-"));
  fs.symlinkSync(pythonCommand, path.join(shimBinDir, "python3"));

  const previousPath = process.env.PATH;
  const previousSessionKey = process.env.HERMES_SESSION_KEY;
  const previousLogFile = process.env.FAKE_HERMES_REPO_LOCAL_LOG;
  process.env.PATH = [shimBinDir, "/usr/bin", "/bin"].join(path.delimiter);
  process.env.HERMES_SESSION_KEY = fixture.sessionKey;
  process.env.FAKE_HERMES_REPO_LOCAL_LOG = fixture.logFile;

  try {
    const result = sendFileViaHermesRepoLocal({
      CODEKSEI_HERMES_HOME: fixture.hermesHome,
      CODEKSEI_HERMES_REPO_LOCAL_SHIM_PATH: fixture.shimPath,
      CODEKSEI_HERMES_REPO_ROOT: fixture.repoRoot,
    }, {
      file_path: artifactPath,
    });

    assert.equal(result.filePath, artifactPath);
    const log = readFakeHermesRepoLocalLog(fixture.logFile);
    assert.equal(log.length, 1);
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    if (previousSessionKey === undefined) {
      delete process.env.HERMES_SESSION_KEY;
    } else {
      process.env.HERMES_SESSION_KEY = previousSessionKey;
    }
    if (previousLogFile === undefined) {
      delete process.env.FAKE_HERMES_REPO_LOCAL_LOG;
    } else {
      process.env.FAKE_HERMES_REPO_LOCAL_LOG = previousLogFile;
    }
  }
});

function resolveTestPythonCommand(): string {
  if (process.platform === "win32") {
    const result = childProcess.spawnSync("py", ["-3", "--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.status === 0 ? "py" : "";
  }
  const result = childProcess.spawnSync("python3", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 ? "python3" : "";
}
