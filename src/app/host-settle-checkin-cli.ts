import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { settleDelegatedCheckin } from "../host/delegation/settle-checkin";
import { assertResidentDaemonConfig, resolveHostCheckinTarget, resolveHostProviderWithConfig } from "./host-cli-shared";

interface HostSettleOptions {
  config: string;
  help: boolean;
  lease: string;
  nextWakeAt: string;
  provider: string;
  result: string;
  sleepFor: string;
  user: string;
  workspace: string;
}

type SettleCliConfig = Partial<Pick<
  AppRuntimeConfig,
  | "accountId"
  | "allowedUserIds"
  | "checkinConfigFile"
  | "checkinScheduleStateFile"
  | "sessionsFile"
  | "workspaceRoot"
  | "stateDir"
  | "runtime"
  | "channelProvider"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
>>;

export async function runHostSettleCheckinCommand(
  config: SettleCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HostSettleOptions>(args, getCommandArgsSchema("hostSettleCheckin"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("host.settle_checkin"),
    };
  }
  assertResidentDaemonConfig(config);
  const target = resolveHostCheckinTarget(config, {
    user: options.user,
    workspace: options.workspace,
  });
  const resolvedProvider = resolveHostProviderWithConfig(config, {
    provider: options.provider,
    configFile: options.config,
    defaultProvider: "hermes",
  });
  const settled = settleDelegatedCheckin(config as Parameters<typeof settleDelegatedCheckin>[0], target, {
    provider: resolvedProvider.provider,
    leaseId: options.lease,
    result: options.result as Parameters<typeof settleDelegatedCheckin>[2]["result"],
    nextWakeAt: options.nextWakeAt,
    sleepFor: options.sleepFor,
  });
  return {
    ok: settled.ok as true | "partial",
    data: {
      provider: resolvedProvider.provider,
      ...settled,
    },
    text: [
      `provider: ${resolvedProvider.provider}`,
      `ok: ${settled.ok === "partial" ? "partial" : "true"}`,
      `nextWakeAt: ${settled.nextWakeAt || "(none)"}`,
    ].join("\n"),
  };
}
