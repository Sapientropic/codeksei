import { normalizeText } from "../../contracts/text-normalization";
import {
  normalizeCodekseiChannelProvider,
  normalizeCodekseiRuntimeProvider,
  type CodekseiChannelProvider,
  type CodekseiExecutionMode,
  type CodekseiRuntimeProvider,
} from "../../core/config-value-types";
import type { HostCapabilities, HostProfileId } from "../../core/host-profile-matrix";
import type { HostModeClass, HostTransport } from "../contracts/attachment-capabilities";
import { buildHostCapabilityMap } from "../contracts/attachment-capabilities";
import type { HostRecipeId } from "../contracts/host-recipe";

export interface HostAttachmentConfigInput {
  runtime?: unknown;
  channelProvider?: unknown;
  channel?: unknown;
  CODEKSEI_RUNTIME?: unknown;
  CODEKSEI_CHANNEL_PROVIDER?: unknown;
  CODEKSEI_CHANNEL?: unknown;
}

export interface HostAttachmentResolution {
  provider: HostRecipeId | "";
  profile: HostProfileId;
  legacyProfileIds: string[];
  modeClass: HostModeClass | "unsupported";
  transport: HostTransport;
  runtime: CodekseiRuntimeProvider;
  runtimeProvider: CodekseiRuntimeProvider;
  runtimeOwner: "codeksei" | "host";
  channelProvider: CodekseiChannelProvider;
  channel: string;
  channelKind: string;
  deliveryRecipe: string;
  mode: CodekseiExecutionMode;
  supported: boolean;
  reason: string;
  capabilities: HostCapabilities;
}

export function resolveHostAttachment(
  config: HostAttachmentConfigInput = {},
): HostAttachmentResolution {
  const explicitRuntime = normalizeCodekseiRuntimeProvider(config.runtime || config.CODEKSEI_RUNTIME);
  const explicitChannelProvider = normalizeCodekseiChannelProvider(
    config.channelProvider || config.CODEKSEI_CHANNEL_PROVIDER,
  );
  const channel = normalizeChannel(config.channel || config.CODEKSEI_CHANNEL);
  const runtime = explicitRuntime || (explicitChannelProvider === "hermes" ? "hermes" : "codex");
  const channelProvider = explicitChannelProvider || (runtime === "hermes" ? "hermes" : "codeksei");

  if (runtime === "codex" && channelProvider === "codeksei") {
    return createSupportedAttachment({
      provider: "codex",
      profile: "codex-mode",
      legacyProfileIds: channel === "weixin" ? ["bridge-codex-weixin"] : [],
      modeClass: "codex-managed",
      runtime,
      runtimeOwner: "codeksei",
      channelProvider,
      channel,
      deliveryRecipe: channel === "weixin" ? "codeksei-weixin-bridge" : "codeksei-managed-channel",
      mode: "codex",
      capabilities: {
        ownsBridgeLifecycle: channel === "weixin",
        ownsSharedThreadControl: true,
        ownsWeixinLogin: channel === "weixin",
        supportsHostedSkillInstall: false,
        supportsLiveHostedSmoke: false,
        supportsSemanticReviewHybrid: true,
      },
    });
  }

  if (runtime === "codex" && channelProvider === "host") {
    return createSupportedAttachment({
      provider: "generic-shell",
      profile: "codex-mode",
      legacyProfileIds: [],
      modeClass: "codex-managed",
      runtime,
      runtimeOwner: "codeksei",
      channelProvider,
      channel,
      deliveryRecipe: "generic-shell",
      mode: "codex",
      capabilities: {
        ownsBridgeLifecycle: false,
        ownsSharedThreadControl: true,
        ownsWeixinLogin: false,
        supportsHostedSkillInstall: false,
        supportsLiveHostedSmoke: false,
        supportsSemanticReviewHybrid: true,
      },
    });
  }

  if (runtime === "claudecode" && channelProvider === "codeksei") {
    return createSupportedAttachment({
      provider: "claudecode",
      profile: "claudecode-mode",
      legacyProfileIds: channel === "weixin" ? ["bridge-claudecode-weixin"] : [],
      modeClass: "claudecode-managed",
      runtime,
      runtimeOwner: "codeksei",
      channelProvider,
      channel,
      deliveryRecipe: channel === "weixin" ? "codeksei-weixin-bridge" : "codeksei-managed-channel",
      mode: "claudecode",
      capabilities: {
        ownsBridgeLifecycle: channel === "weixin",
        ownsSharedThreadControl: true,
        ownsWeixinLogin: channel === "weixin",
        supportsHostedSkillInstall: false,
        supportsLiveHostedSmoke: false,
        supportsSemanticReviewHybrid: true,
      },
    });
  }

  if (runtime === "claudecode" && channelProvider === "host") {
    return createSupportedAttachment({
      provider: "generic-shell",
      profile: "claudecode-mode",
      legacyProfileIds: [],
      modeClass: "claudecode-managed",
      runtime,
      runtimeOwner: "codeksei",
      channelProvider,
      channel,
      deliveryRecipe: "generic-shell",
      mode: "claudecode",
      capabilities: {
        ownsBridgeLifecycle: false,
        ownsSharedThreadControl: true,
        ownsWeixinLogin: false,
        supportsHostedSkillInstall: false,
        supportsLiveHostedSmoke: false,
        supportsSemanticReviewHybrid: true,
      },
    });
  }

  if (runtime === "hermes" && (channelProvider === "hermes" || channelProvider === "host")) {
    return createSupportedAttachment({
      provider: channelProvider === "hermes" ? "hermes" : "generic-shell",
      profile: "hosted-mode",
      legacyProfileIds: channelProvider === "hermes" && channel === "weixin" ? ["hosted-hermes-weixin"] : [],
      modeClass: "hosted-proactive",
      runtime,
      runtimeOwner: "host",
      channelProvider,
      channel,
      mode: "hosted",
      deliveryRecipe: channelProvider === "hermes" ? "hermes-origin" : "generic-shell",
      capabilities: {
        ownsBridgeLifecycle: false,
        ownsSharedThreadControl: false,
        ownsWeixinLogin: false,
        supportsHostedSkillInstall: channelProvider === "hermes",
        supportsLiveHostedSmoke: channelProvider === "hermes",
        supportsSemanticReviewHybrid: true,
      },
    });
  }

  if (runtime === "hermes" && channelProvider === "codeksei") {
    return createUnsupportedAttachment({
      runtime,
      channelProvider,
      channel,
      reason: "当前组合尚未实现：runtime=hermes + channelProvider=codeksei。若要使用 Hosted Mode，请改用宿主管理的 channel provider。",
    });
  }

  if (runtime === "codex" && channelProvider === "hermes") {
    return createUnsupportedAttachment({
      runtime,
      channelProvider,
      channel,
      reason: "当前组合尚未实现：runtime=codex + channelProvider=hermes。若要用 Hermes 托管 runtime/channel，请同时把 runtime 切到 hermes。",
    });
  }

  if (runtime === "claudecode" && channelProvider === "hermes") {
    return createUnsupportedAttachment({
      runtime,
      channelProvider,
      channel,
      reason: "当前组合尚未实现：runtime=claudecode + channelProvider=hermes。若要使用 Claude Code Mode，请改用 Codeksei first-party channel bridge。",
    });
  }

  if (runtime === "openclaw-reserved") {
    return createUnsupportedAttachment({
      runtime,
      channelProvider,
      channel,
      reason: "openclaw-reserved 目前只保留为未来兼容占位；Batch1-5 不实现 OpenClaw host path。",
    });
  }

  return createUnsupportedAttachment({
    runtime,
    channelProvider,
    channel,
    reason: `当前组合不受支持：runtime=${runtime} channelProvider=${channelProvider} channel=${channel}。`,
  });
}

function createSupportedAttachment({
  provider,
  profile,
  legacyProfileIds,
  modeClass,
  runtime,
  runtimeOwner,
  channelProvider,
  channel,
  deliveryRecipe,
  mode,
  capabilities,
}: {
  provider: HostRecipeId | "";
  profile: Exclude<HostProfileId, "unsupported">;
  legacyProfileIds: string[];
  modeClass: HostModeClass;
  runtime: CodekseiRuntimeProvider;
  runtimeOwner: "codeksei" | "host";
  channelProvider: CodekseiChannelProvider;
  channel: string;
  deliveryRecipe: string;
  mode: CodekseiExecutionMode;
  capabilities: HostCapabilities;
}): HostAttachmentResolution {
  return {
    provider,
    profile,
    legacyProfileIds: [...legacyProfileIds],
    modeClass,
    transport: "cli_stdio",
    runtime,
    runtimeProvider: runtime,
    runtimeOwner,
    channelProvider,
    channel,
    channelKind: channel,
    deliveryRecipe,
    mode,
    supported: true,
    reason: "",
    capabilities,
  };
}

function createUnsupportedAttachment({
  runtime,
  channelProvider,
  channel,
  reason,
}: {
  runtime: CodekseiRuntimeProvider;
  channelProvider: CodekseiChannelProvider;
  channel: string;
  reason: string;
}): HostAttachmentResolution {
  const capabilityMap = buildHostCapabilityMap([]);
  return {
    provider: "",
    profile: "unsupported",
    legacyProfileIds: [],
    modeClass: "unsupported",
    transport: "cli_stdio",
    runtime,
    runtimeProvider: runtime,
    runtimeOwner: runtime === "codex" || runtime === "claudecode" ? "codeksei" : "host",
    channelProvider,
    channel,
    channelKind: channel,
    deliveryRecipe: "",
    mode: "unsupported",
    supported: false,
    reason,
    capabilities: {
      ownsBridgeLifecycle: capabilityMap.bridgeRuntimeLifecycle,
      ownsSharedThreadControl: false,
      ownsWeixinLogin: capabilityMap.weixinAccountAccess,
      supportsHostedSkillInstall: capabilityMap.installCompanionSkill,
      supportsLiveHostedSmoke: capabilityMap.hostSmoke,
      supportsSemanticReviewHybrid: capabilityMap.semanticReviewHybrid,
    },
  };
}

function normalizeChannel(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || "weixin";
}
