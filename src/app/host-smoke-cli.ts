import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { runHermesRecipeSmoke } from "../host/recipes/hermes/doctor";
import { runCodexRecipeSmoke } from "../host/recipes/codex/doctor";
import { runClaudeCodeRecipeSmoke } from "../host/recipes/claudecode/doctor";
import { resolveHostProviderWithConfig } from "./host-cli-shared";
import { buildWhereaboutsSmokeCheck } from "../whereabouts/readiness";

interface HostSmokeOptions {
  config: string;
  help: boolean;
  provider: string;
}

type SmokeConfig = Partial<Pick<
  AppRuntimeConfig,
  | "accountId"
  | "accountsDir"
  | "allowedUserIds"
  | "checkinConfigFile"
  | "checkinScheduleStateFile"
  | "cliIdempotencyLedgerFile"
  | "claudeCommand"
  | "runtimeCommand"
  | "runtimeEndpoint"
  | "sessionsFile"
  | "stateDir"
  | "timezone"
  | "userName"
  | "weixinInstructionsFile"
  | "weixinOperationsFile"
  | "workspaceId"
  | "workspaceRoot"
  | "hermesCommand"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoRoot"
  | "hermesRepoLocalShimPath"
  | "reviewSemanticHost"
>>;

export async function runHostSmokeCommand(
  config: SmokeConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HostSmokeOptions>(args, getCommandArgsSchema("hostSmoke"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("host.smoke"),
    };
  }
  const resolvedProvider = resolveHostProviderWithConfig(config, {
    provider: options.provider,
    configFile: options.config,
    defaultProvider: "hermes",
  });
  if (resolvedProvider.provider === "codex") {
    const smoke = runCodexRecipeSmoke(config);
    const whereabouts = buildWhereaboutsSmokeCheck(config);
    const overallOk = smoke.ok && (whereabouts.ok || !whereabouts.blocking);
    const augmented = {
      ...smoke,
      ok: overallOk,
      checks: {
        ...smoke.checks,
        whereabouts,
      },
      next: whereabouts.ok
        ? smoke.next
        : [...smoke.next, "配置 CODEKSEI_WHEREABOUTS_TOKEN 后可把 local ingest readiness 也纳入 smoke。"],
    };
    return {
      ok: overallOk ? true : "partial",
      data: augmented,
      text: [
        `provider: codex`,
        `ok: ${overallOk ? "yes" : "no"}`,
        ...Object.entries(augmented.checks).map(([key, value]) => `${key}: ${value.ok ? "ok" : "needs_attention"}`),
      ].join("\n"),
      next: augmented.next,
    };
  }
  if (resolvedProvider.provider === "claudecode") {
    const smoke = runClaudeCodeRecipeSmoke(config);
    const whereabouts = buildWhereaboutsSmokeCheck(config);
    const overallOk = smoke.ok && (whereabouts.ok || !whereabouts.blocking);
    const augmented = {
      ...smoke,
      ok: overallOk,
      checks: {
        ...smoke.checks,
        whereabouts,
      },
      next: whereabouts.ok
        ? smoke.next
        : [...smoke.next, "配置 CODEKSEI_WHEREABOUTS_TOKEN 后可把 local ingest readiness 也纳入 smoke。"],
    };
    return {
      ok: overallOk ? true : "partial",
      data: augmented,
      text: [
        "provider: claudecode",
        `ok: ${overallOk ? "yes" : "no"}`,
        ...Object.entries(augmented.checks).map(([key, value]) => `${key}: ${value.ok ? "ok" : "needs_attention"}`),
      ].join("\n"),
      next: augmented.next,
    };
  }
  if (resolvedProvider.provider !== "hermes") {
    return {
      data: {
        ok: true,
        provider: resolvedProvider.provider,
        checks: {},
      },
      text: `host smoke: ${resolvedProvider.provider} currently has no additional smoke requirements`,
    };
  }
  const smoke = runHermesRecipeSmoke({
    ...config,
    runtime: "hermes",
    channelProvider: "hermes",
  });
  const whereabouts = buildWhereaboutsSmokeCheck(config);
  const overallOk = smoke.ok && (whereabouts.ok || !whereabouts.blocking);
  const augmented = {
    ...smoke,
    ok: overallOk,
    checks: {
      ...smoke.checks,
      whereabouts,
    },
    next: whereabouts.ok
      ? smoke.next
      : [...smoke.next, "配置 CODEKSEI_WHEREABOUTS_TOKEN 后可把 local ingest readiness 也纳入 smoke。"],
  };
  return {
    ok: overallOk ? true : "partial",
    data: augmented,
    text: [
      `provider: hermes`,
      `ok: ${overallOk ? "yes" : "no"}`,
      ...Object.entries(augmented.checks).map(([key, value]) => `${key}: ${value.ok ? "ok" : "needs_attention"}`),
    ].join("\n"),
    next: augmented.next,
  };
}
