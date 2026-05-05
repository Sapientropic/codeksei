import type {
  CodekseiChannelProvider,
  CodekseiRuntimeProvider,
} from "../../core/config-value-types";
import type { HostCapabilityId, HostModeClass, HostTransport } from "./attachment-capabilities";

export const HOST_RECIPE_IDS = [
  "codex",
  "claudecode",
  "hermes",
  "generic-shell",
] as const;

export type HostRecipeId = typeof HOST_RECIPE_IDS[number];

export interface HostRecipeDescriptor {
  id: HostRecipeId;
  label: string;
  description: string;
  transport: HostTransport;
  modeClasses: readonly HostModeClass[];
  capabilities: readonly HostCapabilityId[];
  runtimeProviders: readonly CodekseiRuntimeProvider[];
  channelProviders: readonly CodekseiChannelProvider[];
  channelKinds: readonly string[];
  defaultDeliveryRecipe: string;
  supportsDelegatedCheckin: boolean;
  supportsToolSurface: boolean;
}

const HOST_RECIPES = Object.freeze<readonly HostRecipeDescriptor[]>([
  Object.freeze({
    id: "codex",
    label: "Codex",
    description: "Codeksei 托管 Codex runtime 与 first-party channel bridge。",
    transport: "cli_stdio",
    modeClasses: Object.freeze(["codex-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "invokeCodekseiAction",
      "deliverVisibleText",
      "deliverVisibleFile",
      "bridgeRuntimeLifecycle",
      "bridgeQueueAccess",
      "contextTokenAccess",
      "weixinAccountAccess",
      "semanticReviewHybrid",
    ] satisfies HostCapabilityId[]),
    runtimeProviders: Object.freeze(["codex"] satisfies CodekseiRuntimeProvider[]),
    channelProviders: Object.freeze(["codeksei"] satisfies CodekseiChannelProvider[]),
    channelKinds: Object.freeze(["weixin"] satisfies string[]),
    defaultDeliveryRecipe: "codeksei-weixin-bridge",
    supportsDelegatedCheckin: true,
    supportsToolSurface: true,
  }),
  Object.freeze({
    id: "claudecode",
    label: "Claude Code",
    description: "Codeksei 托管 Claude Code runtime 与 first-party channel bridge。",
    transport: "cli_stdio",
    modeClasses: Object.freeze(["claudecode-managed"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "invokeCodekseiAction",
      "deliverVisibleText",
      "deliverVisibleFile",
      "bridgeRuntimeLifecycle",
      "bridgeQueueAccess",
      "contextTokenAccess",
      "weixinAccountAccess",
      "semanticReviewHybrid",
    ] satisfies HostCapabilityId[]),
    runtimeProviders: Object.freeze(["claudecode"] satisfies CodekseiRuntimeProvider[]),
    channelProviders: Object.freeze(["codeksei"] satisfies CodekseiChannelProvider[]),
    channelKinds: Object.freeze(["weixin"] satisfies string[]),
    defaultDeliveryRecipe: "codeksei-weixin-bridge",
    supportsDelegatedCheckin: true,
    supportsToolSurface: false,
  }),
  Object.freeze({
    id: "hermes",
    label: "Hermes",
    description: "Hermes 托管 runtime/channel，Codeksei 暴露 companion/domain workflows。",
    transport: "cli_stdio",
    modeClasses: Object.freeze(["hosted-proactive", "hosted-skill-only", "cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "invokeCodekseiAction",
      "deliverVisibleText",
      "deliverVisibleFile",
      "upsertWakeJob",
      "cancelWakeJob",
      "resolveOriginSession",
      "upsertOneShotWake",
      "cancelOneShotWake",
      "persistedOriginRouting",
      "installCompanionSkill",
      "hostSmoke",
      "resolveHostedSession",
      "semanticReviewHybrid",
    ] satisfies HostCapabilityId[]),
    runtimeProviders: Object.freeze(["hermes"] satisfies CodekseiRuntimeProvider[]),
    channelProviders: Object.freeze(["hermes", "host"] satisfies CodekseiChannelProvider[]),
    channelKinds: Object.freeze(["weixin", "discord", "telegram", "feishu", "generic"] satisfies string[]),
    defaultDeliveryRecipe: "hermes-origin",
    supportsDelegatedCheckin: true,
    supportsToolSurface: true,
  }),
  Object.freeze({
    id: "generic-shell",
    label: "Generic Shell",
    description: "只通过本地 CLI attach，适合作为 skill-only / cli-only 的薄接入层。",
    transport: "cli_stdio",
    modeClasses: Object.freeze(["hosted-skill-only", "cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "invokeCodekseiAction",
    ] satisfies HostCapabilityId[]),
    runtimeProviders: Object.freeze(["codex", "claudecode", "hermes"] satisfies CodekseiRuntimeProvider[]),
    channelProviders: Object.freeze(["host"] satisfies CodekseiChannelProvider[]),
    channelKinds: Object.freeze(["none", "discord", "telegram", "feishu", "generic"] satisfies string[]),
    defaultDeliveryRecipe: "generic-shell",
    supportsDelegatedCheckin: false,
    supportsToolSurface: true,
  }),
]);

export function findHostRecipe(recipeId: unknown): HostRecipeDescriptor | null {
  return HOST_RECIPES.find((entry) => entry.id === recipeId) || null;
}

export function listHostRecipes(): HostRecipeDescriptor[] {
  return HOST_RECIPES.map((entry) => ({
    ...entry,
    modeClasses: [...entry.modeClasses],
    capabilities: [...entry.capabilities],
  }));
}
