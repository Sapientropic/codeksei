#!/usr/bin/env node

import { PACKAGE_NAME } from "./core/branding";
import { findTerminalCommandManifest } from "./contracts/command-surface";
import { buildTerminalHelpText, buildTerminalLeafHelp, buildTerminalTopicHelp, isPlannedTerminalTopic } from "./core/command-registry";
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
  const argv = process.argv.slice(2);
  const intent = parseCommandIntent(argv);
  if (runReadonlyHelpPath(intent)) {
    return;
  }

  installRuntimeErrorHooks();
  const context = createTerminalCommandContext(argv);
  if (intent.manifest) {
    await runTerminalManifestCommand(intent.manifest, context);
    return;
  }

  throw new Error(`未知命令: ${intent.command}`);
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

function runReadonlyHelpPath({ command, subcommand, manifest, helpFlag }: ParsedCommandIntent): boolean {
  if (command === "help" || command === "--help" || command === "-h") {
    const topicHelp = subcommand ? buildTerminalTopicHelp(subcommand) : "";
    console.log(topicHelp || buildTerminalHelpText());
    return true;
  }

  if (manifest && helpFlag) {
    const leafHelp = buildTerminalLeafHelp(manifest.action);
    const topicHelp = buildTerminalTopicHelp(manifest.helpTopic || manifest.command);
    console.log(leafHelp || topicHelp || buildTerminalHelpText());
    return true;
  }

  if (isPlannedTerminalTopic(command) && (helpFlag || subcommand === "help" || !subcommand)) {
    console.log(buildTerminalTopicHelp(command));
    return true;
  }

  return false;
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
  if (normalizedSubcommand.startsWith("-")) {
    return findTerminalCommandManifest(normalizedCommand, "");
  }
  return null;
}

function installRuntimeErrorHooks(): void {
  if (runtimeErrorHooksInstalled) {
    return;
  }
  runtimeErrorHooksInstalled = true;

  process.on("unhandledRejection", (reason: unknown) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error(`[${PACKAGE_NAME}] unhandled rejection ${message}`);
  });

  process.on("uncaughtException", (error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[${PACKAGE_NAME}] uncaught exception ${message}`);
    process.exitCode = 1;
  });
}

function hasArgFlag(argv: string[], flag: string): boolean {
  return Array.isArray(argv) && argv.some((item) => String(item || "").trim() === flag);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[${PACKAGE_NAME}] ${message}`);
    process.exitCode = 1;
  });
}
