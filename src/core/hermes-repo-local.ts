import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import * as dotenv from "dotenv";

import { resolvePackageRoot } from "../contracts/path-utils";
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
  created: boolean;
  deliver: string;
  jobId: string;
  name: string;
  nextRunAt: string;
  platform: string;
  removedJobIds: string[];
  role: "recovery" | "wake";
  sessionId: string;
  sessionKey: string;
  threadId: string;
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

interface HermesRepoLocalSyncCheckinCronPayload {
  due_at_iso: string;
  name: string;
  prompt: string;
  role: "recovery" | "wake";
  sender_id: string;
  target_key: string;
  workspace_root: string;
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
  created?: unknown;
  deliver?: string;
  job_id?: string;
  name?: string;
  next_run_at?: string;
  removed_job_ids?: unknown;
  session_id?: string;
  session_key?: string;
  origin?: {
    platform?: string;
    chat_id?: string;
    thread_id?: string;
  };
}

interface HermesRepoLocalInvocation {
  action: "create_reminder" | "send_file" | "sync_checkin_cron";
  hermes_home: string;
  payload: HermesRepoLocalReminderPayload | HermesRepoLocalSendFilePayload | HermesRepoLocalSyncCheckinCronPayload;
  repo_root: string;
  session_key?: string;
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
  const data = invokeHermesRepoLocalBridge<HermesRepoLocalSendFileShimResult>(config, {
    action: "send_file",
    hermes_home: resolveHermesHomePath(config),
    payload,
    repo_root: resolveHermesRepoRoot(config),
    session_key: normalizeText(process.env.HERMES_SESSION_KEY),
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
  const data = invokeHermesRepoLocalBridge<HermesRepoLocalReminderShimResult>(config, {
    action: "create_reminder",
    hermes_home: resolveHermesHomePath(config),
    payload,
    repo_root: resolveHermesRepoRoot(config),
    session_key: normalizeText(process.env.HERMES_SESSION_KEY),
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
  const data = invokeHermesRepoLocalBridge<HermesRepoLocalSyncCheckinCronShimResult>(config, {
    action: "sync_checkin_cron",
    hermes_home: resolveHermesHomePath(config),
    payload,
    repo_root: resolveHermesRepoRoot(config),
    session_key: normalizeText(process.env.HERMES_SESSION_KEY),
  });
  return {
    chatId: normalizeText(data.origin?.chat_id),
    created: Boolean(data.created),
    deliver: normalizeText(data.deliver) || "origin",
    jobId: normalizeText(data.job_id),
    name: normalizeText(data.name) || normalizeText(payload.name),
    nextRunAt: normalizeText(data.next_run_at) || normalizeText(payload.due_at_iso),
    platform: normalizeText(data.origin?.platform) || "weixin",
    removedJobIds: normalizeStringList(data.removed_job_ids),
    role: payload.role,
    sessionId: normalizeText(data.session_id),
    sessionKey: normalizeText(data.session_key),
    threadId: normalizeText(data.origin?.thread_id),
  };
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

function resolvePythonInvocation(config: HermesRepoLocalConfigInput): {
  command: string;
  argsPrefix: string[];
} {
  const explicit = normalizeText(config.hermesPythonCommand || config.CODEKSEI_HERMES_PYTHON_COMMAND);
  if (explicit) {
    return {
      command: resolveCommandOnPath(explicit) || explicit,
      argsPrefix: [],
    };
  }
  const python = resolveCommandOnPath("python");
  if (python) {
    return { command: python, argsPrefix: [] };
  }
  const python3 = resolveCommandOnPath("python3");
  if (python3) {
    return { command: python3, argsPrefix: [] };
  }
  const pyLauncher = resolveCommandOnPath("py");
  if (pyLauncher) {
    return { command: pyLauncher, argsPrefix: ["-3"] };
  }
  return { command: "python", argsPrefix: [] };
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
