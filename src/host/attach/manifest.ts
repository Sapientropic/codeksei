import type {
  HostIdentity,
  HostAttachmentManifest,
  HostEntrypointManifest,
  HostWorkflowHint,
} from "../contracts/attach-manifest";
import {
  HOST_CORE_INVARIANT,
  HOST_ATTACHMENT_CONTRACT_VERSION,
  HOST_BOOTSTRAP_SNAPSHOT_VERSION,
  HOST_SCHEDULE_TRUTH_OWNER,
} from "../contracts/attach-manifest";
import { resolveHostAttachment, type HostAttachmentConfigInput } from "./model";
import { listHostRecipes, type HostRecipeId } from "../contracts/host-recipe";
import { previewHermesCompanionSkillInstall } from "../recipes/hermes/skill";
import type { HermesHostedSkillConfigInput } from "../recipes/hermes/skill";
import { normalizeText } from "../../contracts/text-normalization";

export const DEFAULT_HOST_DISCOVERY_PROVIDER = "hermes" as const;

interface HostManifestProviderInput {
  provider?: unknown;
}

export function buildHostedFirstHostAttachmentResolution(
  provider: HostRecipeId = DEFAULT_HOST_DISCOVERY_PROVIDER,
): ReturnType<typeof resolveHostAttachment> {
  if (provider === "codex") {
    return resolveHostAttachment({
      runtime: "codex",
      channelProvider: "codeksei",
      channel: "weixin",
    });
  }
  if (provider === "generic-shell") {
    return resolveHostAttachment({
      runtime: "codex",
      channelProvider: "host",
      channel: "none",
    });
  }
  return resolveHostAttachment({
    runtime: "hermes",
    channelProvider: "hermes",
    channel: "weixin",
  });
}

export function buildHostEntrypointManifest({
  defaultProvider = DEFAULT_HOST_DISCOVERY_PROVIDER,
}: {
  defaultProvider?: HostRecipeId;
} = {}): HostEntrypointManifest {
  const providerArgs = ["--provider", defaultProvider];
  return {
    manifest: ["codeksei", "host", "manifest", "--format", "json"],
    bootstrap: ["codeksei", "host", "bootstrap", ...providerArgs, "--format", "json"],
    doctor: ["codeksei", "host", "doctor", ...providerArgs, "--format", "json"],
    smoke: ["codeksei", "host", "smoke", ...providerArgs, "--format", "json"],
    seedProactive: ["codeksei", "host", "seed-proactive", ...providerArgs, "--format", "json"],
    claimCheckin: ["codeksei", "host", "claim-checkin", ...providerArgs, "--format", "json"],
    settleCheckin: ["codeksei", "host", "settle-checkin", ...providerArgs, "--format", "json"],
    finalizeCheckin: ["codeksei", "host", "finalize-checkin", ...providerArgs, "--format", "json"],
    render: ["codeksei", "host", "render", ...providerArgs, "--target", "skill", "--format", "json"],
    companionRemember: ["codeksei", "companion", "remember", "--format", "json"],
    diaryWrite: ["codeksei", "diary", "write", "--format", "json"],
    timelineEvent: ["codeksei", "timeline", "event", "--format", "json"],
    timelineCategories: ["codeksei", "timeline", "categories", "--format", "json"],
    timelineRead: ["codeksei", "timeline", "read", "--format", "json"],
    reviewNightly: ["codeksei", "review", "nightly", "--format", "json"],
    noteAuto: ["codeksei", "note", "auto", "--format", "json"],
    projectRadar: ["codeksei", "project", "radar", "--format", "json"],
    reminderWrite: ["codeksei", "reminder", "write", "--format", "json"],
    onboardingStart: ["codeksei", "onboarding", "start", "--format", "json"],
    onboardingStep: ["codeksei", "onboarding", "step", "--format", "json"],
    onboardingStatus: ["codeksei", "onboarding", "status", "--format", "json"],
    contextBriefing: ["codeksei", "context", "briefing", "--format", "json"],
  };
}

export function buildHostAttachmentManifest(
  config: HostAttachmentConfigInput & HermesHostedSkillConfigInput & HostManifestProviderInput = {},
): HostAttachmentManifest {
  const provider = normalizeHostManifestProvider(config.provider);
  const attachment = buildHostedFirstHostAttachmentResolution(provider);
  const entrypoints = buildHostEntrypointManifest({ defaultProvider: provider });
  const skillPreview = provider === "hermes"
    ? previewHermesCompanionSkillInstall(config)
    : null;
  return {
    contractVersion: HOST_ATTACHMENT_CONTRACT_VERSION,
    coreInvariant: HOST_CORE_INVARIANT,
    scheduleTruthOwner: HOST_SCHEDULE_TRUTH_OWNER,
    hostIdentity: buildHostIdentity(attachment),
    runtimeInvariant: "bridge-full",
    transport: attachment.transport,
    modeClass: attachment.modeClass,
    provider,
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
        version: skillPreview?.repoSkillAsset.version || "",
        hash: skillPreview?.repoSkillAsset.hash || "",
      },
      rerunBootstrapWhen: [
        "The stored host bootstrap snapshot is missing.",
        "The stored manifest contract version is older than the current host manifest contract version.",
        ...(provider === "hermes"
          ? ["The stored companion skill hash is older than the repo skill hash exposed by this manifest."]
          : []),
      ],
      reinstallSkillWhen: provider === "hermes"
        ? [
          "The installed Hermes companion skill is missing.",
          "The installed Hermes companion skill hash differs from the repo skill hash exposed by this manifest.",
        ]
        : [],
    },
    recommendedWorkflows: buildRecommendedHostWorkflows(),
    recipes: listHostRecipes(),
  };
}

function normalizeHostManifestProvider(value: unknown): HostRecipeId {
  const normalized = normalizeText(value);
  if (normalized === "codex" || normalized === "generic-shell" || normalized === "hermes") {
    return normalized;
  }
  return DEFAULT_HOST_DISCOVERY_PROVIDER;
}

function buildHostIdentity(
  attachment: ReturnType<typeof resolveHostAttachment>,
): HostIdentity {
  return {
    profile: attachment.profile,
    legacyProfileIds: [...attachment.legacyProfileIds],
    mode: attachment.mode,
    runtimeProvider: attachment.runtimeProvider,
    runtimeOwner: attachment.runtimeOwner,
    channelProvider: attachment.channelProvider,
    channelKind: attachment.channelKind,
    deliveryRecipe: attachment.deliveryRecipe,
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
      id: "ongoing_companion_memory",
      trigger: "The user just said something that should change future support style, timing, boundaries, current-state understanding, or likely re-entry behavior.",
      steps: [
        {
          commandRef: "companionRemember",
          reason: "Persist the new fact or correction through the shared ongoing companion-memory pipeline instead of leaving it only in host chat memory.",
        },
        {
          commandRef: "contextBriefing",
          reason: "Refresh the controlled handoff surface after important memory updates when the host needs the new state immediately.",
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
          reason: "Let the cron child record a structured proactive handoff instead of improvising final schedule ownership.",
        },
        {
          commandRef: "finalizeCheckin",
          reason: "Have the main session consume the handoff, decide the true next wake, and keep scheduling/recovery coherent.",
        },
      ],
    },
    {
      id: "proactive_continuity",
      trigger: "A proactive wake already learned something meaningful about the user's current state and the host should preserve continuity instead of leaving it only in chat.",
      steps: [
        {
          commandRef: "contextBriefing",
          reason: "Read the current controlled handoff surface, including any pending proactive handoff the main session should absorb.",
        },
        {
          commandRef: "companionRemember",
          reason: "Persist corrected support style, boundaries, or current-state understanding that should affect future accompaniment.",
        },
        {
          commandRef: "finalizeCheckin",
          reason: "Finalize the proactive handoff only after the main session has decided whether continuity writing or follow-up changed the real next wake.",
        },
      ],
    },
    {
      id: "time_block_capture",
      trigger: "The host notices a concrete work/life block that should become timeline truth while it is still fresh.",
      steps: [
        {
          commandRef: "timelineCategories",
          reason: "Read available category ids before inventing labels for the new time block.",
        },
        {
          commandRef: "timelineEvent",
          reason: "Write the dated time block as structured timeline data instead of leaving it only in conversation.",
        },
        {
          commandRef: "diaryWrite",
          reason: "Mirror the human-readable fact into diary timeline/fragment when it helps later review.",
        },
      ],
    },
    {
      id: "cutover_bookkeeping",
      trigger: "The user finishes, switches tasks, or the host detects a project cutover that should be captured before context is lost.",
      steps: [
        {
          commandRef: "diaryWrite",
          reason: "Close or update the active Todo and, when useful, emit the matching timeline fact in the same command batch.",
        },
        {
          commandRef: "timelineEvent",
          reason: "Record the finished block with start/end time when the cutover has clear temporal boundaries.",
        },
        {
          commandRef: "noteAuto",
          reason: "Persist durable project or companion context when the cutover changes future re-entry behavior.",
        },
        {
          commandRef: "contextBriefing",
          reason: "Refresh the handoff surface after bookkeeping so the next proactive pass sees current truth.",
        },
      ],
    },
    {
      id: "sleep_closeout",
      trigger: "The user is about to sleep, pause for the night, or asks to wrap the day.",
      steps: [
        {
          commandRef: "diaryWrite",
          reason: "Capture the night summary or remaining open loop while the user still remembers it.",
        },
        {
          commandRef: "reviewNightly",
          reason: "Generate the nightly review draft from diary facts instead of relying on chat memory.",
        },
        {
          commandRef: "reminderWrite",
          reason: "Only schedule a follow-up reminder if the closeout creates a concrete re-entry need.",
        },
      ],
    },
    {
      id: "project_continuity_write",
      trigger: "The host sees reusable project state, repo direction, or a next-step handoff that should survive thread loss.",
      steps: [
        {
          commandRef: "projectRadar",
          reason: "Inspect the tracked project and read-first files before choosing the durable note target.",
        },
        {
          commandRef: "noteAuto",
          reason: "Write continuity into the project/companion note through schema-aware routing.",
        },
        {
          commandRef: "contextBriefing",
          reason: "Refresh the controlled context board after durable continuity changes.",
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
          reason: "When onboarding is still active, route the correction through the onboarding updater so session state and missing slots stay aligned.",
        },
        {
          commandRef: "companionRemember",
          reason: "Once onboarding is already ready, persist corrections through the ongoing companion-memory path instead of overloading onboarding-only state.",
        },
        {
          commandRef: "contextBriefing",
          reason: "Refresh the controlled handoff surface after important corrections if the host needs to inspect the new state immediately.",
        },
      ],
    },
  ];
}
