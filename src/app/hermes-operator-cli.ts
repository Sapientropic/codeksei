import type { CommandExecutionResult } from "../contracts/cli-contract";
import { buildValidationError } from "../core/cli-contract";
import { buildTerminalLeafHelp } from "../core/command-registry";
import {
  collectHermesHostedStatusReport,
  installHermesCompanionSkill,
  runHermesHostedSmoke,
} from "../core/host-mode";

type HermesOperatorAction = "install-skill" | "smoke" | "status";

export async function runHermesOperatorCommand(
  config: Record<string, unknown>,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const action = normalizeHermesOperatorAction(args[0] || "");
  if (!action || action === "help") {
    return {
      data: {
        action: "operator.hermes",
        subcommands: ["install-skill", "status", "smoke"],
      },
      text: buildTerminalLeafHelp("operator.hermes"),
    };
  }

  if (action === "install-skill") {
    const result = installHermesCompanionSkill(config);
    return {
      data: result,
      text: [
        `installed: ${result.installedPath}`,
        `created: ${result.created ? "yes" : "no"}`,
        `overwritten: ${result.overwritten ? "yes" : "no"}`,
        `backup: ${result.backupPath || "(none)"}`,
        `in_sync: ${result.installedSkill.inSync ? "yes" : "no"}`,
      ].join("\n"),
      next: result.installedSkill.inSync
        ? ["codeksei operator hermes status", "codeksei operator hermes smoke"]
        : ["codeksei operator hermes status"],
    };
  }

  if (action === "status") {
    const report = collectHermesHostedStatusReport(config);
    return {
      data: report,
      text: [
        `profile: ${report.hostProfile.profile}`,
        `supported: ${report.hostProfile.supported ? "yes" : "no"}`,
        `hermes_command: ${report.hermes.available ? "ok" : "missing"}`,
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

function normalizeHermesOperatorAction(value: string): HermesOperatorAction | "help" | "" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "install-skill" || normalized === "status" || normalized === "smoke") {
    return normalized;
  }
  if (!normalized || normalized === "help" || normalized === "--help" || normalized === "-h") {
    return "help";
  }
  throw buildValidationError(
    `不支持的 Hermes operator 子命令: ${value}`,
    { subcommands: ["install-skill", "status", "smoke"] },
    "可用子命令：install-skill, status, smoke",
  );
}
