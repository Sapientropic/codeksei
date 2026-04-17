import type {
  HostAttachmentManifest,
  HostEntrypointManifest,
  HostWorkflowHint,
} from "../contracts/attach-manifest";
import {
  HOST_ATTACHMENT_CONTRACT_VERSION,
  HOST_BOOTSTRAP_SNAPSHOT_VERSION,
} from "../contracts/attach-manifest";
import { resolveHostAttachment, type HostAttachmentConfigInput } from "./model";
import { listHostRecipes } from "../contracts/host-recipe";
import { previewHermesCompanionSkillInstall } from "../recipes/hermes/skill";
import type { HermesHostedSkillConfigInput } from "../recipes/hermes/skill";

export function buildHostEntrypointManifest(): HostEntrypointManifest {
  return {
    manifest: ["codeksei", "host", "manifest", "--format", "json"],
    bootstrap: ["codeksei", "host", "bootstrap", "--ensure-daemon", "--format", "json"],
    doctor: ["codeksei", "host", "doctor", "--format", "json"],
    smoke: ["codeksei", "host", "smoke", "--provider", "hermes", "--format", "json"],
    seedProactive: ["codeksei", "host", "seed-proactive", "--format", "json"],
    claimCheckin: ["codeksei", "host", "claim-checkin", "--format", "json"],
    settleCheckin: ["codeksei", "host", "settle-checkin", "--format", "json"],
    render: ["codeksei", "host", "render", "--provider", "hermes", "--target", "skill", "--format", "json"],
    onboardingStart: ["codeksei", "onboarding", "start", "--format", "json"],
    onboardingStep: ["codeksei", "onboarding", "step", "--format", "json"],
    onboardingStatus: ["codeksei", "onboarding", "status", "--format", "json"],
    contextBriefing: ["codeksei", "context", "briefing", "--format", "json"],
  };
}

export function buildHostAttachmentManifest(
  config: HostAttachmentConfigInput & HermesHostedSkillConfigInput = {},
): HostAttachmentManifest {
  const attachment = resolveHostAttachment(config);
  const entrypoints = buildHostEntrypointManifest();
  const skillPreview = previewHermesCompanionSkillInstall(config);
  return {
    contractVersion: HOST_ATTACHMENT_CONTRACT_VERSION,
    runtimeInvariant: "bridge-full",
    transport: attachment.transport,
    modeClass: attachment.modeClass,
    provider: attachment.provider,
    supported: attachment.supported,
    reason: attachment.reason,
    install: {
      preferred: ["npx", "-y", "codeksei@latest"],
      fallback: [["npm", "install", "-g", "codeksei"]],
    },
    entrypoints,
    upgrade: {
      bootstrapSnapshotVersion: HOST_BOOTSTRAP_SNAPSHOT_VERSION,
      startupDoctorRequired: true,
      companionSkill: {
        version: skillPreview.repoSkillAsset.version,
        hash: skillPreview.repoSkillAsset.hash,
      },
      rerunBootstrapWhen: [
        "The stored host bootstrap snapshot is missing.",
        "The stored manifest contract version is older than the current host manifest contract version.",
        "The stored companion skill hash is older than the repo skill hash exposed by this manifest.",
      ],
      reinstallSkillWhen: [
        "The installed Hermes companion skill is missing.",
        "The installed Hermes companion skill hash differs from the repo skill hash exposed by this manifest.",
      ],
    },
    recommendedWorkflows: buildRecommendedHostWorkflows(),
    recipes: listHostRecipes(),
  };
}

function buildRecommendedHostWorkflows(): HostWorkflowHint[] {
  return [
    {
      id: "bootstrap_and_install_skill",
      trigger: "The host is connecting to Codeksei for the first time or the local companion skill may be missing.",
      steps: [
        {
          commandRef: "manifest",
          reason: "Read the current invariant, recipes, and entrypoints before assuming an integration path.",
        },
        {
          commandRef: "bootstrap",
          reason: "Write canonical config and install the companion skill when the provider is Hermes.",
        },
        {
          commandRef: "doctor",
          reason: "Confirm repo-local prerequisites, skill install state, and semantic-host readiness.",
        },
        {
          commandRef: "smoke",
          reason: "Verify the hosted provider recipe before treating the integration as ready.",
        },
        {
          commandRef: "render",
          reason: "Read the generated host skill if the runtime needs a human-readable decision tree instead of raw CLI discovery.",
        },
      ],
    },
    {
      id: "first_activation_onboarding",
      trigger: "The user is new, profile context is thin, or the host should not pretend it already knows the person.",
      steps: [
        {
          commandRef: "onboardingStatus",
          reason: "Check whether onboarding is not started, already in progress, or already ready.",
        },
        {
          commandRef: "onboardingStart",
          reason: "Start the first activation conversation when there is no active onboarding session yet.",
        },
        {
          commandRef: "onboardingStep",
          reason: "Use the latest user reply to update companion truth and get the next natural follow-up line.",
        },
      ],
    },
    {
      id: "proactive_checkin",
      trigger: "The host is running a delegated proactive wake and needs the default scheduling contract instead of improvising free-form logic.",
      steps: [
        {
          commandRef: "seedProactive",
          reason: "Create or repair the next wake when a one-shot proactive job is needed.",
        },
        {
          commandRef: "claimCheckin",
          reason: "Ask Codeksei whether a proactive pass is due and obtain the current delegated instruction payload.",
        },
        {
          commandRef: "settleCheckin",
          reason: "Report the true completion outcome so Codeksei can keep scheduling and recovery state coherent.",
        },
      ],
    },
    {
      id: "context_handoff_refresh",
      trigger: "The host needs current-state context for proactive judgment or review framing.",
      steps: [
        {
          commandRef: "contextBriefing",
          reason: "Read the controlled context board instead of injecting raw vault notes or guessing from chat memory.",
        },
      ],
    },
    {
      id: "user_correction_persistence",
      trigger: "The user says something that should change future support style, timing, boundaries, or follow-up behavior.",
      steps: [
        {
          commandRef: "onboardingStatus",
          reason: "If onboarding is active or follow-up is still pending, corrections should keep flowing through the onboarding updater.",
        },
        {
          commandRef: "onboardingStep",
          reason: "Persist the correction through the shared extraction path so companion truth and board refresh stay aligned.",
        },
        {
          commandRef: "contextBriefing",
          reason: "Refresh the controlled handoff surface after important corrections if the host needs to inspect the new state immediately.",
        },
      ],
    },
  ];
}
