#!/usr/bin/env node

import { PACKAGE_NAME } from "./contracts/app-env";
import type { CommandExecutionResult, GlobalCliOptions } from "./contracts/cli-contract";
import { findTerminalCommandManifest } from "./contracts/command-surface";
import {
  buildOperatorHelpText,
  buildTerminalHelpText,
  buildTerminalLeafHelp,
  buildTerminalTopicHelp,
  isPlannedTerminalTopic,
} from "./core/command-registry";
import { buildCommandSchema } from "./core/command-schema";
import {
  CliError,
  emitCliError,
  emitCliResult,
  formatCliErrorMessage,
  parseGlobalCliOptions,
  resolveGlobalCliOptions,
} from "./core/cli-contract";
import { logError } from "./core/logging";
import { createTerminalCommandContext } from "./app/terminal-command-context";
import { runTerminalManifestCommand } from "./app/terminal-command-dispatch";
import type { TerminalCommandManifestEntry } from "./contracts/command-surface";


interface ParsedCommandIntent {
  argv: string[];
  command: string;
  subcommand: string;
  manifest: TerminalCommandManifestEntry | null;
  helpFlag: boolean;
}

let runtimeErrorHooksInstalled = false;

export async function main(): Promise<void> {
  const parsedGlobalOptions = parseGlobalCliOptions(process.argv.slice(2));
  const cli = resolveGlobalCliOptions(parsedGlobalOptions);
  const argv = parsedGlobalOptions.argv;
  const intent = parseCommandIntent(argv);
  const readonlyResult = runReadonlyHelpPath(intent);
  if (readonlyResult) {
    emitCliResult(readonlyResult, cli);
    return;
  }

  installRuntimeErrorHooks(cli);
  const context = createTerminalCommandContext(argv, cli, intent.manifest);
  if (intent.manifest) {
    const result = await runTerminalManifestCommand(intent.manifest, context);
    if (result) {
      emitCliResult(result, cli);
    }
    return;
  }

  throw new CliError({
    code: "unknown_command",
    exitCode: 3,
    message: `未知命令: ${intent.command}`,
    retryable: false,
  });
}

function parseCommandIntent(argv: string[]): ParsedCommandIntent {
  const command = argv[0] || "help";
  const subcommand = argv[1] || "";
  return {
    argv,
    command,
    subcommand,
    manifest: resolveTerminalCommandManifest(command, subcommand),
    helpFlag: hasArgFlag(argv, "--help") || hasArgFlag(argv, "-h"),
  };
}

function runReadonlyHelpPath({ command, subcommand, manifest, helpFlag }: ParsedCommandIntent): CommandExecutionResult | null {
  if (
    command === "operator"
    && (!subcommand || subcommand === "help" || (helpFlag && !manifest))
  ) {
    return {
      data: buildCommandSchema({ audience: "operator", command: "", subcommand: "" }),
      text: buildOperatorHelpText(),
    };
  }

  if (command === "help" || command === "--help" || command === "-h") {
    if (subcommand === "operator") {
      return {
        data: buildCommandSchema({ audience: "operator", command: "", subcommand: "" }),
        text: buildOperatorHelpText(),
      };
    }
    const topicHelp = subcommand ? buildTerminalTopicHelp(subcommand) : "";
    return {
      data: buildCommandSchema({ audience: "public", command: subcommand, subcommand: "" }),
      text: topicHelp || buildTerminalHelpText(),
    };
  }

  if (manifest && helpFlag) {
    const leafHelp = buildTerminalLeafHelp(manifest.action);
    const topicHelp = buildTerminalTopicHelp(manifest.helpTopic || manifest.command);
    return {
      data: buildCommandSchema({
        audience: manifest.audience,
        command: manifest.command,
        subcommand: manifest.subcommand,
      }),
      text: leafHelp || topicHelp || (manifest.audience === "operator" ? buildTerminalHelpText({ audience: "operator" }) : buildTerminalHelpText()),
    };
  }

  if (isPlannedTerminalTopic(command) && (helpFlag || subcommand === "help" || !subcommand)) {
    return {
      data: buildCommandSchema({ audience: "public", command, subcommand: "" }),
      text: buildTerminalTopicHelp(command),
    };
  }

  return null;
}

export function resolveTerminalCommandManifest(
  command: unknown,
  subcommand: unknown,
): TerminalCommandManifestEntry | null {
  const normalizedCommand = String(command || "").trim();
  const normalizedSubcommand = String(subcommand || "").trim();
  const exact = findTerminalCommandManifest(normalizedCommand, normalizedSubcommand);
  if (exact) {
    return exact;
  }
  if (normalizedCommand === "schema") {
    return findTerminalCommandManifest(normalizedCommand, "");
  }
  if (normalizedSubcommand.startsWith("-")) {
    return findTerminalCommandManifest(normalizedCommand, "");
  }
  return null;
}

function installRuntimeErrorHooks(cli: GlobalCliOptions): void {
  if (runtimeErrorHooksInstalled) {
    return;
  }
  runtimeErrorHooksInstalled = true;

  process.on("unhandledRejection", (reason: unknown) => {
    const message = formatCliErrorMessage(reason);
    logError(`[${PACKAGE_NAME}] unhandled rejection ${message}`);
    if (cli.verbose || cli.debug) {
      const detail = reason instanceof Error ? reason.stack || reason.message : String(reason);
      logError(detail);
    }
  });

  process.on("uncaughtException", (error: unknown) => {
    const message = formatCliErrorMessage(error);
    logError(`[${PACKAGE_NAME}] uncaught exception ${message}`);
    if (cli.verbose || cli.debug) {
      const detail = error instanceof Error ? error.stack || error.message : String(error);
      logError(detail);
    }
    process.exitCode = 1;
  });
}

function hasArgFlag(argv: string[], flag: string): boolean {
  return Array.isArray(argv) && argv.some((item) => String(item || "").trim() === flag);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const cli = resolveGlobalCliOptions(parseGlobalCliOptions(process.argv.slice(2)));
    process.exitCode = emitCliError(error, cli);
  });
}
