import type { HostRecipeDescriptor } from "../../contracts/host-recipe";
import { findHostRecipe } from "../../contracts/host-recipe";

export function resolveGenericShellRecipe(): HostRecipeDescriptor {
  return findHostRecipe("generic-shell") || {
    id: "generic-shell",
    label: "Generic Shell",
    description: "Generic shell fallback",
    transport: "cli_stdio",
    modeClasses: ["hosted-skill-only", "cli-only"],
    capabilities: ["invokeCodekseiAction"],
    supportsDelegatedCheckin: false,
    supportsToolSurface: true,
  };
}
