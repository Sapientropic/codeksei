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
  const jobsFile = path.join(hermesHome, "cron", "jobs.json");
  const sessionKey = overrides.sessionKey || "agent:main:weixin:dm:wxid_sender";
  const sessionId = overrides.sessionId || "sess-123";
  const chatId = overrides.chatId || "wxid_sender";
  const threadId = overrides.threadId || "";
  const userId = overrides.userId || "wxid_sender";

  fs.mkdirSync(path.join(hermesHome, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(hermesHome, "cron"), { recursive: true });
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
  fs.writeFileSync(jobsFile, JSON.stringify({ jobs: [], updated_at: "2026-04-14T00:00:00.000Z" }, null, 2), "utf8");

  fs.writeFileSync(shimPath, [
    "import json",
    "import uuid",
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
    "if action == 'sync_checkin_cron':",
    "    hermes_home = request.get('hermes_home', '')",
    "    jobs_file = os.path.join(hermes_home, 'cron', 'jobs.json')",
    "    payload = request.get('payload', {}) or {}",
    "    target_key = str(payload.get('target_key', '')).strip()",
    "    role = str(payload.get('role', '')).strip()",
    "    due_at_iso = str(payload.get('due_at_iso', '')).strip()",
    "    name = str(payload.get('name', '')).strip()",
    "    prompt = str(payload.get('prompt', '')).strip()",
    "    sender_id = str(payload.get('sender_id', '')).strip()",
    "    workspace_root = str(payload.get('workspace_root', '')).strip()",
    "    jobs_state = {'jobs': [], 'updated_at': '2026-04-14T00:00:00.000Z'}",
    "    if os.path.exists(jobs_file):",
    "        with open(jobs_file, 'r', encoding='utf-8') as handle:",
    "            jobs_state = json.load(handle)",
    "    jobs = list(jobs_state.get('jobs', []))",
    "    removed_job_ids = []",
    "    kept = []",
    "    existing = None",
    "    for job in jobs:",
    "        if job.get('codeksei_checkin_target_key') != target_key:",
    "            kept.append(job)",
    "            continue",
    "        if existing is None and job.get('codeksei_checkin_role') == role:",
    "            existing = job",
    "            continue",
    "        removed_job_ids.append(job.get('id', ''))",
    "    if existing is None:",
    "        existing = {",
    "            'id': f'cron-{uuid.uuid4().hex[:6]}',",
    "            'deliver': 'origin',",
    "        }",
    "        created = True",
    "    else:",
    "        created = False",
    "    existing.update({",
    "        'name': name,",
    "        'prompt': prompt,",
    "        'next_run_at': due_at_iso,",
    "        'enabled': True,",
    "        'state': 'scheduled',",
    "        'deliver': 'origin',",
    "        'skills': ['codeksei-companion'],",
    "        'skill': 'codeksei-companion',",
    "        'codeksei_checkin_target_key': target_key,",
    "        'codeksei_checkin_role': role,",
    "        'codeksei_sender_id': sender_id,",
    "        'codeksei_workspace_root': workspace_root,",
    "    })",
    "    kept.append(existing)",
    "    jobs_state['jobs'] = kept",
    "    jobs_state['updated_at'] = due_at_iso or '2026-04-14T00:00:00.000Z'",
    "    with open(jobs_file, 'w', encoding='utf-8') as handle:",
    "        json.dump(jobs_state, handle, ensure_ascii=False, indent=2)",
    "    result = {",
    "        'job_id': existing.get('id', ''),",
    "        'name': existing.get('name', ''),",
    "        'deliver': existing.get('deliver', 'origin'),",
    "        'next_run_at': existing.get('next_run_at', ''),",
    "        'created': created,",
    "        'removed_job_ids': removed_job_ids,",
    "        'session_key': request.get('session_key', ''),",
    "        'session_id': 'sess-123',",
    "        'origin': {'platform': 'weixin', 'chat_id': 'wxid_sender', 'thread_id': ''},",
    "    }",
    "    print(json.dumps({'ok': True, 'data': result}, ensure_ascii=False))",
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
    jobsFile,
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
