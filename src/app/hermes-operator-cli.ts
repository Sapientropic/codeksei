import * as path from "node:path";

import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import {
  buildTargetResolutionRequiredError,
  buildValidationError,
} from "../core/cli-contract";
import { runCliMutation } from "../core/cli-mutation";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import {
  collectHermesHostedStatusReport,
  installHermesCompanionSkill,
  previewHermesCompanionSkillInstall,
  runHermesHostedSmoke,
  type HermesSkillInstallPreview,
  type HermesSkillInstallResult,
} from "../core/host-mode";
import {
  collectHostedCheckinCronSummary,
  createHostedCheckinCronPlanSetFromTick,
  type HostedCheckinCronSummary,
} from "../core/hosted-checkin-cron";
import {
  buildCheckinTargetResolutionErrorMessage,
  resolveCheckinTarget,
  runCheckinTick,
} from "../checkin";
import {
  resolveHermesHomePath,
} from "../core/hermes-repo-local";
import { normalizeText } from "../core/text-normalization";
import { syncHostedCheckinPlanSetViaHermes } from "../host/recipes/hermes/wake-forwarder";
import { createSessionStore } from "../session/session-store-factory";

interface HermesInstallSkillOptions {
  dryRun?: boolean;
  help: boolean;
  idempotencyKey?: string;
}

interface HermesReadOnlyOptions {
  help: boolean;
}

interface HermesStatusOptions {
  help: boolean;
  user: string;
  workspace: string;
}

interface HermesSyncCheckinOptions {
  dryRun?: boolean;
  help: boolean;
  idempotencyKey?: string;
  user: string;
  workspace: string;
}

type HermesInstallSkillMutationData = HermesSkillInstallPreview | HermesSkillInstallResult;
type HermesInstallSkillRequest = {
  installedPath: string;
  repoSkillHash: string;
};
type HermesInstallSkillResolvedTarget = {
  backupPath: string;
  installedPath: string;
};
type HermesInstallSkillSideEffect = {
  kind: "backup_existing_skill" | "write_skill_file";
  target: string;
};

type HermesSyncCheckinMutationData = {
  planned: {
    jobs: Array<{
      name: string;
      nextRunAt: string;
      role: "recovery" | "wake";
      targetKey: string;
    }>;
    targetKey: string;
  };
  summary: HostedCheckinCronSummary;
  sync: {
    chatId: string;
    deliver: string;
    jobs: Array<{
      created: boolean;
      deliver: string;
      jobId: string;
      name: string;
      nextRunAt: string;
      role: "recovery" | "wake";
    }>;
    platform: string;
    removedJobIds: string[];
    threadId: string;
  };
  target: {
    senderId: string;
    senderSource: string;
    workspaceRoot: string;
    workspaceSource: string;
  };
  tick: {
    due: boolean;
    nextWakeAt: string;
    status: string;
    triggerId: string;
  };
};

type HermesOperatorConfig = Pick<
  AppRuntimeConfig,
  | "accountId"
  | "allowedUserIds"
  | "channel"
  | "channelProvider"
  | "checkinConfigFile"
  | "checkinScheduleStateFile"
  | "cliIdempotencyLedgerFile"
  | "hermesCommand"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "reviewSemanticHost"
  | "runtime"
  | "sessionsFile"
  | "userName"
  | "workspaceId"
  | "workspaceRoot"
>;

export function buildHermesOperatorValidationError(value: string) {
  return buildValidationError(
    `不支持的 Hermes operator 子命令: ${value}`,
    {
      subcommands: [
        "install-skill",
        "sync-checkin",
        "status",
        "smoke",
      ],
    },
    "可用子命令：install-skill, sync-checkin, status, smoke",
  );
}

export async function runHermesInstallSkillCommand(
  config: HermesOperatorConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HermesInstallSkillOptions>(args, getCommandArgsSchema("hermesInstallSkill"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("operator.hermes.install_skill"),
    };
  }

  const preview = previewHermesCompanionSkillInstall(config);
  if (!preview.repoSkillAsset.exists) {
    throw new Error(`repo Hermes skill asset not found: ${preview.repoSkillAsset.path}`);
  }

  return runCliMutation<
    HermesInstallSkillMutationData,
    HermesInstallSkillRequest,
    HermesInstallSkillResolvedTarget,
    HermesInstallSkillSideEffect
  >({
    commandKey: "operator.hermes.install_skill",
    config,
    dryRun: Boolean(options.dryRun),
    dryRunResult: {
      data: preview,
      text: renderHermesInstallSkillPreview(preview),
      next: ["codeksei operator hermes install-skill"],
    },
    execute: async (): Promise<CommandExecutionResult<HermesInstallSkillMutationData>> => {
      const result = installHermesCompanionSkill(config);
      return {
        data: result,
        text: renderHermesInstallSkillResult(result),
        next: result.installedSkill.inSync
          ? ["codeksei operator hermes status", "codeksei operator hermes smoke"]
          : ["codeksei operator hermes status"],
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      installedPath: normalizeLocalPath(preview.installedPath),
      repoSkillHash: preview.repoSkillAsset.hash,
    },
    resolvedTargets: {
      installedPath: normalizeLocalPath(preview.installedPath),
      backupPath: normalizeLocalPath(preview.backupPath),
    },
    sideEffects: buildHermesInstallSkillSideEffects(preview),
  });
}

export async function runHermesStatusCommand(
  config: HermesOperatorConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HermesStatusOptions>(args, getCommandArgsSchema("hermesStatus"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("operator.hermes.status"),
    };
  }

  const report = collectHermesHostedStatusReport(config);
  const managedCheckin = resolveManagedCheckinSummary(config, options);
  return {
    data: {
      ...report,
      managedCheckin,
    },
    text: [
      `profile: ${report.hostProfile.profile}`,
      `supported: ${report.hostProfile.supported ? "yes" : "no"}`,
      `hermes_command: ${report.hermes.available ? "ok" : "missing"}`,
      `repo_local: ${report.hermes.repoLocal.ready ? "ready" : "missing"}`,
      `repo_local_commit: ${report.hermes.repoLocal.commit || "(unknown)"}`,
      `weixin_accounts: ${report.hermes.weixinAccounts.count}`,
      `installed_skill: ${report.hermes.installedSkill.exists ? "yes" : "no"}`,
      `skill_in_sync: ${report.hermes.installedSkill.inSync ? "yes" : "no"}`,
      `semantic_host: ${report.hermes.semanticReview.activeHost}`,
      `semantic_available: ${report.hermes.semanticReview.available ? "yes" : "no"}`,
      `skills_listed: ${report.skillCatalog.listed ? "yes" : "no"}`,
      ...(managedCheckin ? [
        `managed_checkin_target: ${managedCheckin.targetKey}`,
        `managed_checkin_wake_jobs: ${managedCheckin.wakeJobs.length}`,
        `managed_checkin_recovery_jobs: ${managedCheckin.recoveryJobs.length}`,
        `managed_checkin_next_wake: ${managedCheckin.nextPlannedWakeAt || "(none)"}`,
        `managed_checkin_drifted: ${managedCheckin.drifted ? "yes" : "no"}`,
      ] : []),
    ].join("\n"),
    next: report.hermes.installedSkill.inSync
      ? ["codeksei operator hermes sync-checkin", "codeksei operator hermes smoke"]
      : ["codeksei operator hermes install-skill"],
  };
}

export async function runHermesSmokeCommand(
  config: HermesOperatorConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HermesReadOnlyOptions>(args, getCommandArgsSchema("hermesSmoke"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("operator.hermes.smoke"),
    };
  }

  const smoke = runHermesHostedSmoke(config);
  return {
    ok: smoke.ok ? true : "partial",
    data: smoke,
    text: [
      `ok: ${smoke.ok ? "yes" : "no"}`,
      `profile: ${smoke.hostProfile.profile}`,
      ...Object.entries(smoke.checks).map(([key, value]) => `${key}: ${value.ok ? "ok" : "needs_attention"}`),
    ].join("\n"),
    next: smoke.next,
  };
}

export async function runHermesSyncCheckinCommand(
  config: HermesOperatorConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HermesSyncCheckinOptions>(args, getCommandArgsSchema("hermesSyncCheckin"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("operator.hermes.sync_checkin"),
    };
  }

  const resolution = resolveCheckinTarget({
    accountId: normalizeText(config.accountId),
    config,
    explicitUser: options.user,
    explicitWorkspace: options.workspace,
    sessionStore: createSessionStore(config.sessionsFile),
  });
  if (!resolution.ok || !resolution.value) {
    throw buildTargetResolutionRequiredError(
      buildCheckinTargetResolutionErrorMessage(resolution),
      {
        senderCandidates: resolution.senderResolution.candidates,
        senderSource: resolution.senderResolution.source,
        workspaceCandidates: resolution.workspaceResolution.candidates,
        workspaceSource: resolution.workspaceResolution.source,
      },
      "显式传 --user / --workspace，或先把唯一稳定默认值写进配置。"
    );
  }
  const target = resolution.value;

  const tick = runCheckinTick({
    config,
    target,
  });
  const planSet = createHostedCheckinCronPlanSetFromTick(config, target, tick);
  const jobsFile = path.join(resolveHermesHomePath(config), "cron", "jobs.json");

  return runCliMutation<HermesSyncCheckinMutationData>({
    commandKey: "operator.hermes.sync_checkin",
    config,
    configSource: {
      hermesHome: resolveHermesHomePath(config),
      jobsFile,
    },
    dryRun: Boolean(options.dryRun),
    dryRunResult: {
      data: {
        planned: {
          jobs: planSet.jobs.map((job) => ({
            name: job.name,
            nextRunAt: job.plannedWakeAt,
            role: job.role,
            targetKey: job.targetKey,
          })),
          targetKey: planSet.targetKey,
        },
        summary: collectHostedCheckinCronSummary(config, target),
        sync: {
          chatId: "",
          deliver: "origin",
          jobs: planSet.jobs.map((job) => ({
            created: false,
            deliver: "origin",
            jobId: "",
            name: job.name,
            nextRunAt: job.plannedWakeAt,
            role: job.role,
          })),
          platform: "weixin",
          removedJobIds: [],
          threadId: "",
        },
        target,
        tick: {
          due: tick.due,
          nextWakeAt: tick.nextWakeAt,
          status: tick.status,
          triggerId: normalizeText(tick.payload?.triggerId) || normalizeText(tick.activeWake?.triggerId),
        },
      },
      text: [
        "hosted checkin sync dry-run",
        `status: ${tick.status}`,
        `target: ${planSet.targetKey}`,
        `roles: ${planSet.jobs.map((job) => job.role).join(", ")}`,
        `nextRunAt: ${planSet.jobs.map((job) => `${job.role}:${job.plannedWakeAt}`).join(", ")}`,
        `jobsFile: ${jobsFile}`,
      ].join("\n"),
    },
    execute: async () => {
      const sync = syncHostedCheckinPlanSetViaHermes(config, planSet);
      const summary = collectHostedCheckinCronSummary(config, target);
      return {
        data: {
          planned: {
            jobs: planSet.jobs.map((job) => ({
              name: job.name,
              nextRunAt: job.plannedWakeAt,
              role: job.role,
              targetKey: job.targetKey,
            })),
            targetKey: planSet.targetKey,
          },
          summary,
          sync: {
            chatId: sync.chatId,
            deliver: sync.deliver,
            jobs: sync.jobs,
            platform: sync.platform,
            removedJobIds: sync.removedJobIds,
            threadId: sync.threadId,
          },
          target,
          tick: {
            due: tick.due,
            nextWakeAt: tick.nextWakeAt,
            status: tick.status,
            triggerId: normalizeText(tick.payload?.triggerId) || normalizeText(tick.activeWake?.triggerId),
          },
        },
        text: [
          `hosted checkin synced: ${sync.jobs.map((job) => `${job.role}:${job.jobId}`).join(", ")}`,
          `status: ${tick.status}`,
          `roles: ${planSet.jobs.map((job) => job.role).join(", ")}`,
          `nextRunAt: ${sync.jobs.map((job) => `${job.role}:${job.nextRunAt}`).join(", ")}`,
          `removedFutureJobs: ${sync.removedJobIds.length}`,
        ].join("\n"),
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      roles: planSet.jobs.map((job) => job.role),
      senderId: planSet.senderId,
      status: tick.status,
      targetKey: planSet.targetKey,
      workspaceRoot: planSet.workspaceRoot,
      nextRunAt: planSet.jobs.map((job) => job.plannedWakeAt),
    },
    resolvedTargets: {
      jobsFile,
      roles: planSet.jobs.map((job) => job.role),
      senderId: planSet.senderId,
      targetKey: planSet.targetKey,
      workspaceRoot: planSet.workspaceRoot,
    },
    sideEffects: [
      {
        kind: "sync_hermes_checkin_cron_job",
        target: jobsFile,
      },
    ],
  });
}

function buildHermesInstallSkillSideEffects(preview: HermesSkillInstallPreview): HermesInstallSkillSideEffect[] {
  const effects: HermesInstallSkillSideEffect[] = [
    {
      kind: "write_skill_file",
      target: normalizeLocalPath(preview.installedPath),
    },
  ];
  if (preview.willBackup) {
    effects.push({
      kind: "backup_existing_skill",
      target: normalizeLocalPath(preview.backupPath),
    });
  }
  return effects;
}

function renderHermesInstallSkillPreview(preview: HermesSkillInstallPreview): string {
  return [
    "hermes install-skill dry-run",
    `installed_path: ${preview.installedPath}`,
    `will_write: ${preview.willWrite ? "yes" : "no"}`,
    `will_create: ${preview.willCreate ? "yes" : "no"}`,
    `will_overwrite: ${preview.willOverwrite ? "yes" : "no"}`,
    `backup: ${preview.willBackup ? preview.backupPath : "(none)"}`,
    `current_in_sync: ${preview.installedSkill.inSync ? "yes" : "no"}`,
  ].join("\n");
}

function renderHermesInstallSkillResult(result: HermesSkillInstallResult): string {
  return [
    `installed: ${result.installedPath}`,
    `created: ${result.created ? "yes" : "no"}`,
    `overwritten: ${result.overwritten ? "yes" : "no"}`,
    `backup: ${result.backupPath || "(none)"}`,
    `in_sync: ${result.installedSkill.inSync ? "yes" : "no"}`,
  ].join("\n");
}

function normalizeLocalPath(value: string): string {
  return normalizeText(value).replace(/\\/g, "/");
}

function resolveManagedCheckinSummary(
  config: HermesOperatorConfig,
  options: Pick<HermesStatusOptions, "user" | "workspace">,
): HostedCheckinCronSummary | null {
  const wantsExplicitTarget = Boolean(normalizeText(options.user) || normalizeText(options.workspace));
  if (!wantsExplicitTarget && !Array.isArray(config.allowedUserIds) && !normalizeText(config.sessionsFile)) {
    return null;
  }
  const resolution = resolveCheckinTarget({
    accountId: normalizeText(config.accountId),
    config,
    explicitUser: options.user,
    explicitWorkspace: options.workspace,
    sessionStore: createSessionStore(config.sessionsFile),
  });
  if (!resolution.ok || !resolution.value) {
    if (wantsExplicitTarget) {
      throw buildTargetResolutionRequiredError(
        buildCheckinTargetResolutionErrorMessage(resolution),
        {
          senderCandidates: resolution.senderResolution.candidates,
          senderSource: resolution.senderResolution.source,
          workspaceCandidates: resolution.workspaceResolution.candidates,
          workspaceSource: resolution.workspaceResolution.source,
        },
        "显式传 --user / --workspace，或先把唯一稳定默认值写进配置。"
      );
    }
    return null;
  }
  return collectHostedCheckinCronSummary(config, resolution.value);
}
