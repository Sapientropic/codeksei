import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { resolveRuntimeEntrypointAbsolute } from "../contracts/runtime-entrypoints";
import type { AppRuntimeConfig } from "./app-service-contract";
import { buildContextBriefingJobEnv, resolveHermesHostedCheckinScriptPath } from "../context/briefing-script";
import {
  CHECKIN_ACTIVE_WAKE_TIMEOUT_MS,
  buildCheckinTargetKey,
  type CheckinResolvedTarget,
  type CheckinTickResult,
} from "../checkin";
import { resolveHostMode } from "./host-mode";
import { resolveHermesHomePath } from "./hermes-repo-local";
import { resolvePackageRoot } from "./path-utils";
import { DEFAULT_CHECKIN_MAX_INTERVAL_MS, resolveCheckinConfig } from "../state/checkin-config";
import { normalizeText } from "./text-normalization";

export type HostedCheckinCronRole = "guard" | "recovery" | "wake";

export interface HostedCheckinCronSyncJobPlan {
  env: Record<string, string>;
  name: string;
  plannedWakeAt: string;
  prompt: string;
  role: HostedCheckinCronRole;
  schedule: string;
  script: string;
  senderId: string;
  targetKey: string;
  workspaceRoot: string;
}

export interface HostedCheckinCronSyncPlanSet {
  jobs: HostedCheckinCronSyncJobPlan[];
  senderId: string;
  targetKey: string;
  workspaceRoot: string;
}

export interface HostedCheckinManagedJob {
  enabled: boolean;
  jobId: string;
  name: string;
  nextRunAt: string;
  role: HostedCheckinCronRole;
  state: string;
  targetKey: string;
}

export interface HostedCheckinCronSummary {
  duplicateCount: number;
  drifted: boolean;
  futureJobs: HostedCheckinManagedJob[];
  guardJobs: HostedCheckinManagedJob[];
  nextPlannedWakeAt: string;
  recoveryJobs: HostedCheckinManagedJob[];
  targetKey: string;
  wakeJobs: HostedCheckinManagedJob[];
}

interface RawCronJob extends Record<string, unknown> {
  codeksei_checkin_role?: unknown;
  codeksei_checkin_target_key?: unknown;
  enabled?: unknown;
  id?: unknown;
  name?: unknown;
  next_run_at?: unknown;
  state?: unknown;
}

export type HostedCheckinConfig = Pick<
  AppRuntimeConfig,
  | "channel"
  | "channelProvider"
  | "checkinConfigFile"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "runtime"
  | "userName"
  | "workspaceRoot"
>;

export function collectHostedCheckinCronSummary(
  config: Partial<HostedCheckinConfig>,
  target: Pick<CheckinResolvedTarget, "senderId" | "workspaceRoot">,
  {
    nowMs = Date.now(),
  }: {
    nowMs?: number;
  } = {},
): HostedCheckinCronSummary {
  const targetKey = buildCheckinTargetKey(target);
  const jobsFile = path.join(resolveHermesHomePath(config), "cron", "jobs.json");
  const allJobs = readManagedCronJobs(jobsFile);
  const toleranceMs = 1_000;
  const futureJobs = allJobs.filter((job) => (
    job.targetKey === targetKey
    && job.nextRunAt
    && Date.parse(job.nextRunAt) >= nowMs - toleranceMs
  ));
  const guardJobs = futureJobs.filter((job) => job.role === "guard");
  const wakeJobs = futureJobs.filter((job) => job.role === "wake");
  const recoveryJobs = futureJobs.filter((job) => job.role === "recovery");
  const nextPlannedWakeAt = [...futureJobs]
    .sort((left, right) => Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt))[0]?.nextRunAt || "";
  const duplicateCount = Math.max(0, wakeJobs.length - 1)
    + Math.max(0, recoveryJobs.length - 1)
    + Math.max(0, guardJobs.length - 1);
  return {
    duplicateCount,
    drifted: duplicateCount > 0,
    futureJobs,
    guardJobs,
    nextPlannedWakeAt,
    recoveryJobs,
    targetKey,
    wakeJobs,
  };
}

export function createHostedCheckinCronPlanSetFromTick(
  config: Partial<HostedCheckinConfig>,
  target: CheckinResolvedTarget,
  tick: CheckinTickResult,
  {
    followupContext = "",
    nowMs = Date.now(),
  }: {
    followupContext?: string;
    nowMs?: number;
  } = {},
): HostedCheckinCronSyncPlanSet {
  const guardDelayMs = resolveHostedCheckinGuardDelayMs(config);
  const pendingHandoffWakeAt = normalizeText(tick.state.pendingHandoff?.handoffExpiresAt);
  if (pendingHandoffWakeAt) {
    return createHostedCheckinWakePlanSet(config, target, {
      followupContext: followupContext || normalizeText(tick.state.pendingHandoff?.followupContext),
      plannedWakeAt: pendingHandoffWakeAt,
    });
  }
  switch (tick.status) {
    case "due":
      return createHostedCheckinWakePlanSet(config, target, {
        followupContext,
        plannedWakeAt: new Date(nowMs).toISOString(),
      });
    case "in_progress": {
      const startedAtMs = Date.parse(normalizeText(tick.activeWake?.startedAt));
      if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
        throw new Error("当前 active wake 缺少 startedAt，无法创建 recovery one-shot job");
      }
      return createHostedCheckinPlanSet(config, target, {
        jobs: [
          {
            plannedWakeAt: new Date(startedAtMs + CHECKIN_ACTIVE_WAKE_TIMEOUT_MS).toISOString(),
            role: "recovery",
          },
          {
            plannedWakeAt: new Date(startedAtMs + guardDelayMs).toISOString(),
            role: "guard",
          },
        ],
      });
    }
    case "scheduled":
    default: {
      const plannedWakeAt = normalizeText(tick.nextWakeAt);
      if (!plannedWakeAt) {
        throw new Error("当前没有 nextWakeAt，无法同步 Hermes hosted checkin wake job");
      }
      return createHostedCheckinWakePlanSet(config, target, {
        followupContext,
        plannedWakeAt,
      });
    }
  }
}

export function createHostedCheckinWakePlanSet(
  config: Partial<HostedCheckinConfig>,
  target: CheckinResolvedTarget,
  {
    followupContext = "",
    plannedWakeAt,
  }: {
    followupContext?: string;
    plannedWakeAt: string;
  },
): HostedCheckinCronSyncPlanSet {
  const normalizedWakeAt = normalizeText(plannedWakeAt);
  if (!normalizedWakeAt) {
    throw new Error("缺少 nextWakeAt，无法创建 hosted wake one-shot job");
  }
  const recoveryWakeAt = buildRecoveryWakeAtIso(normalizedWakeAt);
  const guardWakeAt = buildGuardWakeAtIso(config, normalizedWakeAt);
  return createHostedCheckinPlanSet(config, target, {
    jobs: [
      {
        followupContext,
        plannedWakeAt: normalizedWakeAt,
        role: "wake",
      },
      {
        followupContext,
        plannedWakeAt: recoveryWakeAt,
        role: "recovery",
      },
      {
        followupContext,
        plannedWakeAt: guardWakeAt,
        role: "guard",
      },
    ],
  });
}

function createHostedCheckinPlanSet(
  config: Partial<HostedCheckinConfig>,
  target: CheckinResolvedTarget,
  {
    jobs,
  }: {
    jobs: Array<{
      followupContext?: string;
      plannedWakeAt: string;
      role: HostedCheckinCronRole;
    }>;
  },
): HostedCheckinCronSyncPlanSet {
  const targetKey = buildCheckinTargetKey(target);
  return {
    jobs: jobs.map((job) => createHostedCheckinCronPlan(config, target, targetKey, job)),
    senderId: target.senderId,
    targetKey,
    workspaceRoot: target.workspaceRoot,
  };
}

function createHostedCheckinCronPlan(
  config: Partial<HostedCheckinConfig>,
  target: CheckinResolvedTarget,
  targetKey: string,
  {
    followupContext = "",
    plannedWakeAt,
    role,
  }: {
    followupContext?: string;
    plannedWakeAt: string;
    role: HostedCheckinCronRole;
  },
): HostedCheckinCronSyncJobPlan {
  const normalizedWakeAt = normalizeIsoTimestamp(plannedWakeAt);
  if (!plannedWakeAt) {
    throw new Error("缺少 nextWakeAt，无法创建 hosted wake one-shot job");
  }
  if (!normalizedWakeAt) {
    throw new Error(`非法的 hosted checkin wake 时间：${plannedWakeAt}`);
  }
  // Codeksei decides which hosted wake/recovery/guard job set should exist. Hermes
  // only persists that schedule plus origin metadata so runtime delivery can
  // use the stored job.origin target without re-discovering a live session
  // later.
  return {
    env: buildHostedCheckinCronEnv(config, target),
    name: buildHostedCheckinJobName(targetKey, role),
    plannedWakeAt: normalizedWakeAt,
    prompt: buildHostedCheckinCronPrompt(config, target, { followupContext }),
    role,
    schedule: normalizedWakeAt,
    script: resolveHermesHostedCheckinScriptPath(config),
    senderId: target.senderId,
    targetKey,
    workspaceRoot: target.workspaceRoot,
  };
}

function buildHostedCheckinCronPrompt(
  config: Partial<HostedCheckinConfig>,
  target: CheckinResolvedTarget,
  {
    followupContext = "",
  }: {
    followupContext?: string;
  } = {},
): string {
  const createHandoff = buildHostedCheckinCliCommand(target.workspaceRoot, [
    "host",
    "settle-checkin",
    "--provider",
    "hermes",
    "--user",
    target.senderId,
    "--workspace",
    target.workspaceRoot,
    "--lease",
    "<leaseId>",
    "--create-handoff",
    "--result",
    "<sent_message|silent|backstage_only>",
  ]);
  return [
    "[SYSTEM: You are running one Codeksei hosted proactive child pass on Hermes.]",
    "[SYSTEM: Your job is not to own the long-term schedule. Your job is to recover the user's current state, decide whether one short message is appropriate, and leave a structured handoff for the main session.]",
    "[SYSTEM: Do not create cron jobs yourself. Do not call codeksei start/shared:start/shared:watchdog. The attached codeksei-companion skill is the only companion workflow surface you should rely on.]",
    "[SYSTEM: The Script Output block already contains the claimed lease, current context board, and default bookkeeping priorities. Treat it as the current-state handoff.]",
    ...(followupContext
      ? [
        "[SYSTEM: Additional internal follow-up context is provided below. Use it only as internal context for this proactive pass. Do not quote it verbatim to the user or expose internal planning.]",
        "",
        "Internal follow-up context:",
        followupContext,
      ]
      : []),
    "",
    "1. Read the Script Output block first.",
    "   - If it says claim_status: idle or in_progress, respond with exactly SILENT.",
    "   - If it says claim_status: claimed, continue with this proactive pass.",
    "2. Your default goal is to avoid losing track of the user.",
    "   - If you do not know whether they are still on the same line, prefer one short check-in question over guessing.",
    "   - SILENT is only for clearly bad moments to interrupt, not as a default escape hatch.",
    "3. Keep the user-visible part short and natural, like one WeChat line, not a mini-essay.",
    "4. Even if you stay silent, decide whether this round still deserves continuity work.",
    "   - If you already know the current time block / cutover / project state / support correction, default to recording it through timeline / diary / project note / companion memory / review instead of leaving it only in chat.",
    "5. Before you finish, you must execute exactly one handoff command to persist what you learned for the main session.",
    `   - Base command: ${createHandoff}`,
    "   - Add --message only when you actually sent a user-visible message.",
    "   - Add --observed-state with the best short summary of what the user is doing now.",
    "   - Add --followup-context with the internal carry-forward the main session should remember next.",
    "   - Repeat --bookkeeping-action with kind|done|summary or kind|suggested|summary for each continuity action you already took or think the main session should take next.",
    "6. After the handoff command succeeds, your final text response must be either SILENT or one short natural WeChat message.",
    "7. Never expose lease ids, schedule decisions, commands, job ids, or internal reasoning in the user-visible reply.",
  ].join("\n");
}

function buildRecoveryWakeAtIso(plannedWakeAt: string): string {
  const plannedWakeAtMs = Date.parse(plannedWakeAt);
  if (!Number.isFinite(plannedWakeAtMs)) {
    throw new Error(`非法的 hosted checkin wake 时间：${plannedWakeAt}`);
  }
  return new Date(plannedWakeAtMs + CHECKIN_ACTIVE_WAKE_TIMEOUT_MS).toISOString();
}

function buildGuardWakeAtIso(
  config: Partial<HostedCheckinConfig>,
  plannedWakeAt: string,
): string {
  const plannedWakeAtMs = Date.parse(plannedWakeAt);
  if (!Number.isFinite(plannedWakeAtMs)) {
    throw new Error(`非法的 hosted checkin wake 时间：${plannedWakeAt}`);
  }
  return new Date(plannedWakeAtMs + resolveHostedCheckinGuardDelayMs(config)).toISOString();
}

function buildHostedCheckinCronEnv(
  config: Partial<HostedCheckinConfig>,
  target: CheckinResolvedTarget,
): Record<string, string> {
  const env: Record<string, string> = {
    CODEKSEI_RUNTIME: "hermes",
    CODEKSEI_CHANNEL_PROVIDER: "hermes",
    CODEKSEI_CHANNEL: "weixin",
    CODEKSEI_ALLOWED_USER_IDS: target.senderId,
    CODEKSEI_CONTEXT_BRIEFING_MODE: "proactive",
    CODEKSEI_CONTEXT_BRIEFING_USER: target.senderId,
    CODEKSEI_CONTEXT_BRIEFING_WORKSPACE: target.workspaceRoot,
    CODEKSEI_WORKSPACE_ROOT: target.workspaceRoot,
  };
  Object.assign(env, buildContextBriefingJobEnv());
  const stateDir = deriveHostedCheckinStateDir(config);
  if (stateDir) {
    env.CODEKSEI_STATE_DIR = stateDir;
  }
  const userName = normalizeText(config.userName);
  if (userName) {
    env.CODEKSEI_USER_NAME = userName;
  }
  const hermesHome = normalizeText(config.hermesHome);
  if (hermesHome) {
    env.CODEKSEI_HERMES_HOME = hermesHome;
  }
  const hermesRepoRoot = normalizeText(config.hermesRepoRoot);
  if (hermesRepoRoot) {
    env.CODEKSEI_HERMES_REPO_ROOT = hermesRepoRoot;
  }
  const hermesRepoLocalShimPath = normalizeText(config.hermesRepoLocalShimPath);
  if (hermesRepoLocalShimPath) {
    env.CODEKSEI_HERMES_REPO_LOCAL_SHIM_PATH = hermesRepoLocalShimPath;
  }
  const hermesPythonCommand = normalizeText(config.hermesPythonCommand);
  if (hermesPythonCommand) {
    env.CODEKSEI_HERMES_PYTHON_COMMAND = hermesPythonCommand;
  }
  return env;
}

function buildHostedCheckinCliCommand(workspaceRoot: string, args: readonly string[]): string {
  const packageRoot = resolvePackageRoot(__dirname);
  const runtimeEntrypoint = resolveRuntimeEntrypointAbsolute(packageRoot, "cli");
  const nodeCommand = normalizeText(process.execPath) || "node";
  return [
    quoteShellArg(nodeCommand),
    quoteShellArg(runtimeEntrypoint),
    "--workspace-root",
    quoteShellArg(workspaceRoot),
    ...args.map((value) => quoteShellArg(value)),
  ].join(" ");
}

function buildHostedCheckinJobName(targetKey: string, role: HostedCheckinCronRole): string {
  const digest = crypto.createHash("sha256").update(targetKey).digest("hex").slice(0, 10);
  return `ck-checkin-${role}-${digest}`;
}

function deriveHostedCheckinStateDir(config: Partial<HostedCheckinConfig>): string {
  const checkinConfigFile = normalizeText(config.checkinConfigFile);
  return checkinConfigFile ? path.dirname(checkinConfigFile) : "";
}

function normalizeIsoTimestamp(value: unknown): string {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function quoteShellArg(value: string): string {
  return JSON.stringify(String(value));
}

function readManagedCronJobs(jobsFile: string): HostedCheckinManagedJob[] {
  if (!fs.existsSync(jobsFile)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(jobsFile, "utf8");
    const parsed = JSON.parse(raw) as { jobs?: unknown };
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    return jobs
      .map((job) => normalizeManagedCheckinJob(job))
      .filter((job): job is HostedCheckinManagedJob => Boolean(job));
  } catch {
    return [];
  }
}

function normalizeManagedCheckinJob(value: unknown): HostedCheckinManagedJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const job = value as RawCronJob;
  const role = normalizeManagedRole(job.codeksei_checkin_role);
  const targetKey = normalizeText(job.codeksei_checkin_target_key);
  const nextRunAt = normalizeIsoTimestamp(job.next_run_at);
  if (!role || !targetKey || !nextRunAt) {
    return null;
  }
  return {
    enabled: Boolean(job.enabled !== false),
    jobId: normalizeText(job.id),
    name: normalizeText(job.name),
    nextRunAt,
    role,
    state: normalizeText(job.state) || "scheduled",
    targetKey,
  };
}

function normalizeManagedRole(value: unknown): HostedCheckinCronRole | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "wake" || normalized === "recovery" || normalized === "guard") {
    return normalized;
  }
  return "";
}

function resolveHostedCheckinGuardDelayMs(config: Partial<HostedCheckinConfig>): number {
  const checkinConfigFile = normalizeText(config.checkinConfigFile);
  const configuredMaxIntervalMs = checkinConfigFile
    ? resolveCheckinConfig({ filePath: checkinConfigFile }).maxIntervalMs
    : DEFAULT_CHECKIN_MAX_INTERVAL_MS;
  // Hermes cron sessions can fail before the child even reaches claim-checkin
  // (for example 429 / connection errors). In that case the currently firing
  // wake/recovery run cannot seed its own successor, so we always keep one
  // later guard job alive as a liveness backstop.
  return Math.max(
    CHECKIN_ACTIVE_WAKE_TIMEOUT_MS * 2,
    DEFAULT_CHECKIN_MAX_INTERVAL_MS,
    configuredMaxIntervalMs,
  );
}

export function isHostedHermesCheckinEnabled(config: Partial<HostedCheckinConfig>): boolean {
  return resolveHostMode(config).mode === "hosted";
}
