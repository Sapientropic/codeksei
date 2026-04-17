import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { parseCompactDurationMs } from "../core/duration";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { normalizeText } from "../core/text-normalization";
import { seedProactiveCheckin } from "../host/delegation/seed-proactive";
import { assertResidentDaemonConfig, resolveHostCheckinTarget, resolveHostProviderWithConfig } from "./host-cli-shared";

interface HostSeedOptions {
  config: string;
  help: boolean;
  nextWakeAt: string;
  provider: string;
  sleepFor: string;
  user: string;
  workspace: string;
}

type SeedCliConfig = Partial<Pick<
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

export async function runHostSeedProactiveCommand(
  config: SeedCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HostSeedOptions>(args, getCommandArgsSchema("hostSeedProactive"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("host.seed_proactive"),
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
  const seeded = seedProactiveCheckin(config as Parameters<typeof seedProactiveCheckin>[0], target, {
    provider: resolvedProvider.provider,
    nextWakeAt: resolveNextWakeAt(options.nextWakeAt, options.sleepFor),
  });
  return {
    data: {
      provider: resolvedProvider.provider,
      target,
      ...seeded,
    },
    text: [
      `provider: ${resolvedProvider.provider}`,
      `status: ${seeded.status}`,
      `nextWakeAt: ${seeded.nextWakeAt || "(none)"}`,
    ].join("\n"),
  };
}

function resolveNextWakeAt(nextWakeAt: string, sleepFor: string): string {
  const explicit = normalizeText(nextWakeAt);
  if (explicit) {
    return explicit;
  }
  const durationMs = parseCompactDurationMs(normalizeText(sleepFor));
  return durationMs ? new Date(Date.now() + durationMs).toISOString() : "";
}
