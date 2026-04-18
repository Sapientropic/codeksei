import type {
  CommandHostDependencyDefinition,
  CommandHostProfileIdDefinition,
  CommandHostSupportTierDefinition,
} from "../contracts/command-surface-definition-types";
import type { HostCapabilityId, HostModeClass } from "./contracts/attachment-capabilities";
import type { HostRecipeId } from "./contracts/host-recipe";

export interface CommandHostAccessDescriptor {
  modeClasses: readonly HostModeClass[];
  capabilities: readonly HostCapabilityId[];
  providerRecipes: readonly HostRecipeId[];
  supportTier: CommandHostSupportTierDefinition;
  enforceCurrentProfile: boolean;
}

const DEFAULT_COMMAND_HOST_ACCESS: CommandHostAccessDescriptor = Object.freeze({
  modeClasses: Object.freeze(["codex-managed", "hosted-skill-only"] satisfies HostModeClass[]),
  capabilities: Object.freeze(["invokeCodekseiAction"] satisfies HostCapabilityId[]),
  providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
  supportTier: "host_neutral",
  enforceCurrentProfile: true,
});

const COMMAND_HOST_ACCESS_OVERRIDES = Object.freeze<Record<string, CommandHostAccessDescriptor>>({
  "app.accounts": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["weixinAccountAccess"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_only",
    enforceCurrentProfile: true,
  }),
  "app.login": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["weixinAccountAccess"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_only",
    enforceCurrentProfile: true,
  }),
  "app.start": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["bridgeRuntimeLifecycle"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_only",
    enforceCurrentProfile: true,
  }),
  "app.shared_start": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["bridgeRuntimeLifecycle"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_only",
    enforceCurrentProfile: true,
  }),
  "app.shared_open": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["bridgeRuntimeLifecycle"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_only",
    enforceCurrentProfile: true,
  }),
  "app.shared_status": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["bridgeRuntimeLifecycle"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_only",
    enforceCurrentProfile: true,
  }),
  "app.shared_watchdog": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["bridgeRuntimeLifecycle"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_only",
    enforceCurrentProfile: true,
  }),
  "app.doctor": Object.freeze({
    modeClasses: Object.freeze(["codex-managed", "hosted-proactive", "hosted-skill-only", "cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["semanticReviewHybrid"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "hosted_ready",
    enforceCurrentProfile: false,
  }),
  "background.install": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["bridgeRuntimeLifecycle"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_only",
    enforceCurrentProfile: true,
  }),
  "background.uninstall": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["bridgeRuntimeLifecycle"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_only",
    enforceCurrentProfile: true,
  }),
  "channel.send_file": Object.freeze({
    modeClasses: Object.freeze(["codex-managed", "hosted-proactive", "hosted-skill-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["deliverVisibleFile", "resolveHostedSession"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "hosted_ready",
    enforceCurrentProfile: true,
  }),
  "operator.hermes.install_skill": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["installCompanionSkill"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "hosted_ready",
    enforceCurrentProfile: false,
  }),
  "operator.hermes.status": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["installCompanionSkill", "semanticReviewHybrid"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "hosted_ready",
    enforceCurrentProfile: false,
  }),
  "operator.hermes.smoke": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["installCompanionSkill", "hostSmoke", "semanticReviewHybrid"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "hosted_ready",
    enforceCurrentProfile: false,
  }),
  "operator.hermes.sync_checkin": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "upsertOneShotWake",
      "cancelOneShotWake",
      "persistedOriginRouting",
      "resolveHostedSession",
      "installCompanionSkill",
    ] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "hosted_ready",
    enforceCurrentProfile: false,
  }),
  "reminder.create": Object.freeze({
    modeClasses: Object.freeze(["codex-managed", "hosted-proactive", "hosted-skill-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "bridgeQueueAccess",
      "contextTokenAccess",
      "weixinAccountAccess",
      "upsertOneShotWake",
      "persistedOriginRouting",
      "resolveHostedSession",
    ] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "hosted_ready",
    enforceCurrentProfile: true,
  }),
  "system.send": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "bridgeQueueAccess",
      "contextTokenAccess",
      "weixinAccountAccess",
    ] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_state_dependent",
    enforceCurrentProfile: true,
  }),
  "system.checkin_poller": Object.freeze({
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "bridgeQueueAccess",
      "bridgeRuntimeLifecycle",
      "weixinAccountAccess",
    ] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze([] satisfies HostRecipeId[]),
    supportTier: "bridge_only",
    enforceCurrentProfile: true,
  }),
  "timeline.screenshot": Object.freeze({
    modeClasses: Object.freeze(["codex-managed", "hosted-proactive", "hosted-skill-only", "cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["invokeCodekseiAction"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "host_neutral",
    enforceCurrentProfile: false,
  }),
  "host.manifest": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze([] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes", "generic-shell"] satisfies HostRecipeId[]),
    supportTier: "host_neutral",
    enforceCurrentProfile: false,
  }),
  "host.bootstrap": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["installCompanionSkill"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes", "generic-shell"] satisfies HostRecipeId[]),
    supportTier: "host_neutral",
    enforceCurrentProfile: false,
  }),
  "host.doctor": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["hostSmoke", "semanticReviewHybrid"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes", "generic-shell"] satisfies HostRecipeId[]),
    supportTier: "host_neutral",
    enforceCurrentProfile: false,
  }),
  "host.smoke": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["hostSmoke"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes", "generic-shell"] satisfies HostRecipeId[]),
    supportTier: "host_neutral",
    enforceCurrentProfile: false,
  }),
  "host.seed_proactive": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "upsertOneShotWake",
      "cancelOneShotWake",
      "persistedOriginRouting",
      "resolveHostedSession",
    ] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "host_neutral",
    enforceCurrentProfile: false,
  }),
  "host.claim_checkin": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "upsertOneShotWake",
      "cancelOneShotWake",
      "persistedOriginRouting",
      "resolveHostedSession",
    ] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "host_neutral",
    enforceCurrentProfile: false,
  }),
  "host.settle_checkin": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "upsertOneShotWake",
      "cancelOneShotWake",
      "persistedOriginRouting",
      "resolveHostedSession",
    ] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes"] satisfies HostRecipeId[]),
    supportTier: "host_neutral",
    enforceCurrentProfile: false,
  }),
  "host.render": Object.freeze({
    modeClasses: Object.freeze(["cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze(["installCompanionSkill"] satisfies HostCapabilityId[]),
    providerRecipes: Object.freeze(["hermes", "generic-shell"] satisfies HostRecipeId[]),
    supportTier: "host_neutral",
    enforceCurrentProfile: false,
  }),
});

export function describeCommandHostAccess(actionId: unknown): CommandHostAccessDescriptor {
  return COMMAND_HOST_ACCESS_OVERRIDES[String(actionId || "").trim()] || DEFAULT_COMMAND_HOST_ACCESS;
}

export function resolveLegacyCommandHostDependencies(
  actionId: unknown,
): readonly CommandHostDependencyDefinition[] {
  const descriptor = describeCommandHostAccess(actionId);
  const dependencies = new Set<CommandHostDependencyDefinition>();

  if (descriptor.capabilities.includes("bridgeRuntimeLifecycle")) {
    dependencies.add("bridge_runtime");
  }
  if (descriptor.capabilities.includes("bridgeQueueAccess")) {
    dependencies.add("bridge_queue");
  }
  if (descriptor.capabilities.includes("contextTokenAccess")) {
    dependencies.add("context_token");
  }
  if (descriptor.capabilities.includes("weixinAccountAccess")) {
    dependencies.add("weixin_account");
  }
  if (descriptor.capabilities.includes("deliverVisibleFile") && descriptor.modeClasses.includes("codex-managed")) {
    dependencies.add("bridge_file_delivery");
  }
  if (descriptor.capabilities.includes("deliverVisibleFile") && descriptor.providerRecipes.includes("hermes")) {
    dependencies.add("hosted_repo_local_delivery");
  }
  if (
    (descriptor.capabilities.includes("upsertOneShotWake")
      || descriptor.capabilities.includes("cancelOneShotWake")
      || descriptor.capabilities.includes("persistedOriginRouting"))
    && descriptor.providerRecipes.includes("hermes")
  ) {
    dependencies.add("hosted_repo_local_cron");
  }
  if (descriptor.capabilities.includes("resolveHostedSession") && descriptor.providerRecipes.includes("hermes")) {
    dependencies.add("hosted_session_lookup");
  }
  if (
    (descriptor.capabilities.includes("installCompanionSkill") || descriptor.capabilities.includes("hostSmoke"))
    && descriptor.providerRecipes.includes("hermes")
  ) {
    dependencies.add("hosted_companion_skill");
  }

  return Object.freeze([...dependencies]);
}

export function resolveLegacyCommandHostProfiles(
  actionId: unknown,
): readonly CommandHostProfileIdDefinition[] {
  const descriptor = describeCommandHostAccess(actionId);
  if (!descriptor.enforceCurrentProfile) {
    return Object.freeze([]);
  }
  const profiles = new Set<CommandHostProfileIdDefinition>();
  if (descriptor.modeClasses.includes("codex-managed")) {
    profiles.add("codex-mode");
  }
  if (
    descriptor.providerRecipes.includes("hermes")
    && descriptor.modeClasses.some((modeClass) => (
      modeClass === "hosted-proactive" || modeClass === "hosted-skill-only"
    ))
  ) {
    profiles.add("hosted-mode");
  }
  return Object.freeze([...profiles]);
}

export function resolveLegacyCommandHostSupportTier(
  actionId: unknown,
): CommandHostSupportTierDefinition {
  return describeCommandHostAccess(actionId).supportTier;
}

export function listCommandHostAccessOverrideIds(): string[] {
  return Object.keys(COMMAND_HOST_ACCESS_OVERRIDES).sort();
}
