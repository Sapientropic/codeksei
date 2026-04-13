import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { CheckinConfigStore } from "../state/checkin-config-store";
import {
  formatCheckinRange,
  parseCheckinRangeArgument,
  resolveCheckinConfig,
} from "../state/checkin-config";

interface SystemCheckinConfigOptions {
  help: boolean;
  show: boolean;
  range: string;
  reset: boolean;
}

interface RuntimeConfig extends Record<string, unknown> {
  checkinConfigFile?: string;
}

async function runSystemCheckinConfigCommand(config: RuntimeConfig, args: string[] = []) {
  const options = parseSystemCheckinConfigArgs(args);
  if (options.help) {
    console.log(buildTerminalLeafHelp("system.checkin_config"));
    return;
  }

  const filePath = normalizeText(config.checkinConfigFile);
  if (!filePath) {
    throw new Error("当前未配置 checkin config file");
  }
  const store = new CheckinConfigStore({ filePath });
  if (options.reset) {
    store.reset();
    console.log("checkin range reset");
    console.log(renderResolvedCheckinConfig(filePath));
    return;
  }

  if (options.range) {
    const parsedRange = parseCheckinRangeArgument(options.range);
    if (!parsedRange) {
      console.log(buildTerminalLeafHelp("system.checkin_config"));
      throw new Error("checkin range 必须是 <min>-<max> 分钟，例如 3-60");
    }
    store.setConfig(parsedRange);
    console.log("checkin range updated");
    console.log(renderResolvedCheckinConfig(filePath));
    return;
  }

  if (options.show || !options.range) {
    console.log(renderResolvedCheckinConfig(filePath));
  }
}

function parseSystemCheckinConfigArgs(args: string[]): SystemCheckinConfigOptions {
  return parseCliArgs<SystemCheckinConfigOptions>(args, getCommandArgsSchema("systemCheckinConfig"));
}

function renderResolvedCheckinConfig(filePath: string): string {
  const resolved = resolveCheckinConfig({ filePath });
  return [
    `checkin: ${formatCheckinRange(resolved)}`,
    `source: ${resolved.source}`,
  ].join("\n");
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export { runSystemCheckinConfigCommand };
