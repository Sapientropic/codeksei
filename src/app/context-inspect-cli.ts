import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import {
  buildContextInspectReport,
  renderContextInspectText,
  type ContextInspectConfig,
} from "../context/inspect";

interface ContextInspectOptions {
  help: boolean;
  mode: string;
  text: string;
  user: string;
  workspace: string;
}

export async function runContextInspectCommand(
  config: ContextInspectConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<ContextInspectOptions>(args, getCommandArgsSchema("contextInspect"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("context.inspect"),
    };
  }
  const { contextPacks, report } = buildContextInspectReport(config, options);
  return {
    data: {
      ...report,
      contextPacks,
    },
    meta: {
      configSource: {
        contextPacksConfigFile: contextPacks.configPath,
        contextPacksStateFile: contextPacks.statePath,
        stateDir: config.stateDir || "",
      },
    },
    text: renderContextInspectText(report, {
      stateDir: config.stateDir,
      workspaceRoot: config.workspaceRoot,
    }),
  };
}
