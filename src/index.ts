#!/usr/bin/env node

import type { CommandExecutionResult } from "./contracts/cli-contract";
import {
  findTerminalCommandManifest,
  findTerminalCommandManifestFromArgv,
} from "./contracts/command-surface";
import {
  buildHermesOperatorHelpText,
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
  parseGlobalCliOptions,
  resolveGlobalCliOptions,
} from "./core/cli-contract";
import { installCliRuntimeErrorHooks } from "./core/cli-runtime-hooks";
import { createTerminalCommandContext } from "./app/terminal-command-context";
import { runTerminalManifestCommand } from "./app/terminal-command-dispatch";
import type { TerminalCommandManifestEntry } from "./contracts/command-surface";
import { buildHermesOperatorValidationError } from "./app/hermes-operator-cli";
import { buildRemovedLiveCommandError } from "./core/removed-command-guidance";
import { runCodekseiMcpServerCli } from "./tools/mcp";


interface ParsedCommandIntent {
  argv: string[];
  command: string;
  subcommand: string;
  manifest: TerminalCommandManifestEntry | null;
  helpFlag: boolean;
}

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

  installCliRuntimeErrorHooks(cli);
  if (intent.command === "tool" && intent.subcommand === "mcp-server" && !intent.helpFlag) {
    await runCodekseiMcpServerCli(argv.slice(2));
    return;
  }
  const context = createTerminalCommandContext(argv, cli, intent.manifest);
  if (intent.manifest) {
    const result = await runTerminalManifestCommand(intent.manifest, context);
    if (result) {
      emitCliResult(result, cli);
    }
    return;
  }

  const removedCommandError = buildRemovedLiveCommandError(argv, { code: "unknown_command" });
  if (removedCommandError) {
    throw removedCommandError;
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
    manifest: resolveTerminalCommandManifest(argv),
    helpFlag: hasArgFlag(argv, "--help") || hasArgFlag(argv, "-h"),
  };
}

function runReadonlyHelpPath({ argv, command, subcommand, manifest, helpFlag }: ParsedCommandIntent): CommandExecutionResult | null {
  if (
    command === "operator"
    && (!subcommand || subcommand === "help" || (helpFlag && !manifest))
  ) {
    return {
      data: buildCommandSchema({ audience: "operator", command: "", subcommand: "" }),
      text: buildOperatorHelpText(),
    };
  }

  if (command === "operator" && subcommand === "hermes" && !manifest) {
    const requestedLeaf = normalizeArgToken(argv[2]);
    if (requestedLeaf && !requestedLeaf.startsWith("-")) {
      throw buildHermesOperatorValidationError(argv[2] || "");
    }
    return {
      data: buildCommandSchema({ audience: "operator", target: ["operator", "hermes"] }),
      text: buildHermesOperatorHelpText(),
    };
  }

  if (command === "help" || command === "--help" || command === "-h") {
    if (subcommand === "operator") {
      if (normalizeArgToken(argv[2]) === "hermes") {
        return {
          data: buildCommandSchema({ audience: "operator", target: ["operator", "hermes"] }),
          text: buildHermesOperatorHelpText(),
        };
      }
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
        target: manifest.pathTokens || [manifest.command, manifest.subcommand].filter(Boolean),
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
  argvOrCommand: readonly unknown[] | unknown,
  subcommand: unknown = "",
): TerminalCommandManifestEntry | null {
  const argv = Array.isArray(argvOrCommand)
    ? [...argvOrCommand]
    : [argvOrCommand, subcommand];
  const exact = findTerminalCommandManifestFromArgv(argv);
  if (exact) {
    return exact;
  }
  const normalizedCommand = normalizeArgToken(argv[0]);
  const normalizedSubcommand = normalizeArgToken(argv[1]);
  if (normalizedCommand === "schema") {
    return findTerminalCommandManifest(normalizedCommand, "");
  }
  if (normalizedSubcommand.startsWith("-")) {
    return findTerminalCommandManifest(normalizedCommand, "");
  }
  return null;
}

function hasArgFlag(argv: string[], flag: string): boolean {
  return Array.isArray(argv) && argv.some((item) => String(item || "").trim() === flag);
}

function normalizeArgToken(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    if (process.argv[2] === "tool" && process.argv[3] === "mcp-server") {
      process.stderr.write(`${error instanceof Error ? error.message : String(error || "unknown error")}\n`);
      process.exitCode = 1;
      return;
    }
    const cli = resolveGlobalCliOptions(parseGlobalCliOptions(process.argv.slice(2)));
    process.exitCode = emitCliError(error, cli);
  });
}
