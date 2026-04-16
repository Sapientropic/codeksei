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
    `DEFAULT_PLATFORM = ${JSON.stringify("weixin")}`,
    `DEFAULT_CHAT_ID = ${JSON.stringify(chatId)}`,
    `DEFAULT_CHAT_NAME = ${JSON.stringify("Test Chat")}`,
    `DEFAULT_THREAD_ID = ${JSON.stringify(threadId)}`,
    "",
    "request = json.load(sys.stdin)",
    "log_file = os.environ.get('FAKE_HERMES_REPO_LOCAL_LOG', '')",
    "if log_file:",
    "    with open(log_file, 'a', encoding='utf-8') as handle:",
    "        handle.write(json.dumps(request, ensure_ascii=False) + '\\n')",
    "def build_origin():",
    "    thread_id = str((os.environ.get('HERMES_CRON_AUTO_DELIVER_THREAD_ID') or os.environ.get('HERMES_SESSION_THREAD_ID') or DEFAULT_THREAD_ID or '')).strip()",
    "    return {",
    "        'platform': str(os.environ.get('HERMES_SESSION_PLATFORM', DEFAULT_PLATFORM) or DEFAULT_PLATFORM).strip(),",
    "        'chat_id': str(os.environ.get('HERMES_SESSION_CHAT_ID', DEFAULT_CHAT_ID) or DEFAULT_CHAT_ID).strip(),",
    "        'chat_name': str(os.environ.get('HERMES_SESSION_CHAT_NAME', DEFAULT_CHAT_NAME) or DEFAULT_CHAT_NAME).strip(),",
    "        'thread_id': thread_id,",
    "    }",
    "",
    "origin = build_origin()",
    "action = request.get('action')",
    "if action == 'send_file':",
    "    payload = {",
    "        'file_path': request.get('payload', {}).get('file_path', ''),",
    "        'session_key': request.get('session_key', ''),",
    "        'session_id': 'sess-123',",
    "        'origin': origin,",
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
    "        'origin': origin,",
    "    }",
    "    print(json.dumps({'ok': True, 'data': payload}, ensure_ascii=False))",
    "    raise SystemExit(0)",
    "if action == 'sync_checkin_cron':",
    "    hermes_home = request.get('hermes_home', '')",
    "    jobs_file = os.path.join(hermes_home, 'cron', 'jobs.json')",
    "    payload = request.get('payload', {}) or {}",
    "    plans = payload.get('plans', []) or []",
    "    if not isinstance(plans, list) or not plans:",
    "        plans = [payload]",
    "    jobs_state = {'jobs': [], 'updated_at': '2026-04-14T00:00:00.000Z'}",
    "    if os.path.exists(jobs_file):",
    "        with open(jobs_file, 'r', encoding='utf-8') as handle:",
    "            jobs_state = json.load(handle)",
    "    jobs = list(jobs_state.get('jobs', []))",
    "    target_key = str(plans[0].get('target_key', '')).strip()",
    "    removed_job_ids = []",
    "    kept = [job for job in jobs if job.get('codeksei_checkin_target_key') != target_key]",
    "    managed = [job for job in jobs if job.get('codeksei_checkin_target_key') == target_key]",
    "    existing_by_role = {}",
    "    duplicates = []",
    "    for job in managed:",
    "        role = str(job.get('codeksei_checkin_role', '')).strip()",
    "        if role and role not in existing_by_role:",
    "            existing_by_role[role] = job",
    "            continue",
    "        duplicates.append(job)",
    "    synced_jobs = []",
    "    kept_ids = set()",
    "    for plan in plans:",
    "        role = str(plan.get('role', '')).strip()",
    "        due_at_iso = str(plan.get('due_at_iso', '')).strip()",
    "        name = str(plan.get('name', '')).strip()",
    "        prompt = str(plan.get('prompt', '')).strip()",
    "        script = str(plan.get('script', '')).strip()",
    "        env = plan.get('env', {}) or {}",
    "        sender_id = str(plan.get('sender_id', '')).strip()",
    "        workspace_root = str(plan.get('workspace_root', '')).strip()",
    "        existing = existing_by_role.get(role)",
    "        if existing is None:",
    "            existing = {",
    "                'id': f'cron-{uuid.uuid4().hex[:6]}',",
    "                'deliver': 'origin',",
    "            }",
    "            created = True",
    "        else:",
    "            created = False",
    "        existing.update({",
    "            'name': name,",
    "            'prompt': prompt,",
    "            'script': script,",
    "            'next_run_at': due_at_iso,",
    "            'enabled': True,",
    "            'state': 'scheduled',",
    "            'deliver': 'origin',",
    "            'env': env,",
    "            'origin': origin,",
    "            'skills': ['codeksei-companion'],",
    "            'skill': 'codeksei-companion',",
    "            'codeksei_checkin_target_key': target_key,",
    "            'codeksei_checkin_role': role,",
    "            'codeksei_sender_id': sender_id,",
    "            'codeksei_workspace_root': workspace_root,",
    "        })",
    "        kept.append(existing)",
    "        kept_ids.add(existing.get('id', ''))",
    "        synced_jobs.append({",
    "            'created': created,",
    "            'deliver': existing.get('deliver', 'origin'),",
    "            'job_id': existing.get('id', ''),",
    "            'name': existing.get('name', ''),",
    "            'next_run_at': existing.get('next_run_at', ''),",
    "            'role': role,",
    "        })",
    "    for stale in duplicates:",
    "        stale_id = stale.get('id', '')",
    "        if stale_id and stale_id not in kept_ids:",
    "            removed_job_ids.append(stale_id)",
    "    for role, job in existing_by_role.items():",
    "        if role not in [str(plan.get('role', '')).strip() for plan in plans]:",
    "            stale_id = job.get('id', '')",
    "            if stale_id and stale_id not in kept_ids:",
    "                removed_job_ids.append(stale_id)",
    "    jobs_state['jobs'] = [job for job in kept if job.get('id', '') not in removed_job_ids]",
    "    jobs_state['updated_at'] = str(plans[0].get('due_at_iso', '')).strip() or '2026-04-14T00:00:00.000Z'",
    "    with open(jobs_file, 'w', encoding='utf-8') as handle:",
    "        json.dump(jobs_state, handle, ensure_ascii=False, indent=2)",
    "    result = {",
    "        'deliver': 'origin',",
    "        'jobs': synced_jobs,",
    "        'removed_job_ids': removed_job_ids,",
    "        'session_key': request.get('session_key', ''),",
    "        'session_id': 'sess-123',",
    "        'origin': origin,",
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
