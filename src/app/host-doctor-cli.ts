import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { collectHostDoctorReport } from "../host";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { resolveHostProviderWithConfig } from "./host-cli-shared";

interface HostDoctorOptions {
  config: string;
  help: boolean;
  provider: string;
}

type DoctorConfig = Partial<Pick<
  AppRuntimeConfig,
  | "channelProvider"
  | "runtime"
  | "workspaceRoot"
  | "hermesCommand"
  | "hermesHome"
  | "hermesRepoRoot"
  | "hermesRepoLocalShimPath"
  | "reviewSemanticHost"
>>;

export async function runHostDoctorCommand(
  config: DoctorConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HostDoctorOptions>(args, getCommandArgsSchema("hostDoctor"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("host.doctor"),
    };
  }
  const resolvedProvider = resolveHostProviderWithConfig(config, {
    provider: options.provider,
    configFile: options.config,
  });
  const effectiveConfig = resolvedProvider.provider === "hermes"
    ? { ...config, runtime: "hermes", channelProvider: "hermes" }
    : config;
  const report = collectHostDoctorReport({
    ...effectiveConfig,
    configFile: options.config,
  });
  return {
    data: report,
    text: [
      `provider: ${report.provider.id || "(none)"}`,
      `modeClass: ${report.attachment.modeClass}`,
      `profile: ${report.attachment.profile}`,
      `supported: ${report.attachment.supported ? "yes" : "no"}`,
      `config: ${report.resolvedConfig.exists ? report.resolvedConfig.path : `${report.resolvedConfig.path} [missing]`}`,
      `daemon_owner: ${report.daemon.state.scheduleOwner}`,
    ].join("\n"),
  };
}
