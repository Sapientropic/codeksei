import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildValidationError } from "../core/cli-contract";
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
import { normalizeText } from "../core/text-normalization";

interface HermesInstallSkillOptions {
  dryRun?: boolean;
  help: boolean;
  idempotencyKey?: string;
}

interface HermesReadOnlyOptions {
  help: boolean;
}

type HermesOperatorConfig = Pick<
  AppRuntimeConfig,
  | "channel"
  | "channelProvider"
  | "cliIdempotencyLedgerFile"
  | "hermesCommand"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "reviewSemanticHost"
  | "runtime"
  | "workspaceRoot"
>;

export function buildHermesOperatorValidationError(value: string) {
  return buildValidationError(
    `不支持的 Hermes operator 子命令: ${value}`,
    {
      subcommands: [
        "install-skill",
        "status",
        "smoke",
      ],
    },
    "可用子命令：install-skill, status, smoke",
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

  return runCliMutation<Record<string, unknown>>({
    commandKey: "operator.hermes.install_skill",
    config: config as { cliIdempotencyLedgerFile?: string },
    dryRun: Boolean(options.dryRun),
    dryRunResult: {
      data: preview as unknown as Record<string, unknown>,
      text: renderHermesInstallSkillPreview(preview),
      next: ["codeksei operator hermes install-skill"],
    },
    execute: async (): Promise<CommandExecutionResult<Record<string, unknown>>> => {
      const result = installHermesCompanionSkill(config);
      return {
        data: result as unknown as Record<string, unknown>,
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
  const options = parseCliArgs<HermesReadOnlyOptions>(args, getCommandArgsSchema("hermesStatus"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("operator.hermes.status"),
    };
  }

  const report = collectHermesHostedStatusReport(config);
  return {
    data: report,
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
    ].join("\n"),
    next: report.hermes.installedSkill.inSync
      ? ["codeksei operator hermes smoke"]
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

function buildHermesInstallSkillSideEffects(preview: HermesSkillInstallPreview): Array<Record<string, string>> {
  const effects = [
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
