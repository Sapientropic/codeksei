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

export interface HostWorkflowStep {
  commandRef:
    | "manifest"
    | "bootstrap"
    | "doctor"
    | "smoke"
    | "render"
    | "seedProactive"
    | "claimCheckin"
    | "settleCheckin"
    | "onboardingStart"
    | "onboardingStep"
    | "onboardingStatus"
    | "contextBriefing";
  reason: string;
}

export interface HostWorkflowHint {
  id:
    | "bootstrap_and_install_skill"
    | "first_activation_onboarding"
    | "proactive_checkin"
    | "context_handoff_refresh"
    | "user_correction_persistence";
  trigger: string;
  steps: HostWorkflowStep[];
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
  recommendedWorkflows: HostWorkflowHint[];
  recipes: HostRecipeDescriptor[];
}
