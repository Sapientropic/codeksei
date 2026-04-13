import { normalizeText } from "../core/text-normalization";
import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import { CheckinConfigStore } from "../state/checkin-config-store";
import {
  formatCheckinRange,
  parseCheckinRangeArgument,
  resolveCheckinConfig,
} from "../state/checkin-config";

interface SystemCheckinConfigOptions {
  dryRun?: boolean;
  help: boolean;
  idempotencyKey?: string;
  show: boolean;
  range: string;
  reset: boolean;
}

interface RuntimeConfig extends Record<string, unknown> {
  cliIdempotencyLedgerFile?: string;
  checkinConfigFile?: string;
}

async function runSystemCheckinConfigCommand(config: RuntimeConfig, args: string[] = []) {
  const options = parseSystemCheckinConfigArgs(args);
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("system.checkin_config"),
    } satisfies CommandExecutionResult;
  }

  const filePath = normalizeText(config.checkinConfigFile);
  if (!filePath) {
    throw new Error("当前未配置 checkin config file");
  }
  if (options.show || (!options.range && !options.reset)) {
    const rendered = renderResolvedCheckinConfig(filePath);
    return {
      data: {
        filePath,
        rendered,
      },
      text: rendered,
    } satisfies CommandExecutionResult;
  }

  const store = new CheckinConfigStore({ filePath });
  const parsedRange = options.range ? parseCheckinRangeArgument(options.range) : null;
  if (options.range && !parsedRange) {
    throw new Error("checkin range 必须是 <min>-<max> 分钟，例如 3-60");
  }

  return runCliMutation<Record<string, unknown>>({
    commandKey: "system.checkin-config",
    config,
    configSource: {
      checkinConfigFile: filePath,
    },
    dryRun: Boolean(options.dryRun),
    dryRunResult: {
      data: {
        action: options.reset ? "reset" : "update",
        filePath,
        range: options.range || "",
      },
      text: [
        "checkin config dry-run",
        `action: ${options.reset ? "reset" : "update"}`,
        `file: ${filePath}`,
      ].join("\n"),
    },
    execute: async () => {
      if (options.reset) {
        store.reset();
      } else if (parsedRange) {
        store.setConfig(parsedRange);
      }
      const rendered = renderResolvedCheckinConfig(filePath);
      return {
        data: {
          action: options.reset ? "reset" : "update",
          filePath,
          rendered,
        },
        text: `${options.reset ? "checkin range reset" : "checkin range updated"}\n${rendered}`,
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      range: options.range,
      reset: options.reset,
    },
    resolvedTargets: {
      filePath,
    },
    sideEffects: [
      {
        kind: "write_checkin_config",
        target: filePath,
      },
    ],
  });
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

export { runSystemCheckinConfigCommand };

