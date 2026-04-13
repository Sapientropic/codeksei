import type { CliAudience } from "../contracts/cli-contract";
import {
  findTerminalCommandManifest,
  listCommandActions,
  listTerminalCommandManifest,
  type CommandAction,
  type TerminalCommandManifestEntry,
} from "../contracts/command-surface";
import { buildTerminalLeafHelpText, hasTerminalTopicHelp } from "../contracts/command-help-contract";
import { listCommandArgFlagsForHelp } from "../contracts/command-args";
import { buildTerminalActionExample, buildTerminalEntryUsage } from "./terminal-command-usage";
import { listGlobalCliFlags } from "./cli-contract";
import { normalizeText } from "./text-normalization";

interface BuildCommandSchemaArgs {
  audience: CliAudience;
  command: string;
  subcommand: string;
}

function buildCommandSchema(args: BuildCommandSchemaArgs): Record<string, unknown> {
  const normalizedCommand = normalizeText(args.command).toLowerCase();
  const normalizedSubcommand = normalizeText(args.subcommand).toLowerCase();
  if (!normalizedCommand) {
    return buildCommandCollectionSchema(args.audience);
  }

  const commandSchema = buildSpecificCommandSchema({
    audience: args.audience,
    command: normalizedCommand,
    subcommand: normalizedSubcommand,
  });
  if (commandSchema) {
    return commandSchema;
  }

  if (!normalizedSubcommand && hasTerminalTopicHelp(normalizedCommand)) {
    return buildTopicSchema(args.audience, normalizedCommand);
  }

  throw new Error(
    `${args.audience} schema target not found: ${[normalizedCommand, normalizedSubcommand].filter(Boolean).join(" ")}`
  );
}

function buildCommandCollectionSchema(audience: CliAudience): Record<string, unknown> {
  const commands = listCommandActions()
    .filter((action) => action.audience === audience && action.terminal.length && action.entrypointType !== "weixin")
    .map((action) => buildActionSchema(action));

  return {
    type: "command_collection",
    audience,
    commands,
    globalFlags: listGlobalCliFlags(),
  };
}

function buildTopicSchema(audience: CliAudience, topic: string): Record<string, unknown> {
  const commands = listTerminalCommandManifest()
    .filter((entry) => entry.audience === audience && entry.helpTopic === topic)
    .map((entry) => buildActionSchema(findActionForManifest(entry)));

  return {
    type: "command_topic",
    audience,
    topic,
    commands,
    globalFlags: listGlobalCliFlags(),
  };
}

function buildSpecificCommandSchema({
  audience,
  command,
  subcommand,
}: BuildCommandSchemaArgs): Record<string, unknown> | null {
  const directManifest = findTerminalCommandManifest(command, subcommand);
  if (directManifest && directManifest.audience === audience) {
    return buildActionSchema(findActionForManifest(directManifest));
  }

  const action = listCommandActions().find((entry) => matchesSchemaLookup(entry, audience, command, subcommand));
  return action ? buildActionSchema(action) : null;
}

function buildActionSchema(action: CommandAction): Record<string, unknown> {
  const flags = listCommandArgFlagsForHelp(action.argsSchemaKey).map((flag) => ({
    defaultValue: flag.defaultValue,
    description: flag.description || "",
    keys: [...flag.keys],
    name: flag.name,
    placeholder: flag.placeholder || "",
    required: Boolean(flag.required),
    type: flag.type,
  }));
  const helpText = action.help.detail === "leaf"
    ? buildTerminalLeafHelpText(action.help.leafKey)
    : "";

  return {
    type: "command",
    action: action.action,
    audience: action.audience,
    authRequirement: action.authRequirement,
    entrypointType: action.entrypointType,
    groupId: action.groupId,
    helpText,
    key: [action.command, action.subcommand].filter(Boolean).join(" "),
    mutability: action.mutability,
    safetyTier: action.safetyTier,
    scriptName: action.scriptName || "",
    summary: action.summary,
    terminal: [...action.terminal],
    usage: {
      public: buildTerminalActionExample(action, { audience: "public", includeArgs: true }),
      repo: buildTerminalActionExample(action, { audience: "repo", includeArgs: true }),
    },
    output: {
      envelope: {
        ok: "true|false|partial",
        data: "command-specific payload",
        error: "{ code, message, retryable, hint?, context? }",
        meta: "optional object",
        next: "optional string[]",
      },
      ttyDefault: "text",
      nonTtyDefault: "json",
    },
    args: {
      command: flags,
      global: listGlobalCliFlags(),
    },
  };
}

function findActionForManifest(entry: TerminalCommandManifestEntry): CommandAction {
  const action = listCommandActions().find((candidate) => candidate.action === entry.action);
  if (!action) {
    throw new Error(`missing action for manifest entry: ${entry.key}`);
  }
  return action;
}

function matchesSchemaLookup(
  action: CommandAction,
  audience: CliAudience,
  command: string,
  subcommand: string,
): boolean {
  if (action.audience !== audience || action.entrypointType === "weixin") {
    return false;
  }
  const actionKey = [action.command, action.subcommand].filter(Boolean).join(" ");
  const lookupKey = [command, subcommand].filter(Boolean).join(" ");
  if (actionKey && actionKey === lookupKey) {
    return true;
  }
  if (!subcommand && normalizeText(action.scriptName).toLowerCase() === command) {
    return true;
  }
  return !subcommand && action.terminal.some((entry) => normalizeText(entry).toLowerCase() === command);
}

export { buildCommandSchema };
