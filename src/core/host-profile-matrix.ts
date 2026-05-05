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
  compactThread: boolean;
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
  "codex-mode": Object.freeze(buildCompatibilityEntry("codex-mode")),
  "claudecode-mode": Object.freeze(buildCompatibilityEntry("claudecode-mode")),
  "hosted-mode": Object.freeze(buildCompatibilityEntry("hosted-mode")),
  unsupported: Object.freeze(buildCompatibilityEntry("unsupported")),
});

const SUPPORTED_HOST_PROFILE_IDS = Object.freeze<readonly SupportedHostProfileId[]>([
  "codex-mode",
  "claudecode-mode",
  "hosted-mode",
]);

const HOST_SUPPORT_TIER_HINTS = Object.freeze<Record<CommandHostSupportTierDefinition, string>>({
  bridge_only: "这条命令是 Codex Mode 专用入口；切回 codex-mode，或改走当前宿主自己的控制路径。",
  bridge_state_dependent: "这条命令当前还缺少 Hosted Mode 的 source-backed 宿主原语；不会自动降级成可见消息，先改走 codex-mode 或宿主原生 backstage 路径。",
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
  return value === "codex-mode" || value === "claudecode-mode" || value === "hosted-mode";
}

export function listSupportedHostProfileIds(): SupportedHostProfileId[] {
  return [...SUPPORTED_HOST_PROFILE_IDS];
}

function buildCompatibilityEntry(profile: HostProfileId): HostProfileMatrixEntry {
  const attachment = profile === "codex-mode"
    ? resolveHostAttachment({ runtime: "codex", channelProvider: "codeksei", channel: "weixin" })
    : profile === "claudecode-mode"
      ? resolveHostAttachment({ runtime: "claudecode", channelProvider: "codeksei", channel: "weixin" })
    : profile === "hosted-mode"
      ? resolveHostAttachment({ runtime: "hermes", channelProvider: "hermes" })
      : resolveHostAttachment({ runtime: "openclaw-reserved" });

  return {
    bridgeOnlyMessageKind: profile === "codex-mode" || profile === "claudecode-mode"
      ? "bridge_ready"
      : profile === "hosted-mode"
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
  if (profile === "codex-mode" || profile === "claudecode-mode") {
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
  if (profile === "codex-mode" || profile === "claudecode-mode") {
    return {
      initialize: true,
      interactiveTurn: true,
      refreshThreadInstructions: true,
      respondApproval: true,
      resumeThread: true,
      cancelTurn: true,
      compactThread: profile === "claudecode-mode",
    };
  }
  return {
    initialize: false,
    interactiveTurn: false,
    refreshThreadInstructions: false,
    respondApproval: false,
    resumeThread: false,
    cancelTurn: false,
    compactThread: false,
  };
}
