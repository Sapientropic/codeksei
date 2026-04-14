import type {
  CommandHostProfileIdDefinition,
  CommandHostSupportTierDefinition,
} from "../contracts/command-surface-definition-types";
import type {
  CodekseiExecutionMode,
} from "./config-value-types";

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
  "bridge-codex-weixin": Object.freeze({
    bridgeOnlyMessageKind: "bridge_ready",
    capabilities: Object.freeze({
      ownsBridgeLifecycle: true,
      ownsSharedThreadControl: true,
      ownsWeixinLogin: true,
      supportsHostedSkillInstall: false,
      supportsLiveHostedSmoke: false,
      supportsSemanticReviewHybrid: true,
    }),
    channelOperations: Object.freeze({
      pollUpdates: true,
      login: true,
      resolveAccount: true,
      visibleTextDelivery: true,
      visibleTypingDelivery: true,
      visibleFileDelivery: true,
    }),
    mode: "bridge",
    profile: "bridge-codex-weixin",
    runtimeOperations: Object.freeze({
      initialize: true,
      interactiveTurn: true,
      refreshThreadInstructions: true,
      respondApproval: true,
      resumeThread: true,
      cancelTurn: true,
    }),
    supported: true,
  }),
  "hosted-hermes-weixin": Object.freeze({
    bridgeOnlyMessageKind: "hosted_bridge_replaced",
    capabilities: Object.freeze({
      ownsBridgeLifecycle: false,
      ownsSharedThreadControl: false,
      ownsWeixinLogin: false,
      supportsHostedSkillInstall: true,
      supportsLiveHostedSmoke: true,
      supportsSemanticReviewHybrid: true,
    }),
    channelOperations: Object.freeze({
      pollUpdates: false,
      login: false,
      resolveAccount: false,
      visibleTextDelivery: false,
      visibleTypingDelivery: false,
      visibleFileDelivery: false,
    }),
    mode: "hosted",
    profile: "hosted-hermes-weixin",
    runtimeOperations: Object.freeze({
      initialize: false,
      interactiveTurn: false,
      refreshThreadInstructions: false,
      respondApproval: false,
      resumeThread: false,
      cancelTurn: false,
    }),
    supported: true,
  }),
  unsupported: Object.freeze({
    bridgeOnlyMessageKind: "unsupported_profile",
    capabilities: Object.freeze({
      ownsBridgeLifecycle: false,
      ownsSharedThreadControl: false,
      ownsWeixinLogin: false,
      supportsHostedSkillInstall: false,
      supportsLiveHostedSmoke: false,
      supportsSemanticReviewHybrid: false,
    }),
    channelOperations: Object.freeze({
      pollUpdates: false,
      login: false,
      resolveAccount: false,
      visibleTextDelivery: false,
      visibleTypingDelivery: false,
      visibleFileDelivery: false,
    }),
    mode: "unsupported",
    profile: "unsupported",
    runtimeOperations: Object.freeze({
      initialize: false,
      interactiveTurn: false,
      refreshThreadInstructions: false,
      respondApproval: false,
      resumeThread: false,
      cancelTurn: false,
    }),
    supported: false,
  }),
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
