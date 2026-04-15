import type { HostCapabilityId, HostModeClass, HostTransport } from "./attachment-capabilities";

export const HOST_RECIPE_IDS = [
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
  supportsDelegatedCheckin: boolean;
  supportsToolSurface: boolean;
}

const HOST_RECIPES = Object.freeze<readonly HostRecipeDescriptor[]>([
  Object.freeze({
    id: "hermes",
    label: "Hermes",
    description: "Hermes 托管 runtime/channel，Codeksei 暴露 companion/domain workflows。",
    transport: "cli_stdio",
    modeClasses: Object.freeze(["hosted-proactive", "hosted-skill-only", "cli-only"] satisfies HostModeClass[]),
    capabilities: Object.freeze([
      "invokeCodekseiAction",
      "deliverVisibleFile",
      "upsertOneShotWake",
      "cancelOneShotWake",
      "persistedOriginRouting",
      "installCompanionSkill",
      "hostSmoke",
      "resolveHostedSession",
      "semanticReviewHybrid",
    ] satisfies HostCapabilityId[]),
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
