import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { finalizeDelegatedCheckin } from "../host/delegation/settle-checkin";
import { assertResidentDaemonConfig, resolveHostCheckinTarget, resolveHostProviderWithConfig } from "./host-cli-shared";

interface HostFinalizeOptions {
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

type FinalizeCliConfig = Partial<Pick<
  AppRuntimeConfig,
  | "accountId"
  | "allowedUserIds"
  | "checkinConfigFile"
  | "checkinScheduleStateFile"
  | "diaryDir"
  | "durableNoteSchemaConfigFile"
  | "projectRadarConfigFile"
  | "sessionsFile"
  | "workspaceRoot"
  | "workspaceBootstrapConfigFile"
  | "stateDir"
  | "runtime"
  | "channelProvider"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "timezone"
>>;

export async function runHostFinalizeCheckinCommand(
  config: FinalizeCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HostFinalizeOptions>(args, getCommandArgsSchema("hostFinalizeCheckin"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("host.finalize_checkin"),
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
  const finalizeArgs: Parameters<typeof finalizeDelegatedCheckin>[2] = {
    provider: resolvedProvider.provider,
    leaseId: options.lease,
    nextWakeAt: options.nextWakeAt,
    sleepFor: options.sleepFor,
  };
  if (options.result) {
    finalizeArgs.result = options.result as Exclude<Parameters<typeof finalizeDelegatedCheckin>[2]["result"], undefined>;
  }
  const finalized = finalizeDelegatedCheckin(config as Parameters<typeof finalizeDelegatedCheckin>[0], target, finalizeArgs);
  return {
    ok: finalized.ok as true | "partial",
    data: {
      provider: resolvedProvider.provider,
      ...finalized,
    },
    text: [
      `provider: ${resolvedProvider.provider}`,
      `ok: ${finalized.ok === "partial" ? "partial" : "true"}`,
      `nextWakeAt: ${finalized.nextWakeAt || "(none)"}`,
    ].join("\n"),
  };
}
