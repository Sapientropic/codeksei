import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import * as dotenv from "dotenv";

import { resolvePackageRoot } from "../contracts/path-utils";
import {
  ensureHermesContextBriefingScript,
  ensureHermesHostedCheckinScript,
  resolveHermesHostedCheckinScriptPath,
} from "../context/briefing-script";
import { captureSubprocess, resolveCommandOnPath } from "./subprocess-capture";
import { normalizeText } from "./text-normalization";

export type HermesRepoLocalSessionContextMode = "contextvars" | "legacy_env" | "missing";

export interface HermesRepoLocalReport {
  repoRoot: string;
  exists: boolean;
  commit: string;
  weixinAdapterFound: boolean;
  deliveryFound: boolean;
  cronFound: boolean;
  sessionContextMode: HermesRepoLocalSessionContextMode;
  sessionsIndexPath: string;
  shimPath: string;
  shimExists: boolean;
  ready: boolean;
  missing: string[];
  reason: string;
}

export interface HermesRepoLocalOrigin {
  platform: string;
  chatId: string;
  threadId: string;
  userId: string;
  userName: string;
  chatName: string;
  chatType: string;
}

export interface HermesRepoLocalSendFileResult {
  filePath: string;
  platform: string;
  chatId: string;
  threadId: string;
  sessionId: string;
  sessionKey: string;
  mirrored: boolean;
}

export interface HermesRepoLocalReminderResult {
  jobId: string;
  name: string;
  deliver: string;
  nextRunAt: string;
  sessionId: string;
  sessionKey: string;
  platform: string;
  chatId: string;
  threadId: string;
}

export interface HermesRepoLocalSyncCheckinCronResult {
  chatId: string;
  deliver: string;
  jobs: HermesRepoLocalSyncCheckinCronJobResult[];
  platform: string;
  removedJobIds: string[];
  sessionId: string;
  sessionKey: string;
  threadId: string;
}

export interface HermesRepoLocalSyncCheckinCronJobResult {
  created: boolean;
  deliver: string;
  jobId: string;
  name: string;
  nextRunAt: string;
  role: "guard" | "recovery" | "wake";
}

interface HermesRepoLocalEnvelope<TData> {
  ok: boolean;
  data?: TData;
  error?: {
    code?: string;
    message?: string;
  };
}

interface HermesRepoLocalSendFilePayload {
  file_path: string;
  sender_id?: string;
}

interface HermesRepoLocalReminderPayload {
  due_at_iso: string;
  text: string;
  workspace_root: string;
  sender_id?: string;
}

interface HermesRepoLocalSyncCheckinCronPlanPayload {
  due_at_iso: string;
  env?: Record<string, string>;
  name: string;
  prompt: string;
  role: "guard" | "recovery" | "wake";
  script?: string;
  sender_id: string;
  target_key: string;
  workspace_root: string;
  wrap_response?: boolean;
}

interface HermesRepoLocalSyncCheckinCronPayload {
  plans?: HermesRepoLocalSyncCheckinCronPlanPayload[];
  due_at_iso?: string;
  env?: Record<string, string>;
  name?: string;
  prompt?: string;
  role?: "guard" | "recovery" | "wake";
  script?: string;
  sender_id: string;
  target_key: string;
  workspace_root: string;
  wrap_response?: boolean;
}

interface HermesRepoLocalSendFileShimResult {
  file_path?: string;
  session_key?: string;
  session_id?: string;
  origin?: {
    platform?: string;
    chat_id?: string;
    thread_id?: string;
  };
  mirrored?: boolean;
}

interface HermesRepoLocalReminderShimResult {
  job_id?: string;
  name?: string;
  deliver?: string;
  next_run_at?: string;
  session_key?: string;
  session_id?: string;
  origin?: {
    platform?: string;
    chat_id?: string;
    thread_id?: string;
  };
}

interface HermesRepoLocalSyncCheckinCronShimResult {
  deliver?: string;
  jobs?: unknown;
  removed_job_ids?: unknown;
  session_id?: string;
  session_key?: string;
  origin?: {
    platform?: string;
    chat_id?: string;
    thread_id?: string;
  };
  created?: unknown;
  job_id?: string;
  name?: string;
  next_run_at?: string;
}

interface HermesRepoLocalInvocation {
  action: "create_reminder" | "send_file" | "sync_checkin_cron";
  hermes_home: string;
  payload: HermesRepoLocalReminderPayload | HermesRepoLocalSendFilePayload | HermesRepoLocalSyncCheckinCronPayload;
  repo_root: string;
  session_key?: string;
}

interface HermesRepoLocalStoredSession {
  chatId: string;
  sessionKey: string;
  threadId: string;
  userId: string;
}

export interface PythonInvocation {
  command: string;
  argsPrefix: string[];
}

interface ResolvePythonInvocationOptions {
  platform?: NodeJS.Platform;
  resolveCommandOnPathImpl?: (command: string) => string;
  isUsablePythonInvocation?: (invocation: PythonInvocation) => boolean;
}

export interface HermesRepoLocalConfigInput {
  hermesHome?: unknown;
  hermesRepoRoot?: unknown;
  hermesRepoLocalShimPath?: unknown;
  hermesPythonCommand?: unknown;
  CODEKSEI_HERMES_HOME?: unknown;
  CODEKSEI_HERMES_REPO_ROOT?: unknown;
  CODEKSEI_HERMES_REPO_LOCAL_SHIM_PATH?: unknown;
  CODEKSEI_HERMES_PYTHON_COMMAND?: unknown;
}

export function resolveHermesHomePath(config: HermesRepoLocalConfigInput = {}): string {
  return normalizeText(config.hermesHome || config.CODEKSEI_HERMES_HOME || process.env.HERMES_HOME)
    || path.join(os.homedir(), ".hermes");
}

export function resolveHermesRepoRoot(config: HermesRepoLocalConfigInput = {}): string {
  const explicit = normalizeText(config.hermesRepoRoot || config.CODEKSEI_HERMES_REPO_ROOT);
  if (explicit) {
    return path.resolve(explicit);
  }
  const packageRoot = resolvePackageRoot(__dirname);
  return path.resolve(packageRoot, "..", "hermes-agent");
}

export function resolveHermesRepoLocalShimPath(config: HermesRepoLocalConfigInput = {}): string {
  const explicit = normalizeText(config.hermesRepoLocalShimPath || config.CODEKSEI_HERMES_REPO_LOCAL_SHIM_PATH);
  if (explicit) {
    return path.resolve(explicit);
  }
  const packageRoot = resolvePackageRoot(__dirname);
  return path.join(packageRoot, "tools", "hermes_repo_local", "bridge.py");
}

export function collectHermesRepoLocalReport(config: HermesRepoLocalConfigInput = {}): HermesRepoLocalReport {
  const repoRoot = resolveHermesRepoRoot(config);
  const shimPath = resolveHermesRepoLocalShimPath(config);
  const sessionsIndexPath = path.join(resolveHermesHomePath(config), "sessions", "sessions.json");
  const exists = fs.existsSync(repoRoot);
  const weixinAdapterPath = path.join(repoRoot, "gateway", "platforms", "weixin.py");
  const deliveryPath = path.join(repoRoot, "gateway", "delivery.py");
  const cronJobsPath = path.join(repoRoot, "cron", "jobs.py");
  const cronSchedulerPath = path.join(repoRoot, "cron", "scheduler.py");
  const sessionContextPath = path.join(repoRoot, "gateway", "session_context.py");
  const weixinAdapterFound = fs.existsSync(weixinAdapterPath);
  const deliveryFound = fs.existsSync(deliveryPath);
  const cronFound = fs.existsSync(cronJobsPath) && fs.existsSync(cronSchedulerPath);
  const sessionContextMode = resolveSessionContextMode(sessionContextPath);
  const shimExists = fs.existsSync(shimPath);
  const commit = exists ? readHermesRepoCommit(repoRoot) : "";
  const missing: string[] = [];
  if (!exists) {
    missing.push("repo_root");
  }
  if (!weixinAdapterFound) {
    missing.push("gateway/platforms/weixin.py");
  }
  if (!deliveryFound) {
    missing.push("gateway/delivery.py");
  }
  if (!cronFound) {
    missing.push("cron/jobs.py|cron/scheduler.py");
  }
  if (sessionContextMode !== "contextvars") {
    missing.push("gateway/session_context.py");
  }
  if (!shimExists) {
    missing.push("codeksei-shim");
  }
  const ready = missing.length === 0;
  return {
    repoRoot,
    exists,
    commit,
    weixinAdapterFound,
    deliveryFound,
    cronFound,
    sessionContextMode,
    sessionsIndexPath,
    shimPath,
    shimExists,
    ready,
    missing,
    reason: ready ? "" : `missing: ${missing.join(", ")}`,
  };
}

export function sendFileViaHermesRepoLocal(
  config: HermesRepoLocalConfigInput,
  payload: HermesRepoLocalSendFilePayload,
): HermesRepoLocalSendFileResult {
  const hermesHome = resolveHermesHomePath(config);
  const data = invokeHermesRepoLocalBridge<HermesRepoLocalSendFileShimResult>(config, {
    action: "send_file",
    hermes_home: hermesHome,
    payload,
    repo_root: resolveHermesRepoRoot(config),
    session_key: resolveHermesRepoLocalSessionKey(config, payload, hermesHome),
  });
  return {
    filePath: normalizeText(data.file_path) || normalizeText(payload.file_path),
    platform: normalizeText(data.origin?.platform) || "weixin",
    chatId: normalizeText(data.origin?.chat_id),
    threadId: normalizeText(data.origin?.thread_id),
    sessionId: normalizeText(data.session_id),
    sessionKey: normalizeText(data.session_key),
    mirrored: Boolean(data.mirrored),
  };
}

export function createReminderViaHermesRepoLocal(
  config: HermesRepoLocalConfigInput,
  payload: HermesRepoLocalReminderPayload,
): HermesRepoLocalReminderResult {
  const hermesHome = resolveHermesHomePath(config);
  const data = invokeHermesRepoLocalBridge<HermesRepoLocalReminderShimResult>(config, {
    action: "create_reminder",
    hermes_home: hermesHome,
    payload,
    repo_root: resolveHermesRepoRoot(config),
    session_key: resolveHermesRepoLocalSessionKey(config, payload, hermesHome),
  });
  return {
    jobId: normalizeText(data.job_id),
    name: normalizeText(data.name),
    deliver: normalizeText(data.deliver) || "origin",
    nextRunAt: normalizeText(data.next_run_at),
    sessionId: normalizeText(data.session_id),
    sessionKey: normalizeText(data.session_key),
    platform: normalizeText(data.origin?.platform) || "weixin",
    chatId: normalizeText(data.origin?.chat_id),
    threadId: normalizeText(data.origin?.thread_id),
  };
}

export function syncCheckinCronViaHermesRepoLocal(
  config: HermesRepoLocalConfigInput,
  payload: HermesRepoLocalSyncCheckinCronPayload,
): HermesRepoLocalSyncCheckinCronResult {
  const normalizedPayload = ensureContextScriptForSyncPayload(config, payload);
  const hermesHome = resolveHermesHomePath(config);
  const data = invokeHermesRepoLocalBridge<HermesRepoLocalSyncCheckinCronShimResult>(config, {
    action: "sync_checkin_cron",
    hermes_home: hermesHome,
    payload: normalizedPayload,
    repo_root: resolveHermesRepoRoot(config),
    session_key: resolveHermesRepoLocalSessionKey(config, normalizedPayload, hermesHome),
  });
  return {
    chatId: normalizeText(data.origin?.chat_id),
    deliver: normalizeText(data.deliver) || "origin",
    jobs: normalizeSyncCheckinCronJobs(data, payload),
    platform: normalizeText(data.origin?.platform) || "weixin",
    removedJobIds: normalizeStringList(data.removed_job_ids),
    sessionId: normalizeText(data.session_id),
    sessionKey: normalizeText(data.session_key),
    threadId: normalizeText(data.origin?.thread_id),
  };
}

function resolveHermesRepoLocalSessionKey(
  config: HermesRepoLocalConfigInput,
  payload: HermesRepoLocalReminderPayload | HermesRepoLocalSendFilePayload | HermesRepoLocalSyncCheckinCronPayload,
  hermesHome = resolveHermesHomePath(config),
): string {
  const explicit = normalizeText(process.env.HERMES_SESSION_KEY);
  if (explicit) {
    return explicit;
  }
  const senderId = resolveHermesRepoLocalPayloadSenderId(payload);
  const sessions = readHermesRepoLocalSessions(hermesHome);
  const matched = senderId
    ? sessions.filter((session) => (
      session.sessionKey === senderId
      || session.chatId === senderId
      || session.userId === senderId
      || session.threadId === senderId
    ))
    : sessions;
  if (matched.length === 1) {
    return matched[0]?.sessionKey || "";
  }
  if (senderId && sessions.length === 1) {
    return sessions[0]?.sessionKey || "";
  }
  if (hasHermesOriginEnvFallback()) {
    return "";
  }
  const sessionsPath = path.join(hermesHome, "sessions", "sessions.json");
  if (matched.length > 1) {
    throw new Error(
      `Hermes repo-local session 不唯一：sender=${senderId || "(missing)"} 命中 ${matched.length} 个 session；请显式设置 HERMES_SESSION_KEY。`
    );
  }
  if (senderId) {
    throw new Error(
      `Hermes repo-local 找不到 sender=${senderId} 对应 session；请先让 Hermes 收到该用户一条消息，或显式设置 HERMES_SESSION_KEY。sessions=${sessionsPath}`
    );
  }
  throw new Error(
    `Hermes repo-local 缺少 origin context；请显式设置 HERMES_SESSION_KEY，或提供 HERMES_SESSION_CHAT_ID/HERMES_SESSION_PLATFORM。sessions=${sessionsPath}`
  );
}

function resolveHermesRepoLocalPayloadSenderId(
  payload: HermesRepoLocalReminderPayload | HermesRepoLocalSendFilePayload | HermesRepoLocalSyncCheckinCronPayload,
): string {
  const direct = normalizeText(payload.sender_id);
  if (direct) {
    return direct;
  }
  if ("plans" in payload && Array.isArray(payload.plans)) {
    for (const plan of payload.plans) {
      const senderId = normalizeText(plan?.sender_id);
      if (senderId) {
        return senderId;
      }
    }
  }
  return "";
}

function readHermesRepoLocalSessions(hermesHome: string): HermesRepoLocalStoredSession[] {
  const sessionsPath = path.join(hermesHome, "sessions", "sessions.json");
  if (!fs.existsSync(sessionsPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
    return normalizeHermesRepoLocalSessions(parsed);
  } catch {
    return [];
  }
}

function normalizeHermesRepoLocalSessions(value: unknown): HermesRepoLocalStoredSession[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeHermesRepoLocalSession(entry, ""))
      .filter((entry): entry is HermesRepoLocalStoredSession => Boolean(entry));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const nestedSessions = record.sessions;
  if (Array.isArray(nestedSessions)) {
    return normalizeHermesRepoLocalSessions(nestedSessions);
  }
  if (nestedSessions && typeof nestedSessions === "object") {
    return normalizeHermesRepoLocalSessions(nestedSessions);
  }
  return Object.entries(record)
    .map(([key, entry]) => normalizeHermesRepoLocalSession(entry, key))
    .filter((entry): entry is HermesRepoLocalStoredSession => Boolean(entry));
}

function normalizeHermesRepoLocalSession(value: unknown, fallbackKey: string): HermesRepoLocalStoredSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const origin = (record.origin && typeof record.origin === "object" && !Array.isArray(record.origin))
    ? record.origin as Record<string, unknown>
    : {};
  const sessionKey = normalizeText(record.session_key || record.sessionKey || record.key || fallbackKey);
  if (!sessionKey) {
    return null;
  }
  return {
    chatId: normalizeText(origin.chat_id || origin.chatId || record.chat_id || record.chatId),
    sessionKey,
    threadId: normalizeText(origin.thread_id || origin.threadId || record.thread_id || record.threadId),
    userId: normalizeText(origin.user_id || origin.userId || record.user_id || record.userId),
  };
}

function hasHermesOriginEnvFallback(): boolean {
  return Boolean(
    normalizeText(process.env.HERMES_SESSION_CHAT_ID)
    && normalizeText(process.env.HERMES_SESSION_PLATFORM),
  );
}

function ensureContextScriptForSyncPayload(
  config: HermesRepoLocalConfigInput,
  payload: HermesRepoLocalSyncCheckinCronPayload,
): HermesRepoLocalSyncCheckinCronPayload {
  const scriptPath = ensureHermesContextBriefingScript(config);
  const hostedCheckinScriptPath = resolveHermesHostedCheckinScriptPath(config);
  if (Array.isArray(payload.plans) && payload.plans.length > 0) {
    return {
      ...payload,
      plans: payload.plans.map((plan) => ({
        ...plan,
        script: resolveManagedScriptPath({
          fallbackScriptPath: scriptPath,
          hostedCheckinScriptPath,
          planScriptPath: normalizeText(plan.script),
          config,
        }),
      })),
    };
  }
  return {
    ...payload,
    script: resolveManagedScriptPath({
      fallbackScriptPath: scriptPath,
      hostedCheckinScriptPath,
      planScriptPath: normalizeText(payload.script),
      config,
    }),
  };
}

function resolveManagedScriptPath({
  config,
  fallbackScriptPath,
  hostedCheckinScriptPath,
  planScriptPath,
}: {
  config: HermesRepoLocalConfigInput;
  fallbackScriptPath: string;
  hostedCheckinScriptPath: string;
  planScriptPath: string;
}): string {
  if (planScriptPath) {
    if (normalizeText(planScriptPath) === normalizeText(hostedCheckinScriptPath)) {
      return ensureHermesHostedCheckinScript(config);
    }
    return planScriptPath;
  }
  return fallbackScriptPath;
}

function invokeHermesRepoLocalBridge<TData>(
  config: HermesRepoLocalConfigInput,
  request: HermesRepoLocalInvocation,
): TData {
  const report = collectHermesRepoLocalReport(config);
  if (!report.ready) {
    throw new Error(
      `Hermes repo-local integration unavailable: ${report.reason || "repo-local prerequisites missing"}`
    );
  }
  const shimPath = resolveHermesRepoLocalShimPath(config);
  const pythonInvocation = resolvePythonInvocation(config);
  const env = buildHermesRepoLocalEnv({
    hermesHome: resolveHermesHomePath(config),
    repoRoot: resolveHermesRepoRoot(config),
  });
  const args = [...pythonInvocation.argsPrefix, shimPath];
  const useShell = process.platform === "win32" && /\.(cmd|bat)$/iu.test(pythonInvocation.command);
  const result = spawnSync(pythonInvocation.command, args, {
    cwd: resolveHermesRepoRoot(config),
    encoding: "utf8",
    env,
    input: JSON.stringify(request),
    shell: useShell,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60_000,
    windowsHide: true,
  });
  const stdout = normalizeBridgeOutput(result.stdout);
  const stderr = normalizeBridgeOutput(result.stderr || result.error?.message || "");
  if (result.error) {
    throw new Error(`Hermes repo-local bridge failed: ${result.error.message}`);
  }
  let envelope: HermesRepoLocalEnvelope<TData> | null = null;
  try {
    envelope = JSON.parse(stdout || "{}") as HermesRepoLocalEnvelope<TData>;
  } catch {
    throw new Error(`Hermes repo-local bridge returned invalid JSON: ${stderr || stdout || "empty output"}`);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    const message = normalizeText(envelope?.error?.message) || stderr || `exit ${result.status}`;
    throw new Error(`Hermes repo-local bridge failed: ${message}`);
  }
  if (!envelope?.ok || !envelope.data) {
    const message = normalizeText(envelope?.error?.message) || stderr || "unknown bridge error";
    throw new Error(`Hermes repo-local bridge failed: ${message}`);
  }
  return envelope.data;
}

function resolveSessionContextMode(sessionContextPath: string): HermesRepoLocalSessionContextMode {
  if (!fs.existsSync(sessionContextPath)) {
    return "missing";
  }
  try {
    const content = fs.readFileSync(sessionContextPath, "utf8");
    if (/ContextVar/u.test(content) || /contextvars/u.test(content)) {
      return "contextvars";
    }
    return "legacy_env";
  } catch {
    return "missing";
  }
}

function readHermesRepoCommit(repoRoot: string): string {
  const result = captureSubprocess("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    cwd: repoRoot,
    timeoutMs: 15_000,
  });
  return result.ok ? normalizeText(result.stdout) : "";
}

export function resolveHermesRepoLocalPythonInvocation(
  config: HermesRepoLocalConfigInput = {},
  {
    platform = process.platform,
    resolveCommandOnPathImpl = resolveCommandOnPath,
    isUsablePythonInvocation = isUsablePython3Invocation,
  }: ResolvePythonInvocationOptions = {},
): PythonInvocation {
  const explicit = normalizeText(config.hermesPythonCommand || config.CODEKSEI_HERMES_PYTHON_COMMAND);
  if (explicit) {
    return resolveExplicitPythonInvocation(explicit, resolveCommandOnPathImpl);
  }

  const candidates = platform === "win32"
    ? [
      { command: "python", argsPrefix: [] },
      { command: "py", argsPrefix: ["-3"] },
      { command: "python3", argsPrefix: [] },
    ]
    : [
      { command: "python3", argsPrefix: [] },
      { command: "python", argsPrefix: [] },
      { command: "py", argsPrefix: ["-3"] },
    ];
  for (const candidate of candidates) {
    const resolvedCommand = resolveCommandOnPathImpl(candidate.command);
    if (!resolvedCommand) {
      continue;
    }
    const invocation = {
      command: resolvedCommand,
      argsPrefix: [...candidate.argsPrefix],
    };
    if (isUsablePythonInvocation(invocation)) {
      return invocation;
    }
  }
  return platform === "win32"
    ? { command: "python", argsPrefix: [] }
    : { command: "python3", argsPrefix: [] };
}

function resolvePythonInvocation(config: HermesRepoLocalConfigInput): PythonInvocation {
  return resolveHermesRepoLocalPythonInvocation(config);
}

function resolveExplicitPythonInvocation(
  explicit: string,
  resolveCommandOnPathImpl: (command: string) => string,
): PythonInvocation {
  const resolved = resolveCommandOnPathImpl(explicit) || explicit;
  const basename = path.basename(resolved).toLowerCase();
  return basename === "py" || basename === "py.exe"
    ? { command: resolved, argsPrefix: ["-3"] }
    : { command: resolved, argsPrefix: [] };
}

function isUsablePython3Invocation(invocation: PythonInvocation): boolean {
  const useShell = process.platform === "win32" && /\.(cmd|bat)$/iu.test(invocation.command);
  const result = spawnSync(invocation.command, [...invocation.argsPrefix, "--version"], {
    encoding: "utf8",
    shell: useShell,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
    windowsHide: true,
  });
  const output = `${normalizeText(result.stdout)} ${normalizeText(result.stderr)}`.trim();
  return typeof result.status === "number" && result.status === 0 && /^Python\s+3\./iu.test(output);
}

export function buildHermesRepoLocalEnv({
  hermesHome,
  repoRoot,
}: {
  hermesHome: string;
  repoRoot: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };
  const shellPythonPath = normalizeText(env.PYTHONPATH);
  const hermesEnvPath = path.join(hermesHome, ".env");
  if (fs.existsSync(hermesEnvPath)) {
    // Mirror Hermes CLI behavior so repo-local bridge flows can see platform
    // credentials/config even when Codeksei is launched from a plain shell.
    dotenv.config({
      path: hermesEnvPath,
      processEnv: env as Record<string, string>,
      override: true,
    });
  }
  // Repo-local invocations must keep their explicit repo/home wiring even when
  // Hermes home .env overrides stale shell exports for secrets and platform
  // credentials. Do not let .env replace these two bridge-critical values.
  env.HERMES_HOME = hermesHome;
  env.PYTHONPATH = shellPythonPath ? `${repoRoot}${path.delimiter}${shellPythonPath}` : repoRoot;
  // Codeksei sends UTF-8 JSON over stdin/stdout to the repo-local Python shim.
  // Windows runners can otherwise decode Chinese reminder/checkin payloads with
  // a legacy code page and fail before the bridge handles the request.
  if (!normalizeText(env.PYTHONIOENCODING)) {
    env.PYTHONIOENCODING = "utf-8";
  }
  if (!normalizeText(env.PYTHONUTF8)) {
    env.PYTHONUTF8 = "1";
  }
  return env;
}

function normalizeBridgeOutput(value: unknown): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function normalizeSyncCheckinCronJobs(
  data: HermesRepoLocalSyncCheckinCronShimResult,
  payload: HermesRepoLocalSyncCheckinCronPayload,
): HermesRepoLocalSyncCheckinCronJobResult[] {
  const normalizedFromJobs = Array.isArray(data.jobs)
    ? data.jobs
      .map((job) => normalizeSyncCheckinCronJob(job))
      .filter((job): job is HermesRepoLocalSyncCheckinCronJobResult => Boolean(job))
    : [];
  if (normalizedFromJobs.length > 0) {
    return normalizedFromJobs;
  }

  const legacyPlan = payload.plans?.[0] || payload;
  const legacyJob = normalizeSyncCheckinCronJob({
    created: data.created,
    deliver: data.deliver,
    job_id: data.job_id,
    name: data.name || legacyPlan.name,
    next_run_at: data.next_run_at || legacyPlan.due_at_iso,
    role: "role" in legacyPlan ? legacyPlan.role : payload.role,
  });
  return legacyJob ? [legacyJob] : [];
}

function normalizeSyncCheckinCronJob(value: unknown): HermesRepoLocalSyncCheckinCronJobResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const role = normalizeSyncCheckinCronRole(source.role);
  const jobId = normalizeText(source.job_id);
  const name = normalizeText(source.name);
  const nextRunAt = normalizeText(source.next_run_at);
  if (!role || !jobId || !name || !nextRunAt) {
    return null;
  }
  return {
    created: Boolean(source.created),
    deliver: normalizeText(source.deliver) || "origin",
    jobId,
    name,
    nextRunAt,
    role,
  };
}

function normalizeSyncCheckinCronRole(value: unknown): "guard" | "recovery" | "wake" | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "wake" || normalized === "recovery" || normalized === "guard") {
    return normalized;
  }
  return "";
}
