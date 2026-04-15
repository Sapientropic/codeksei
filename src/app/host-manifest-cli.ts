import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { buildHostAttachmentManifest } from "../host";

interface HostManifestOptions {
  config: string;
  help: boolean;
}

export async function runHostManifestCommand(
  config: Partial<AppRuntimeConfig>,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HostManifestOptions>(args, getCommandArgsSchema("hostManifest"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("host.manifest"),
    };
  }

  const manifest = buildHostAttachmentManifest({
    ...config,
  });
  return {
    data: manifest,
    text: JSON.stringify(manifest, null, 2),
  };
}
