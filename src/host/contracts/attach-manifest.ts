import type { HostModeClass, HostTransport } from "./attachment-capabilities";
import type { HostRecipeDescriptor, HostRecipeId } from "./host-recipe";

export const HOST_ATTACHMENT_CONTRACT_VERSION = 1 as const;
export const HOST_BOOTSTRAP_SNAPSHOT_VERSION = 1 as const;

export interface HostEntrypointManifest {
  manifest: string[];
  bootstrap: string[];
  doctor: string[];
  smoke: string[];
  seedProactive: string[];
  claimCheckin: string[];
  settleCheckin: string[];
  render: string[];
  companionRemember: string[];
  onboardingStart: string[];
  onboardingStep: string[];
  onboardingStatus: string[];
  contextBriefing: string[];
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
    | "companionRemember"
    | "contextBriefing";
  reason: string;
}

export interface HostWorkflowHint {
  id:
    | "bootstrap_and_install_skill"
    | "first_activation_onboarding"
    | "ongoing_companion_memory"
    | "proactive_checkin"
    | "context_handoff_refresh"
    | "user_correction_persistence";
  trigger: string;
  steps: HostWorkflowStep[];
}

export interface HostAttachmentManifest {
  contractVersion: typeof HOST_ATTACHMENT_CONTRACT_VERSION;
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
  upgrade: {
    bootstrapSnapshotVersion: typeof HOST_BOOTSTRAP_SNAPSHOT_VERSION;
    startupDoctorRequired: true;
    companionSkill: {
      version: string;
      hash: string;
    };
    rerunBootstrapWhen: string[];
    reinstallSkillWhen: string[];
  };
  recommendedWorkflows: HostWorkflowHint[];
  recipes: HostRecipeDescriptor[];
}
