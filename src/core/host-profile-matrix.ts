import type {
  CommandHostProfileIdDefinition,
  CommandHostSupportTierDefinition,
} from "../contracts/command-surface-definition-types";
import type {
  CodekseiExecutionMode,
} from "./config-value-types";
import { resolveHostAttachment } from "../host/attach/model";

export type HostProfileId = CommandHostProfileIdDefinition | "unsupported";
export type SupportedHostProfileId = CommandHostProfileIdDefinition;

export interface HostCapabilities {
  ownsBridgeLifecycle: boolean;
  ownsSharedThreadControl: boolean;
  ownsWeixinLogin: boolean;
  supportsHostedSkillInstall: boolean;
  supportsLiveHostedSmoke: boolean;
  supportsSemanticReviewHybrid: boolean;
}

export interface ChannelAdapterOperations {
  pollUpdates: boolean;
  login: boolean;
  resolveAccount: boolean;
  visibleTextDelivery: boolean;
  visibleTypingDelivery: boolean;
  visibleFileDelivery: boolean;
}

export interface RuntimeAdapterOperations {
  initialize: boolean;
  interactiveTurn: boolean;
  refreshThreadInstructions: boolean;
  respondApproval: boolean;
  resumeThread: boolean;
  cancelTurn: boolean;
}

export type BridgeOnlyMessageKind = "bridge_ready" | "hosted_bridge_replaced" | "unsupported_profile";

export interface HostProfileMatrixEntry {
  bridgeOnlyMessageKind: BridgeOnlyMessageKind;
  capabilities: HostCapabilities;
  channelOperations: ChannelAdapterOperations;
  mode: CodekseiExecutionMode;
  profile: HostProfileId;
  runtimeOperations: RuntimeAdapterOperations;
  supported: boolean;
}

const HOST_PROFILE_MATRIX = Object.freeze<Record<HostProfileId, HostProfileMatrixEntry>>({
  "bridge-codex-weixin": Object.freeze(buildCompatibilityEntry("bridge-codex-weixin")),
  "hosted-hermes-weixin": Object.freeze(buildCompatibilityEntry("hosted-hermes-weixin")),
  unsupported: Object.freeze(buildCompatibilityEntry("unsupported")),
});

const SUPPORTED_HOST_PROFILE_IDS = Object.freeze<readonly SupportedHostProfileId[]>([
  "bridge-codex-weixin",
  "hosted-hermes-weixin",
]);

const HOST_SUPPORT_TIER_HINTS = Object.freeze<Record<CommandHostSupportTierDefinition, string>>({
  bridge_only: "这条命令是 Bridge Mode 专用入口；切回 bridge-codex-weixin，或改走 Hermes gateway 的宿主控制路径。",
  bridge_state_dependent: "这条命令当前还缺少 Hermes Hosted Mode 的 source-backed 宿主原语；不会自动降级成可见消息，先改走 bridge-codex-weixin 或 Hermes 原生 backstage 路径。",
  host_neutral: "切换到兼容的 host profile，或改用对应宿主的官方入口。",
  hosted_ready: "切换到兼容的 host profile，或改用对应宿主的官方入口。",
});

export function formatHostSupportTierHint(tier: CommandHostSupportTierDefinition): string {
  return HOST_SUPPORT_TIER_HINTS[tier];
}

export function getHostProfileMatrixEntry(profile: HostProfileId): HostProfileMatrixEntry {
  return HOST_PROFILE_MATRIX[profile];
}

export function isSupportedHostProfileId(value: unknown): value is SupportedHostProfileId {
  return value === "bridge-codex-weixin" || value === "hosted-hermes-weixin";
}

export function listSupportedHostProfileIds(): SupportedHostProfileId[] {
  return [...SUPPORTED_HOST_PROFILE_IDS];
}

function buildCompatibilityEntry(profile: HostProfileId): HostProfileMatrixEntry {
  const attachment = profile === "bridge-codex-weixin"
    ? resolveHostAttachment({ runtime: "codex", channelProvider: "codeksei" })
    : profile === "hosted-hermes-weixin"
      ? resolveHostAttachment({ runtime: "hermes", channelProvider: "hermes" })
      : resolveHostAttachment({ runtime: "openclaw-reserved" });

  return {
    bridgeOnlyMessageKind: profile === "bridge-codex-weixin"
      ? "bridge_ready"
      : profile === "hosted-hermes-weixin"
        ? "hosted_bridge_replaced"
        : "unsupported_profile",
    capabilities: Object.freeze({ ...attachment.capabilities }),
    channelOperations: Object.freeze(resolveChannelOperations(profile)),
    mode: attachment.mode as CodekseiExecutionMode,
    profile,
    runtimeOperations: Object.freeze(resolveRuntimeOperations(profile)),
    supported: attachment.supported,
  };
}

function resolveChannelOperations(profile: HostProfileId): ChannelAdapterOperations {
  if (profile === "bridge-codex-weixin") {
    return {
      pollUpdates: true,
      login: true,
      resolveAccount: true,
      visibleTextDelivery: true,
      visibleTypingDelivery: true,
      visibleFileDelivery: true,
    };
  }
  return {
    pollUpdates: false,
    login: false,
    resolveAccount: false,
    visibleTextDelivery: false,
    visibleTypingDelivery: false,
    visibleFileDelivery: false,
  };
}

function resolveRuntimeOperations(profile: HostProfileId): RuntimeAdapterOperations {
  if (profile === "bridge-codex-weixin") {
    return {
      initialize: true,
      interactiveTurn: true,
      refreshThreadInstructions: true,
      respondApproval: true,
      resumeThread: true,
      cancelTurn: true,
    };
  }
  return {
    initialize: false,
    interactiveTurn: false,
    refreshThreadInstructions: false,
    respondApproval: false,
    resumeThread: false,
    cancelTurn: false,
  };
}
