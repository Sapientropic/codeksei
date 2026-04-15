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
  modeClass: HostModeClass | "unsupported";
  transport: HostTransport;
  runtime: CodekseiRuntimeProvider;
  channelProvider: CodekseiChannelProvider;
  channel: string;
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

  if (channel !== "weixin") {
    return createUnsupportedAttachment({
      runtime,
      channelProvider,
      channel,
      reason: `当前 host attachment v1 只支持 channel=weixin；当前值是 ${channel || "(empty)"}。`,
    });
  }

  if (runtime === "codex" && channelProvider === "codeksei") {
    return createSupportedAttachment({
      provider: "",
      profile: "bridge-codex-weixin",
      modeClass: "bridge-full",
      runtime,
      channelProvider,
      channel,
      mode: "bridge",
      capabilities: {
        ownsBridgeLifecycle: true,
        ownsSharedThreadControl: true,
        ownsWeixinLogin: true,
        supportsHostedSkillInstall: false,
        supportsLiveHostedSmoke: false,
        supportsSemanticReviewHybrid: true,
      },
    });
  }

  if (runtime === "hermes" && channelProvider === "hermes") {
    return createSupportedAttachment({
      provider: "hermes",
      profile: "hosted-hermes-weixin",
      modeClass: "hosted-proactive",
      runtime,
      channelProvider,
      channel,
      mode: "hosted",
      capabilities: {
        ownsBridgeLifecycle: false,
        ownsSharedThreadControl: false,
        ownsWeixinLogin: false,
        supportsHostedSkillInstall: true,
        supportsLiveHostedSmoke: true,
        supportsSemanticReviewHybrid: true,
      },
    });
  }

  if (runtime === "hermes" && channelProvider === "codeksei") {
    return createUnsupportedAttachment({
      runtime,
      channelProvider,
      channel,
      reason: "当前组合尚未实现：runtime=hermes + channelProvider=codeksei。若要用 Hermes，请把 channelProvider 也切到 hermes，让 Hermes 官方 Weixin 托管消息面。",
    });
  }

  if (runtime === "codex" && channelProvider === "hermes") {
    return createUnsupportedAttachment({
      runtime,
      channelProvider,
      channel,
      reason: "当前组合尚未实现：runtime=codex + channelProvider=hermes。若要复用 Hermes 官方 Weixin，请同时把 runtime 切到 hermes。",
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
  modeClass,
  runtime,
  channelProvider,
  channel,
  mode,
  capabilities,
}: {
  provider: HostRecipeId | "";
  profile: Exclude<HostProfileId, "unsupported">;
  modeClass: HostModeClass;
  runtime: CodekseiRuntimeProvider;
  channelProvider: CodekseiChannelProvider;
  channel: string;
  mode: CodekseiExecutionMode;
  capabilities: HostCapabilities;
}): HostAttachmentResolution {
  return {
    provider,
    profile,
    modeClass,
    transport: "cli_stdio",
    runtime,
    channelProvider,
    channel,
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
    modeClass: "unsupported",
    transport: "cli_stdio",
    runtime,
    channelProvider,
    channel,
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
