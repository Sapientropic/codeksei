import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { runHermesRecipeSmoke } from "../host/recipes/hermes/doctor";
import { runCodexRecipeSmoke } from "../host/recipes/codex/doctor";
import { resolveHostProviderWithConfig } from "./host-cli-shared";

interface HostSmokeOptions {
  config: string;
  help: boolean;
  provider: string;
}

type SmokeConfig = Partial<Pick<
  AppRuntimeConfig,
  | "accountId"
  | "accountsDir"
  | "runtimeCommand"
  | "runtimeEndpoint"
  | "stateDir"
  | "weixinInstructionsFile"
  | "weixinOperationsFile"
  | "workspaceRoot"
  | "hermesCommand"
  | "hermesHome"
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
    return {
      ok: smoke.ok ? true : "partial",
      data: smoke,
      text: [
        `provider: codex`,
        `ok: ${smoke.ok ? "yes" : "no"}`,
        ...Object.entries(smoke.checks).map(([key, value]) => `${key}: ${value.ok ? "ok" : "needs_attention"}`),
      ].join("\n"),
      next: smoke.next,
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
  return {
    ok: smoke.ok ? true : "partial",
    data: smoke,
    text: [
      `provider: hermes`,
      `ok: ${smoke.ok ? "yes" : "no"}`,
      ...Object.entries(smoke.checks).map(([key, value]) => `${key}: ${value.ok ? "ok" : "needs_attention"}`),
    ].join("\n"),
    next: smoke.next,
  };
}
