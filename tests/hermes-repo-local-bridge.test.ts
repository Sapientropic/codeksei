const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const { spawnSync }: typeof import("node:child_process") = require("node:child_process");
const {
  resolveHermesRepoLocalPythonInvocation,
}: typeof import("../src/core/hermes-repo-local") = require("../src/core/hermes-repo-local");

const bridgePath = path.join(__dirname, "..", "tools", "hermes_repo_local", "bridge.py");
const pythonInvocation = resolveHermesRepoLocalPythonInvocation({
  hermesPythonCommand: process.env.CODEKSEI_TEST_PYTHON || process.env.PYTHON || "",
});

test("repo-local sync_checkin_cron keeps the existing recovery job when wake creation fails", () => {
  const fixture = createBridgeFixture("create_failure", {
    createJobBody: [
      "raise RuntimeError('simulated wake creation failure')",
    ],
    initialJobs: [{
      id: "cron-recovery-1",
      name: "ck-checkin-recovery",
      next_run_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      enabled: true,
      state: "scheduled",
      deliver: "origin",
      codeksei_checkin_target_key: "wx-user::/tmp/workspace",
      codeksei_checkin_role: "recovery",
    }],
  });

  const result = invokeBridge(fixture, {
    plans: [
      {
        due_at_iso: new Date(Date.now() + 10 * 60_000).toISOString(),
        env: {
          CODEKSEI_RUNTIME: "hermes",
        },
        name: "ck-checkin-wake",
        prompt: "run hosted checkin",
        role: "wake",
        script: "/tmp/.hermes/scripts/codeksei_context_briefing.py",
        sender_id: "wx-user",
        target_key: "wx-user::/tmp/workspace",
        workspace_root: "/tmp/workspace",
      },
      {
        due_at_iso: new Date(Date.now() + 40 * 60_000).toISOString(),
        env: {
          CODEKSEI_RUNTIME: "hermes",
        },
        name: "ck-checkin-recovery",
        prompt: "run hosted checkin recovery",
        role: "recovery",
        script: "/tmp/.hermes/scripts/codeksei_context_briefing.py",
        sender_id: "wx-user",
        target_key: "wx-user::/tmp/workspace",
        workspace_root: "/tmp/workspace",
      },
    ],
    sender_id: "wx-user",
    target_key: "wx-user::/tmp/workspace",
    workspace_root: "/tmp/workspace",
  });

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout || "{}");
  assert.equal(payload.ok, false);
  const jobsState = JSON.parse(fs.readFileSync(fixture.jobsFile, "utf8"));
  assert.equal(jobsState.jobs.length, 1);
  assert.equal(jobsState.jobs[0].id, "cron-recovery-1");
  assert.equal(jobsState.jobs[0].codeksei_checkin_role, "recovery");
});

test("repo-local sync_checkin_cron degrades gracefully when Hermes create_job has no env kwarg", () => {
  const fixture = createBridgeFixture("no_env_kwarg", {
    createJobSignature: "def create_job(prompt, schedule, name=None, repeat=1, deliver='local', origin=None, skills=None, script=None):",
    initialJobs: [{
      id: "cron-recovery-1",
      name: "ck-checkin-recovery",
      next_run_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      enabled: true,
      state: "scheduled",
      deliver: "origin",
      codeksei_checkin_target_key: "wx-user::/tmp/workspace",
      codeksei_checkin_role: "recovery",
    }],
  });

  const result = invokeBridge(fixture, {
    plans: [
      {
        due_at_iso: new Date(Date.now() + 10 * 60_000).toISOString(),
        env: {
          CODEKSEI_RUNTIME: "hermes",
          CODEKSEI_STATE_DIR: "/tmp/codeksei-state",
        },
        name: "ck-checkin-wake",
        prompt: "run hosted checkin",
        role: "wake",
        script: "/tmp/.hermes/scripts/codeksei_context_briefing.py",
        sender_id: "wx-user",
        target_key: "wx-user::/tmp/workspace",
        workspace_root: "/tmp/workspace",
      },
      {
        due_at_iso: new Date(Date.now() + 40 * 60_000).toISOString(),
        env: {
          CODEKSEI_RUNTIME: "hermes",
          CODEKSEI_STATE_DIR: "/tmp/codeksei-state",
        },
        name: "ck-checkin-recovery",
        prompt: "run hosted checkin recovery",
        role: "recovery",
        script: "/tmp/.hermes/scripts/codeksei_context_briefing.py",
        sender_id: "wx-user",
        target_key: "wx-user::/tmp/workspace",
        workspace_root: "/tmp/workspace",
      },
      {
        due_at_iso: new Date(Date.now() + 70 * 60_000).toISOString(),
        env: {
          CODEKSEI_RUNTIME: "hermes",
          CODEKSEI_STATE_DIR: "/tmp/codeksei-state",
        },
        name: "ck-checkin-guard",
        prompt: "run hosted checkin guard",
        role: "guard",
        script: "/tmp/.hermes/scripts/codeksei_context_briefing.py",
        sender_id: "wx-user",
        target_key: "wx-user::/tmp/workspace",
        workspace_root: "/tmp/workspace",
      },
    ],
    sender_id: "wx-user",
    target_key: "wx-user::/tmp/workspace",
    workspace_root: "/tmp/workspace",
  });

  assert.equal(result.status, 0, result.stderr || "expected bridge to succeed");
  const payload = JSON.parse(result.stdout || "{}");
  assert.equal(payload.ok, true);
  assert.equal(Array.isArray(payload.data.jobs), true);
  assert.deepEqual(payload.data.jobs.map((job: { role: string }) => job.role), ["wake", "recovery", "guard"]);
  assert.equal(payload.data.jobs.find((job: { role: string }) => job.role === "wake").job_id.startsWith("cron-created-"), true);
  assert.equal(payload.data.jobs.find((job: { role: string }) => job.role === "recovery").job_id, "cron-recovery-1");
  assert.equal(payload.data.jobs.find((job: { role: string }) => job.role === "guard").job_id.startsWith("cron-created-"), true);
  assert.deepEqual(payload.data.removed_job_ids, []);

  const jobsState = JSON.parse(fs.readFileSync(fixture.jobsFile, "utf8"));
  assert.equal(jobsState.jobs.length, 3);
  assert.deepEqual(jobsState.jobs.map((job: { codeksei_checkin_role: string }) => job.codeksei_checkin_role).sort(), ["guard", "recovery", "wake"]);
});

test("repo-local create_reminder stores a rephrasing prompt instead of verbatim echo instructions", () => {
  const fixture = createBridgeFixture("create_reminder_prompt");
  const result = invokeBridge(fixture, {
    due_at_iso: new Date(Date.now() + 30 * 60_000).toISOString(),
    text: "白天再主动关心一下这条线",
    workspace_root: "/tmp/workspace",
  }, "create_reminder");

  assert.equal(result.status, 0, result.stderr || "expected reminder bridge to succeed");
  const jobsState = JSON.parse(fs.readFileSync(fixture.jobsFile, "utf8"));
  assert.equal(jobsState.jobs.length, 1);
  assert.match(jobsState.jobs[0].prompt, /Rephrase it for the user/u);
  assert.doesNotMatch(jobsState.jobs[0].prompt, /respond with exactly the reminder body below/u);
});

function createBridgeFixture(
  prefix: string,
  {
    createJobBody = [],
    createJobSignature = "def create_job(prompt, schedule, name=None, repeat=1, deliver='local', origin=None, skills=None, env=None, script=None):",
    initialJobs = [],
  }: {
    createJobBody?: string[];
    createJobSignature?: string;
    initialJobs?: Array<Record<string, unknown>>;
  } = {},
) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `codeksei-bridge-${prefix}-`));
  const hermesHome = path.join(tempRoot, ".hermes");
  const repoRoot = path.join(tempRoot, "hermes-agent");
  const jobsFile = path.join(hermesHome, "cron", "jobs.json");
  const sessionKey = "agent:main:weixin:dm:wxid_sender";

  fs.mkdirSync(path.join(hermesHome, "cron"), { recursive: true });
  fs.mkdirSync(path.join(hermesHome, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "cron"), { recursive: true });

  fs.writeFileSync(path.join(repoRoot, "cron", "__init__.py"), "", "utf8");
  fs.writeFileSync(path.join(hermesHome, "sessions", "sessions.json"), JSON.stringify({
    [sessionKey]: {
      session_key: sessionKey,
      session_id: "sess-123",
      origin: {
        platform: "weixin",
        chat_id: "wxid_sender",
        chat_name: "Test Chat",
        thread_id: null,
      },
    },
  }, null, 2), "utf8");
  fs.writeFileSync(jobsFile, JSON.stringify({
    jobs: initialJobs,
    updated_at: new Date().toISOString(),
  }, null, 2), "utf8");

  fs.writeFileSync(path.join(repoRoot, "cron", "jobs.py"), buildFakeCronJobsModule({
    createJobBody,
    createJobSignature,
  }), "utf8");

  return {
    hermesHome,
    jobsFile,
    repoRoot,
    sessionKey,
  };
}

function buildFakeCronJobsModule({
  createJobBody,
  createJobSignature,
}: {
  createJobBody: string[];
  createJobSignature: string;
}) {
  const createBody = createJobBody.length
    ? createJobBody.map((line) => `    ${line}`)
    : [
      "    state = _load_state()",
      "    job = {",
      "        'id': f'cron-created-{len(state.get(\"jobs\", [])) + 1}',",
      "        'prompt': prompt,",
      "        'schedule': schedule,",
      "        'name': name or 'job',",
      "        'repeat': repeat,",
      "        'deliver': deliver,",
      "        'origin': origin,",
      "        'skills': list(skills or []),",
      "        'skill': (list(skills or [])[:1] or [None])[0],",
      "        'script': script,",
      "        'next_run_at': schedule,",
      "        'enabled': True,",
      "        'state': 'scheduled',",
      "    }",
      "    if 'env' in locals() and isinstance(env, dict):",
      "        job['env'] = env",
      "    state.setdefault('jobs', []).append(job)",
      "    _save_state(state)",
      "    return job",
    ];

  return [
    "import json",
    "import os",
    "from pathlib import Path",
    "",
    "JOBS_FILE = Path(os.environ['HERMES_HOME']) / 'cron' / 'jobs.json'",
    "",
    "def _load_state():",
    "    if not JOBS_FILE.exists():",
    "        return {'jobs': [], 'updated_at': ''}",
    "    return json.loads(JOBS_FILE.read_text(encoding='utf-8'))",
    "",
    "def _save_state(state):",
    "    JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)",
    "    JOBS_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')",
    "",
    "def parse_schedule(value):",
    "    return {'value': value, 'display': value}",
    "",
    "def list_jobs(include_disabled=False):",
    "    state = _load_state()",
    "    jobs = list(state.get('jobs', []))",
    "    if include_disabled:",
    "        return jobs",
    "    return [job for job in jobs if job.get('enabled', True)]",
    "",
    "def remove_job(job_id):",
    "    state = _load_state()",
    "    jobs = [job for job in state.get('jobs', []) if job.get('id') != job_id]",
    "    state['jobs'] = jobs",
    "    _save_state(state)",
    "    return True",
    "",
    "def update_job(job_id, updates):",
    "    state = _load_state()",
    "    for index, job in enumerate(state.get('jobs', [])):",
    "        if job.get('id') != job_id:",
    "            continue",
    "        updated = dict(job)",
    "        updated.update(dict(updates or {}))",
    "        if isinstance(updated.get('schedule'), dict):",
    "            updated['next_run_at'] = str(updated['schedule'].get('value') or '')",
    "        state['jobs'][index] = updated",
    "        _save_state(state)",
    "        return updated",
    "    return None",
    "",
    createJobSignature,
    ...createBody,
    "",
  ].join("\n");
}

function invokeBridge(
  fixture: {
    hermesHome: string;
    repoRoot: string;
    sessionKey: string;
  },
  payload: Record<string, unknown>,
  action: "create_reminder" | "sync_checkin_cron" = "sync_checkin_cron",
) {
  return spawnSync(pythonInvocation.command, [...pythonInvocation.argsPrefix, bridgePath], {
    cwd: fixture.repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HERMES_HOME: fixture.hermesHome,
      HERMES_SESSION_KEY: fixture.sessionKey,
    },
    input: JSON.stringify({
      action,
      hermes_home: fixture.hermesHome,
      payload,
      repo_root: fixture.repoRoot,
      session_key: fixture.sessionKey,
    }),
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60_000,
    windowsHide: true,
  });
}
