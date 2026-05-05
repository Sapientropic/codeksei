export interface CommandGroupDefinition {
  id: string;
  label: string;
}

export interface CommandHelpDefinition {
  topic: string;
  leafKey: string;
  detail: "leaf" | "topic_only";
}

export interface CommandSideEffectDefinition {
  kind: string;
  target: string;
  when?: string;
}

export interface CommandApprovalDefinition {
  autoApprove?: boolean;
}

export type CommandAudienceDefinition = "operator" | "public";
export type CommandAuthRequirementDefinition = "context_token" | "none" | "runtime_bootstrap" | "weixin_account";
export type CommandHostDependencyDefinition =
  | "bridge_file_delivery"
  | "bridge_queue"
  | "bridge_runtime"
  | "context_token"
  | "hosted_repo_local_cron"
  | "hosted_repo_local_delivery"
  | "hosted_companion_skill"
  | "hosted_session_lookup"
  | "weixin_account";
export type CommandHostProfileIdDefinition = "codex-mode" | "claudecode-mode" | "hosted-mode";
export type CommandHostSupportTierDefinition = "bridge_only" | "bridge_state_dependent" | "host_neutral" | "hosted_ready";
export type CommandMutabilityDefinition = "bootstrap" | "long_running" | "read" | "write";
export type CommandSafetyTierDefinition = "open" | "operator" | "warned";

export interface CommandActionDefinition {
  action: string;
  groupId: string;
  summary: string;
  terminal: readonly string[];
  weixin: readonly string[];
  status: string;
  entrypointType: "cli" | "script" | "weixin";
  scriptName?: string;
  command?: string;
  subcommand?: string;
  runner?: string;
  argsSchemaKey?: string;
  kind?: string;
  timelineSubcommand?: string;
  help?: CommandHelpDefinition;
  approval?: CommandApprovalDefinition;
  hostDependencies?: readonly CommandHostDependencyDefinition[];
  hostSupportTier?: CommandHostSupportTierDefinition;
  sideEffects?: readonly CommandSideEffectDefinition[];
}
