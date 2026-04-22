import type {
  CodekseiChannelProvider,
  CodekseiExecutionMode,
  CodekseiRuntimeProvider,
} from "../../core/config-value-types";
import type { HostModeClass, HostTransport } from "./attachment-capabilities";
import type { HostRecipeDescriptor, HostRecipeId } from "./host-recipe";

export const HOST_ATTACHMENT_CONTRACT_VERSION = 2 as const;
export const HOST_BOOTSTRAP_SNAPSHOT_VERSION = 2 as const;
export const HOST_CORE_INVARIANT = "codeksei-core-owned" as const;
export const HOST_SCHEDULE_TRUTH_OWNER = "codeksei" as const;

export interface HostIdentity {
  profile: "codex-mode" | "hosted-mode" | "unsupported";
  legacyProfileIds: string[];
  mode: CodekseiExecutionMode;
  runtimeProvider: CodekseiRuntimeProvider;
  runtimeOwner: "codeksei" | "host";
  channelProvider: CodekseiChannelProvider;
  channelKind: string;
  deliveryRecipe: string;
}

export interface HostEntrypointManifest {
  manifest: string[];
  bootstrap: string[];
  doctor: string[];
  smoke: string[];
  seedProactive: string[];
  claimCheckin: string[];
  settleCheckin: string[];
  finalizeCheckin: string[];
  render: string[];
  companionRemember: string[];
  diaryWrite: string[];
  timelineEvent: string[];
  timelineCategories: string[];
  timelineRead: string[];
  reviewNightly: string[];
  noteAuto: string[];
  projectRadar: string[];
  reminderWrite: string[];
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
    | "finalizeCheckin"
    | "onboardingStart"
    | "onboardingStep"
    | "onboardingStatus"
    | "companionRemember"
    | "contextBriefing"
    | "diaryWrite"
    | "timelineEvent"
    | "timelineCategories"
    | "timelineRead"
    | "reviewNightly"
    | "noteAuto"
    | "projectRadar"
    | "reminderWrite";
  reason: string;
}

export interface HostWorkflowHint {
  id:
    | "bootstrap_and_install_skill"
    | "first_activation_onboarding"
    | "ongoing_companion_memory"
    | "proactive_checkin"
    | "proactive_continuity"
    | "time_block_capture"
    | "cutover_bookkeeping"
    | "sleep_closeout"
    | "project_continuity_write"
    | "context_handoff_refresh"
    | "user_correction_persistence";
  trigger: string;
  steps: HostWorkflowStep[];
}

export interface HostAttachmentManifest {
  contractVersion: typeof HOST_ATTACHMENT_CONTRACT_VERSION;
  coreInvariant: typeof HOST_CORE_INVARIANT;
  scheduleTruthOwner: typeof HOST_SCHEDULE_TRUTH_OWNER;
  hostIdentity: HostIdentity;
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
