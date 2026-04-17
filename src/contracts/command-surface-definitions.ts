import type {
  CommandActionDefinition,
  CommandAudienceDefinition,
  CommandAuthRequirementDefinition,
  CommandHelpDefinition,
  CommandHostDependencyDefinition,
  CommandHostProfileIdDefinition,
  CommandHostSupportTierDefinition,
  CommandMutabilityDefinition,
  CommandSafetyTierDefinition,
} from "./command-surface-definition-types";
import { COMMAND_GROUP_DEFINITIONS } from "./command-group-definitions";
import { INTROSPECTION_COMMAND_ACTION_DEFINITIONS } from "./command-surface-actions-introspection";
import { LIFECYCLE_COMMAND_ACTION_DEFINITIONS } from "./command-surface-actions-lifecycle";
import { WORKSPACE_COMMAND_ACTION_DEFINITIONS } from "./command-surface-actions-workspace";
import { APPROVAL_COMMAND_ACTION_DEFINITIONS } from "./command-surface-actions-approval";
import { PROJECTS_COMMAND_ACTION_DEFINITIONS } from "./command-surface-actions-projects";
import { CAPABILITIES_COMMAND_ACTION_DEFINITIONS } from "./command-surface-actions-capabilities";
import {
  COMMAND_AUDIENCE_OVERRIDES,
  COMMAND_AUTH_OVERRIDES,
  COMMAND_HOST_DEPENDENCY_OVERRIDES,
  COMMAND_HOST_PROFILE_OVERRIDES,
  COMMAND_HOST_SUPPORT_TIER_OVERRIDES,
  COMMAND_MUTABILITY_OVERRIDES,
  COMMAND_SAFETY_OVERRIDES,
} from "./command-surface-classification";

export type {
  CommandActionDefinition,
  CommandApprovalDefinition,
  CommandAudienceDefinition,
  CommandAuthRequirementDefinition,
  CommandGroupDefinition,
  CommandHelpDefinition,
  CommandHostDependencyDefinition,
  CommandHostProfileIdDefinition,
  CommandHostSupportTierDefinition,
  CommandMutabilityDefinition,
  CommandSafetyTierDefinition,
  CommandSideEffectDefinition,
} from "./command-surface-definition-types";

export {
  COMMAND_AUDIENCE_OVERRIDES,
  COMMAND_AUTH_OVERRIDES,
  COMMAND_GROUP_DEFINITIONS,
  COMMAND_HOST_DEPENDENCY_OVERRIDES,
  COMMAND_HOST_PROFILE_OVERRIDES,
  COMMAND_HOST_SUPPORT_TIER_OVERRIDES,
  COMMAND_MUTABILITY_OVERRIDES,
  COMMAND_SAFETY_OVERRIDES,
};

// region Canonical data composition
export const COMMAND_ACTION_DEFINITION_SLICES = {
  introspection: INTROSPECTION_COMMAND_ACTION_DEFINITIONS,
  lifecycle: LIFECYCLE_COMMAND_ACTION_DEFINITIONS,
  workspace: WORKSPACE_COMMAND_ACTION_DEFINITIONS,
  approval: APPROVAL_COMMAND_ACTION_DEFINITIONS,
  projects: PROJECTS_COMMAND_ACTION_DEFINITIONS,
  capabilities: CAPABILITIES_COMMAND_ACTION_DEFINITIONS,
} as const;

export const COMMAND_ACTION_DEFINITIONS = [
  ...COMMAND_ACTION_DEFINITION_SLICES.introspection,
  ...COMMAND_ACTION_DEFINITION_SLICES.lifecycle,
  ...COMMAND_ACTION_DEFINITION_SLICES.workspace,
  ...COMMAND_ACTION_DEFINITION_SLICES.approval,
  ...COMMAND_ACTION_DEFINITION_SLICES.projects,
  ...COMMAND_ACTION_DEFINITION_SLICES.capabilities,
] as const satisfies readonly CommandActionDefinition[];
// endregion

// region Derived type unions
type CommandActionDefinitionRecord = typeof COMMAND_ACTION_DEFINITIONS[number];
type ActionWithHelp = Extract<CommandActionDefinitionRecord, { help: CommandHelpDefinition }>;
type CliTerminalActionDefinition = Extract<CommandActionDefinitionRecord, {
  entrypointType: "cli";
  command: string;
}>;
type CliTerminalActionWithHelp = Extract<CliTerminalActionDefinition, { help: CommandHelpDefinition }>;
type ExtractStringField<T, K extends PropertyKey> = T extends Record<K, infer V> ? Extract<V, string> : never;
type ExtractHelpStringField<T, K extends keyof CommandHelpDefinition> = T extends { help: infer H }
  ? H extends Record<K, infer V>
    ? Extract<V, string>
    : never
  : never;

export type CommandActionId = CommandActionDefinitionRecord["action"];
export type CommandAudience = CommandAudienceDefinition;
export type CommandArgsSchemaKey = ExtractStringField<CommandActionDefinitionRecord, "argsSchemaKey">;
export type CommandAuthRequirement = CommandAuthRequirementDefinition;
export type CommandEntrypointType = CommandActionDefinitionRecord["entrypointType"];
export type CommandGroupId = typeof COMMAND_GROUP_DEFINITIONS[number]["id"];
export type CommandHelpDetail = CommandHelpDefinition["detail"];
export type CommandHelpLeafKey = ExtractHelpStringField<ActionWithHelp, "leafKey">;
export type CommandHelpTopic = ExtractHelpStringField<ActionWithHelp, "topic">;
export type CommandHostDependency = CommandHostDependencyDefinition;
export type CommandHostProfileId = CommandHostProfileIdDefinition;
export type CommandHostSupportTier = CommandHostSupportTierDefinition;
export type CommandKind = ExtractStringField<CommandActionDefinitionRecord, "kind">;
export type CommandMutability = CommandMutabilityDefinition;
export type CommandRunnerId = ExtractStringField<CommandActionDefinitionRecord, "runner">;
export type CommandSafetyTier = CommandSafetyTierDefinition;
export type CommandScriptName = ExtractStringField<CommandActionDefinitionRecord, "scriptName">;
export type CommandStatus = ExtractStringField<CommandActionDefinitionRecord, "status">;
export type CommandTimelineSubcommand = ExtractStringField<CommandActionDefinitionRecord, "timelineSubcommand">;
export type PlannedTerminalTopic = Exclude<ExtractHelpStringField<CliTerminalActionWithHelp, "topic">, "">;
export type CommandLeafHelpKey = Extract<ActionWithHelp, {
  help: { detail: "leaf"; leafKey: string };
}>["help"]["leafKey"];
export type CommandTopicOnlyLeafKey = Extract<ActionWithHelp, {
  help: { detail: "topic_only"; leafKey: string };
}>["help"]["leafKey"];
// endregion

const AUDIENCE_OVERRIDES: Readonly<Partial<Record<CommandActionId, CommandAudienceDefinition>>> = COMMAND_AUDIENCE_OVERRIDES;
const AUTH_OVERRIDES: Readonly<Partial<Record<CommandActionId, CommandAuthRequirementDefinition>>> = COMMAND_AUTH_OVERRIDES;
const HOST_DEPENDENCY_OVERRIDES: Readonly<Partial<Record<CommandActionId, readonly CommandHostDependencyDefinition[]>>> = COMMAND_HOST_DEPENDENCY_OVERRIDES;
const HOST_PROFILE_OVERRIDES: Readonly<Partial<Record<CommandActionId, readonly CommandHostProfileIdDefinition[]>>> = COMMAND_HOST_PROFILE_OVERRIDES;
const HOST_SUPPORT_TIER_OVERRIDES: Readonly<Partial<Record<CommandActionId, CommandHostSupportTierDefinition>>> = COMMAND_HOST_SUPPORT_TIER_OVERRIDES;
const MUTABILITY_OVERRIDES: Readonly<Partial<Record<CommandActionId, CommandMutabilityDefinition>>> = COMMAND_MUTABILITY_OVERRIDES;
const SAFETY_OVERRIDES: Readonly<Partial<Record<CommandActionId, CommandSafetyTierDefinition>>> = COMMAND_SAFETY_OVERRIDES;

// region Resolution helpers
export function resolveCommandAudienceDefinition(
  actionId: CommandActionId,
  entrypointType: CommandActionDefinition["entrypointType"],
): CommandAudienceDefinition {
  if (AUDIENCE_OVERRIDES[actionId]) {
    return AUDIENCE_OVERRIDES[actionId] || "public";
  }
  return entrypointType === "script" ? "operator" : "public";
}

export function resolveCommandAuthRequirementDefinition(actionId: CommandActionId): CommandAuthRequirementDefinition {
  return AUTH_OVERRIDES[actionId] || "none";
}

export function resolveCommandHostDependenciesDefinition(actionId: CommandActionId): readonly CommandHostDependencyDefinition[] {
  return HOST_DEPENDENCY_OVERRIDES[actionId] || Object.freeze([]);
}

export function resolveCommandHostProfileIdsDefinition(actionId: CommandActionId): readonly CommandHostProfileIdDefinition[] {
  return HOST_PROFILE_OVERRIDES[actionId]
    || Object.freeze(["codex-mode", "hosted-mode"]);
}

export function resolveCommandHostSupportTierDefinition(actionId: CommandActionId): CommandHostSupportTierDefinition {
  return HOST_SUPPORT_TIER_OVERRIDES[actionId] || "host_neutral";
}

export function resolveCommandMutabilityDefinition(actionId: CommandActionId): CommandMutabilityDefinition {
  return MUTABILITY_OVERRIDES[actionId] || "read";
}

export function resolveCommandSafetyTierDefinition(actionId: CommandActionId): CommandSafetyTierDefinition {
  return SAFETY_OVERRIDES[actionId] || "open";
}
// endregion
