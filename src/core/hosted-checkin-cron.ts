import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { resolveRuntimeEntrypointAbsolute } from "../contracts/runtime-entrypoints";
import type { AppRuntimeConfig } from "./app-service-contract";
import { buildContextBriefingJobEnv, resolveHermesContextBriefingScriptPath } from "../context/briefing-script";
import {
  CHECKIN_ACTIVE_WAKE_TIMEOUT_MS,
  buildCheckinTargetKey,
  type CheckinResolvedTarget,
  type CheckinTickResult,
} from "../checkin";
import { resolveHostMode } from "./host-mode";
import { resolveHermesHomePath } from "./hermes-repo-local";
import { resolvePackageRoot } from "./path-utils";
import { normalizeText } from "./text-normalization";
import {
  buildCheckinCompletionDurationGuidanceLines,
  CHECKIN_COMPLETION_CONTEXT_GUIDANCE,
  CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER,
} from "../checkin/completion-guidance";

export type HostedCheckinCronRole = "recovery" | "wake";

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
  const wakeJobs = futureJobs.filter((job) => job.role === "wake");
  const recoveryJobs = futureJobs.filter((job) => job.role === "recovery");
  const nextPlannedWakeAt = [...futureJobs]
    .sort((left, right) => Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt))[0]?.nextRunAt || "";
  const duplicateCount = Math.max(0, wakeJobs.length - 1) + Math.max(0, recoveryJobs.length - 1);
  return {
    duplicateCount,
    drifted: duplicateCount > 0,
    futureJobs,
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
  // Codeksei decides which hosted wake/recovery job set should exist. Hermes
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
    script: resolveHermesContextBriefingScriptPath(config),
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
  // The prompt teaches Hermes to claim and settle delegated proactive passes,
  // while actual delivery routing comes from the persisted cron job origin
  // metadata written by the hosted wake sync helper.
  const claimCommand = buildHostedCheckinCliCommand(target.workspaceRoot, [
    "host",
    "claim-checkin",
    "--provider",
    "hermes",
    "--user",
    target.senderId,
    "--workspace",
    target.workspaceRoot,
  ]);
  const settleSilent = buildHostedCheckinCliCommand(target.workspaceRoot, [
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
    "--result",
    "silent",
    "--sleep-for",
    CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER,
  ]);
  const settleSent = buildHostedCheckinCliCommand(target.workspaceRoot, [
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
    "--result",
    "sent_message",
    "--sleep-for",
    CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER,
  ]);
  const settleFailed = buildHostedCheckinCliCommand(target.workspaceRoot, [
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
    "--result",
    "failed",
  ]);
  return [
    "[SYSTEM: You are running one Codeksei hosted proactive checkin on Hermes. Hermes only executes the managed wake/recovery job set; Codeksei remains the schedule source of truth.]",
    "[SYSTEM: Do not create cron jobs yourself. Do not call codeksei start/shared:start/shared:watchdog. The attached codeksei-companion skill is the only companion workflow surface you should rely on.]",
    "[SYSTEM: Hermes injects a fresh Codeksei context board via the job script right before this run. Treat that Script Output block as your current-state handoff, and use followupContext only as one-shot internal carry-forward.]",
    ...(followupContext
      ? [
        "[SYSTEM: Additional internal follow-up context is provided below. Use it only as internal context for this proactive pass. Do not quote it verbatim to the user or expose internal planning.]",
        "",
        "Internal follow-up context:",
        followupContext,
      ]
      : []),
    "",
    `1. Run this command first and inspect its JSON result: ${claimCommand}`,
    "2. Branch by claim status:",
    "   - idle: no proactive pass is due right now. Respond with exactly [SILENT].",
    "   - in_progress: another proactive pass already owns the lease. Respond with exactly [SILENT].",
    "   - claimed: extract lease.id and payload.text, then continue with this proactive pass.",
    "3. Execute exactly one proactive pass using payload.text as the task instruction. Keep it stateful and lightweight. You may stay silent, produce one short final message, or only do backstage work.",
    "4. Before ending the run, you must execute exactly one settle command.",
    `   - ${CHECKIN_COMPLETION_CONTEXT_GUIDANCE.replaceAll("checkin-complete", "host settle-checkin")}`,
    ...buildCheckinCompletionDurationGuidanceLines().map((line) => `   - ${line}`),
    `   - If your final response is the actual user-visible message, use a command like: ${settleSent}`,
    `   - If you intentionally stay silent, use a command like: ${settleSilent} and make your final response exactly [SILENT].`,
    "   - Use result=backstage_only only when you only did backstage work; in that case your final response must also be exactly [SILENT].",
    `   - If Hermes cannot complete this delegated pass truthfully after claim, use: ${settleFailed}`,
    "5. Never skip host settle-checkin after a claimed lease. Never execute more than one settle command in the same run.",
  ].join("\n");
}

function buildRecoveryWakeAtIso(plannedWakeAt: string): string {
  const plannedWakeAtMs = Date.parse(plannedWakeAt);
  if (!Number.isFinite(plannedWakeAtMs)) {
    throw new Error(`非法的 hosted checkin wake 时间：${plannedWakeAt}`);
  }
  return new Date(plannedWakeAtMs + CHECKIN_ACTIVE_WAKE_TIMEOUT_MS).toISOString();
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
  if (normalized === "wake" || normalized === "recovery") {
    return normalized;
  }
  return "";
}

export function isHostedHermesCheckinEnabled(config: Partial<HostedCheckinConfig>): boolean {
  return resolveHostMode(config).mode === "hosted";
}
