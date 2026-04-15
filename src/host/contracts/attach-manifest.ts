import type { HostModeClass, HostTransport } from "./attachment-capabilities";
import type { HostRecipeDescriptor, HostRecipeId } from "./host-recipe";

export interface HostEntrypointManifest {
  manifest: string[];
  bootstrap: string[];
  doctor: string[];
  smoke: string[];
  seedProactive: string[];
  claimCheckin: string[];
  settleCheckin: string[];
  render: string[];
}

export interface HostAttachmentManifest {
  contractVersion: 1;
  runtimeInvariant: "bridge-full";
  transport: HostTransport;
  modeClass: HostModeClass | "unsupported";
  provider: HostRecipeId | "";
  supported: boolean;
  reason: string;
  install: {
    preferred: string[];
    fallback: string[][];
  };
  entrypoints: HostEntrypointManifest;
  recipes: HostRecipeDescriptor[];
}
