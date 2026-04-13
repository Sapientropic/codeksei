import {
  COMMAND_ACTION_DEFINITIONS,
  COMMAND_GROUP_DEFINITIONS,
  type CommandActionDefinition,
  type CommandActionId,
  type CommandAudience,
  type CommandArgsSchemaKey,
  type CommandAuthRequirement,
  type CommandEntrypointType,
  type CommandGroupId,
  type CommandHelpDetail,
  type CommandHelpLeafKey,
  type CommandHelpTopic,
  type CommandKind,
  type CommandMutability,
  type CommandRunnerId,
  type CommandSafetyTier,
  type CommandScriptName,
  type CommandStatus,
  type CommandTimelineSubcommand,
  resolveCommandAudienceDefinition,
  resolveCommandAuthRequirementDefinition,
  resolveCommandMutabilityDefinition,
  resolveCommandSafetyTierDefinition,
} from "./command-surface-definitions";

export type {
  CommandActionId,
  CommandAudience,
  CommandArgsSchemaKey,
  CommandAuthRequirement,
  CommandEntrypointType,
  CommandGroupId,
  CommandHelpDetail,
  CommandHelpLeafKey,
  CommandHelpTopic,
  CommandKind,
  CommandMutability,
  CommandRunnerId,
  CommandSafetyTier,
  CommandScriptName,
  CommandStatus,
  CommandTimelineSubcommand,
  PlannedTerminalTopic,
  CommandLeafHelpKey,
  CommandTopicOnlyLeafKey,
} from "./command-surface-definitions";

interface CommandGroupMeta {
  id: CommandGroupId;
  label: string;
}

interface CommandHelp {
  topic: CommandHelpTopic | "";
  leafKey: CommandActionId;
  detail: CommandHelpDetail | "";
}

export interface CommandApproval {
  autoApprove: boolean;
}

export interface CommandAction {
  action: CommandActionId;
  audience: CommandAudience;
  authRequirement: CommandAuthRequirement;
  groupId: CommandGroupId;
  summary: string;
  terminal: string[];
  weixin: string[];
  status: CommandStatus;
  entrypointType: CommandEntrypointType;
  scriptName: CommandScriptName | "";
  command: string;
  subcommand: string;
  runner: CommandRunnerId | "";
  argsSchemaKey: CommandArgsSchemaKey | "";
  kind: CommandKind | "";
  mutability: CommandMutability;
  safetyTier: CommandSafetyTier;
  timelineSubcommand: CommandTimelineSubcommand | "";
  help: Readonly<CommandHelp>;
  approval: Readonly<CommandApproval>;
}

export interface TerminalCommandManifestEntry {
  key: string;
  audience: CommandAudience;
  authRequirement: CommandAuthRequirement;
  command: string;
  subcommand: string;
  action: CommandActionId;
  runner: CommandRunnerId;
  argsSchemaKey: CommandArgsSchemaKey | "";
  helpTopic: CommandHelpTopic | "";
  kind: CommandKind | "";
  mutability: CommandMutability;
  safetyTier: CommandSafetyTier;
  timelineSubcommand: CommandTimelineSubcommand | "";
  scriptName: CommandScriptName | "";
  approval: CommandApproval;
  entrypointType: CommandEntrypointType;
}

export interface CommandGroup {
  id: CommandGroupId;
  label: string;
  actions: CommandAction[];
}

const COMMAND_GROUP_METADATA = Object.freeze<readonly CommandGroupMeta[]>(
  COMMAND_GROUP_DEFINITIONS.map((group) => Object.freeze({
    id: group.id,
    label: String(group.label || "").trim(),
  }))
);

const COMMAND_ACTIONS = Object.freeze<readonly CommandAction[]>(
  COMMAND_ACTION_DEFINITIONS.map(defineAction)
);

const COMMAND_ACTIONS_BY_ID = new Map<string, CommandAction>(
  COMMAND_ACTIONS.map((entry): [string, CommandAction] => [entry.action, entry])
);
const TERMINAL_COMMAND_MANIFEST = Object.freeze<readonly TerminalCommandManifestEntry[]>(
  COMMAND_ACTIONS
    .filter((entry): entry is CommandAction & { runner: CommandRunnerId } => entry.entrypointType === "cli" && Boolean(entry.command) && Boolean(entry.runner))
    .map((entry): TerminalCommandManifestEntry => ({
      key: [entry.command, entry.subcommand].filter(Boolean).join(" "),
      audience: entry.audience,
      authRequirement: entry.authRequirement,
      command: entry.command,
      subcommand: entry.subcommand,
      action: entry.action,
      runner: entry.runner,
      argsSchemaKey: entry.argsSchemaKey,
      helpTopic: entry.help.topic,
      kind: entry.kind,
      mutability: entry.mutability,
      safetyTier: entry.safetyTier,
      timelineSubcommand: entry.timelineSubcommand,
      scriptName: entry.scriptName,
      approval: { ...entry.approval },
      entrypointType: entry.entrypointType,
    }))
);
const TERMINAL_COMMAND_MANIFEST_BY_KEY = new Map(
  TERMINAL_COMMAND_MANIFEST.map((entry): [string, TerminalCommandManifestEntry] => [entry.key, entry])
);
const TERMINAL_COMMAND_MANIFEST_BY_SCRIPT_NAME = new Map(
  TERMINAL_COMMAND_MANIFEST
    .filter((entry) => entry.scriptName)
    .map((entry): [string, TerminalCommandManifestEntry] => [normalizeCommandLookupKey(entry.scriptName), entry])
);

function defineAction(entry: CommandActionDefinition): CommandAction {
  const actionId = normalizeCommandLookupKey(entry.action) as CommandActionId;
  const entrypointType = normalizeCommandLookupKey(entry.entrypointType) as CommandEntrypointType;
  return Object.freeze({
    action: actionId,
    audience: resolveCommandAudienceDefinition(actionId, entry.entrypointType),
    authRequirement: resolveCommandAuthRequirementDefinition(actionId),
    groupId: normalizeCommandLookupKey(entry.groupId) as CommandGroupId,
    summary: String(entry.summary || "").trim(),
    terminal: normalizeStringList(entry.terminal),
    weixin: normalizeStringList(entry.weixin),
    status: (normalizeCommandLookupKey(entry.status) || "active") as CommandStatus,
    entrypointType,
    scriptName: String(entry.scriptName || "").trim() as CommandScriptName | "",
    command: normalizeCommandLookupKey(entry.command),
    subcommand: normalizeCommandLookupKey(entry.subcommand),
    runner: String(entry.runner || "").trim() as CommandRunnerId | "",
    argsSchemaKey: String(entry.argsSchemaKey || "").trim() as CommandArgsSchemaKey | "",
    kind: String(entry.kind || "").trim() as CommandKind | "",
    mutability: resolveCommandMutabilityDefinition(actionId),
    safetyTier: resolveCommandSafetyTierDefinition(actionId),
    timelineSubcommand: String(entry.timelineSubcommand || "").trim() as CommandTimelineSubcommand | "",
    help: Object.freeze({
      topic: normalizeCommandLookupKey(entry.help?.topic) as CommandHelpTopic | "",
      // Fallback to the action id so every action still exposes a stable leaf key.
      leafKey: (normalizeCommandLookupKey(entry.help?.leafKey) || normalizeCommandLookupKey(entry.action)) as CommandActionId,
      detail: normalizeCommandLookupKey(entry.help?.detail) as CommandHelpDetail | "",
    }),
    approval: Object.freeze({
      autoApprove: Boolean(entry.approval?.autoApprove),
    }),
  });
}

function normalizeStringList(value: readonly string[] | undefined): string[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function listCommandActions(): CommandAction[] {
  return COMMAND_ACTIONS.map(cloneAction);
}

function findCommandAction(action: unknown): CommandAction | null {
  const entry = COMMAND_ACTIONS_BY_ID.get(normalizeCommandLookupKey(action));
  return entry ? cloneAction(entry) : null;
}

function listCommandGroups(): CommandGroup[] {
  return COMMAND_GROUP_METADATA.map((group) => ({
    ...group,
    actions: COMMAND_ACTIONS
      .filter((entry) => entry.groupId === group.id)
      .map(cloneAction),
  }));
}

function listTerminalCommandManifest(): TerminalCommandManifestEntry[] {
  return TERMINAL_COMMAND_MANIFEST.map((entry) => ({
    ...entry,
    approval: { ...entry.approval },
  }));
}

function findTerminalCommandManifest(command: unknown, subcommand: string = ""): TerminalCommandManifestEntry | null {
  const key = [normalizeCommandLookupKey(command), normalizeCommandLookupKey(subcommand)].filter(Boolean).join(" ");
  const entry = TERMINAL_COMMAND_MANIFEST_BY_KEY.get(key);
  return entry ? { ...entry, approval: { ...entry.approval } } : null;
}

function findTerminalManifestByScriptName(scriptName: unknown): TerminalCommandManifestEntry | null {
  const entry = TERMINAL_COMMAND_MANIFEST_BY_SCRIPT_NAME.get(normalizeCommandLookupKey(scriptName));
  return entry ? { ...entry, approval: { ...entry.approval } } : null;
}

function cloneAction(entry: CommandAction): CommandAction {
  return {
    ...entry,
    terminal: [...entry.terminal],
    weixin: [...entry.weixin],
    help: { ...entry.help },
    approval: { ...entry.approval },
  };
}

function normalizeCommandLookupKey(value: unknown): string {
  // Only internal command/manifest identifiers should fold case here.
  // User-visible text stays trim-only in owner-local helpers elsewhere.
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export {
  findCommandAction,
  findTerminalCommandManifest,
  findTerminalManifestByScriptName,
  listCommandActions,
  listCommandGroups,
  listTerminalCommandManifest,
};
