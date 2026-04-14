const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");

function createFakeHermesRepoLocalFixture(tempRoot: string, overrides: {
  chatId?: string;
  sessionId?: string;
  sessionKey?: string;
  threadId?: string;
  userId?: string;
} = {}) {
  const hermesHome = path.join(tempRoot, ".hermes");
  const repoRoot = path.join(tempRoot, "hermes-agent");
  const shimPath = path.join(tempRoot, "fake-hermes-repo-local.py");
  const logFile = path.join(tempRoot, "fake-hermes-repo-local.jsonl");
  const sessionKey = overrides.sessionKey || "agent:main:weixin:dm:wxid_sender";
  const sessionId = overrides.sessionId || "sess-123";
  const chatId = overrides.chatId || "wxid_sender";
  const threadId = overrides.threadId || "";
  const userId = overrides.userId || "wxid_sender";

  fs.mkdirSync(path.join(hermesHome, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "gateway", "platforms"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "cron"), { recursive: true });

  fs.writeFileSync(path.join(repoRoot, "gateway", "platforms", "weixin.py"), "# fake weixin adapter\n", "utf8");
  fs.writeFileSync(path.join(repoRoot, "gateway", "delivery.py"), "# fake delivery\n", "utf8");
  fs.writeFileSync(path.join(repoRoot, "cron", "jobs.py"), "# fake cron jobs\n", "utf8");
  fs.writeFileSync(path.join(repoRoot, "cron", "scheduler.py"), "# fake cron scheduler\n", "utf8");
  fs.writeFileSync(path.join(repoRoot, "gateway", "session_context.py"), "from contextvars import ContextVar\n", "utf8");

  fs.writeFileSync(path.join(hermesHome, "sessions", "sessions.json"), JSON.stringify({
    [sessionKey]: {
      session_key: sessionKey,
      session_id: sessionId,
      origin: {
        platform: "weixin",
        chat_id: chatId,
        chat_name: "Test Chat",
        chat_type: "dm",
        thread_id: threadId || null,
        user_id: userId,
        user_name: "Sender",
      },
    },
  }, null, 2), "utf8");

  fs.writeFileSync(shimPath, [
    "import json",
    "import os",
    "import sys",
    "",
    "request = json.load(sys.stdin)",
    "log_file = os.environ.get('FAKE_HERMES_REPO_LOCAL_LOG', '')",
    "if log_file:",
    "    with open(log_file, 'a', encoding='utf-8') as handle:",
    "        handle.write(json.dumps(request, ensure_ascii=False) + '\\n')",
    "action = request.get('action')",
    "if action == 'send_file':",
    "    payload = {",
    "        'file_path': request.get('payload', {}).get('file_path', ''),",
    "        'session_key': request.get('session_key', ''),",
    "        'session_id': 'sess-123',",
    "        'origin': {'platform': 'weixin', 'chat_id': 'wxid_sender', 'thread_id': ''},",
    "        'mirrored': True,",
    "    }",
    "    print(json.dumps({'ok': True, 'data': payload}, ensure_ascii=False))",
    "    raise SystemExit(0)",
    "if action == 'create_reminder':",
    "    payload = {",
    "        'job_id': 'cron-123',",
    "        'name': 'ck-reminder-test',",
    "        'deliver': 'origin',",
    "        'next_run_at': request.get('payload', {}).get('due_at_iso', ''),",
    "        'session_key': request.get('session_key', ''),",
    "        'session_id': 'sess-123',",
    "        'origin': {'platform': 'weixin', 'chat_id': 'wxid_sender', 'thread_id': ''},",
    "    }",
    "    print(json.dumps({'ok': True, 'data': payload}, ensure_ascii=False))",
    "    raise SystemExit(0)",
    "print(json.dumps({'ok': False, 'error': {'message': f'unsupported action: {action}'}}))",
    "raise SystemExit(1)",
  ].join("\n"), "utf8");

  return {
    env: {
      CODEKSEI_HERMES_HOME: hermesHome,
      CODEKSEI_HERMES_REPO_ROOT: repoRoot,
      CODEKSEI_HERMES_REPO_LOCAL_SHIM_PATH: shimPath,
      CODEKSEI_RUNTIME: "hermes",
      CODEKSEI_CHANNEL_PROVIDER: "hermes",
      FAKE_HERMES_REPO_LOCAL_LOG: logFile,
      HERMES_SESSION_KEY: sessionKey,
    },
    hermesHome,
    logFile,
    repoRoot,
    sessionId,
    sessionKey,
    shimPath,
  };
}

function readFakeHermesRepoLocalLog(logFile: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(logFile)) {
    return [];
  }
  return fs.readFileSync(logFile, "utf8")
    .split(/\r?\n/u)
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => JSON.parse(line));
}

module.exports = {
  createFakeHermesRepoLocalFixture,
  readFakeHermesRepoLocalLog,
};
