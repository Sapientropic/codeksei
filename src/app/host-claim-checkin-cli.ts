import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { claimDelegatedCheckin } from "../host/delegation/claim-checkin";
import { assertResidentDaemonConfig, resolveHostCheckinTarget, resolveHostProviderWithConfig } from "./host-cli-shared";

interface HostClaimOptions {
  config: string;
  help: boolean;
  provider: string;
  user: string;
  workspace: string;
}

type ClaimCliConfig = Partial<Pick<
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

export async function runHostClaimCheckinCommand(
  config: ClaimCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HostClaimOptions>(args, getCommandArgsSchema("hostClaimCheckin"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("host.claim_checkin"),
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
  });
  const claimed = claimDelegatedCheckin(
    config as Parameters<typeof claimDelegatedCheckin>[0],
    target,
    resolvedProvider.provider,
  );
  return {
    data: {
      provider: resolvedProvider.provider,
      target,
      ...claimed,
    },
    text: [
      `provider: ${resolvedProvider.provider}`,
      `status: ${claimed.status}`,
      claimed.lease ? `lease: ${claimed.lease.id}` : "lease: (none)",
      claimed.nextWakeAt ? `nextWakeAt: ${claimed.nextWakeAt}` : "",
    ].filter(Boolean).join("\n"),
  };
}
