import { normalizeText } from "../contracts/text-normalization";

export type CodekseiRuntimeProvider = "codex" | "hermes" | "openclaw-reserved";
export type CodekseiChannelProvider = "codeksei" | "hermes";
export type CodekseiExecutionMode = "bridge" | "hosted" | "unsupported";
export type HostProfileId = "bridge-codex-weixin" | "hosted-hermes-weixin" | "unsupported";

export interface HostCapabilities {
  ownsBridgeLifecycle: boolean;
  ownsSharedThreadControl: boolean;
  ownsWeixinLogin: boolean;
  supportsHostedSkillInstall: boolean;
  supportsLiveHostedSmoke: boolean;
  supportsSemanticReviewHybrid: boolean;
}

export interface HostModeResolution {
  profile: HostProfileId;
  runtime: CodekseiRuntimeProvider;
  channelProvider: CodekseiChannelProvider;
  channel: string;
  mode: CodekseiExecutionMode;
  supported: boolean;
  reason: string;
  capabilities: HostCapabilities;
}

export interface HostModeConfigInput {
  runtime?: unknown;
  channelProvider?: unknown;
  channel?: unknown;
  CODEKSEI_RUNTIME?: unknown;
  CODEKSEI_CHANNEL_PROVIDER?: unknown;
  CODEKSEI_CHANNEL?: unknown;
}

export function resolveHostMode(config: HostModeConfigInput = {}): HostModeResolution {
  const explicitRuntime = normalizeRuntimeProvider(config.runtime || config.CODEKSEI_RUNTIME);
  const explicitChannelProvider = normalizeChannelProvider(
    config.channelProvider || config.CODEKSEI_CHANNEL_PROVIDER,
  );
  const channel = normalizeChannel(config.channel || config.CODEKSEI_CHANNEL);
  const runtime = explicitRuntime || (explicitChannelProvider === "hermes" ? "hermes" : "codex");
  const channelProvider = explicitChannelProvider || (runtime === "hermes" ? "hermes" : "codeksei");

  if (channel !== "weixin") {
    return createUnsupportedProfile({
      runtime,
      channelProvider,
      channel,
      reason: `当前首个 host-neutral cut 只支持 channel=weixin；当前值是 ${channel || "(empty)"}。`,
    });
  }

  if (runtime === "codex" && channelProvider === "codeksei") {
    return {
      profile: "bridge-codex-weixin",
      runtime,
      channelProvider,
      channel,
      mode: "bridge",
      supported: true,
      reason: "",
      capabilities: buildHostCapabilities("bridge-codex-weixin"),
    };
  }

  if (runtime === "hermes" && channelProvider === "hermes") {
    return {
      profile: "hosted-hermes-weixin",
      runtime,
      channelProvider,
      channel,
      mode: "hosted",
      supported: true,
      reason: "",
      capabilities: buildHostCapabilities("hosted-hermes-weixin"),
    };
  }

  if (runtime === "hermes" && channelProvider === "codeksei") {
    return createUnsupportedProfile({
      runtime,
      channelProvider,
      channel,
      reason: "当前组合尚未实现：runtime=hermes + channelProvider=codeksei。若要用 Hermes，请把 channelProvider 也切到 hermes，让 Hermes 官方 Weixin 托管消息面。",
    });
  }

  if (runtime === "codex" && channelProvider === "hermes") {
    return createUnsupportedProfile({
      runtime,
      channelProvider,
      channel,
      reason: "当前组合尚未实现：runtime=codex + channelProvider=hermes。若要复用 Hermes 官方 Weixin，请同时把 runtime 切到 hermes。",
    });
  }

  if (runtime === "openclaw-reserved") {
    return createUnsupportedProfile({
      runtime,
      channelProvider,
      channel,
      reason: "openclaw-reserved 目前只保留为未来兼容占位；这次 PR 不实现 OpenClaw host path。",
    });
  }

  return createUnsupportedProfile({
    runtime,
    channelProvider,
    channel,
    reason: `当前组合不受支持：runtime=${runtime} channelProvider=${channelProvider} channel=${channel}。`,
  });
}

export function assertBridgeMode(config: HostModeConfigInput, commandLabel: string): HostModeResolution {
  const resolved = resolveHostMode(config);
  if (resolved.profile === "bridge-codex-weixin") {
    return resolved;
  }
  throw new Error(formatBridgeOnlyCommandMessage(resolved, commandLabel));
}

export function formatBridgeOnlyCommandMessage(
  resolved: HostModeResolution,
  commandLabel: string,
): string {
  const label = normalizeText(commandLabel) || "该命令";
  if (resolved.mode === "hosted") {
    return [
      `${label} 在 Hermes Hosted Mode 下不会启动 Codeksei 自己的 runtime/Weixin bridge。`,
      "请改用 Hermes gateway，并使用 Codeksei 的 Hermes operator / skill 入口。",
      `当前 profile: ${resolved.profile}`,
      `当前组合: runtime=${resolved.runtime}, channelProvider=${resolved.channelProvider}, channel=${resolved.channel}`,
    ].join("\n");
  }
  return [
    `${label} 当前不可用。`,
    resolved.reason || "当前 host 组合不受支持。",
    `当前 profile: ${resolved.profile}`,
    `当前组合: runtime=${resolved.runtime}, channelProvider=${resolved.channelProvider}, channel=${resolved.channel}`,
  ].join("\n");
}

function createUnsupportedProfile({
  runtime,
  channelProvider,
  channel,
  reason,
}: {
  runtime: CodekseiRuntimeProvider;
  channelProvider: CodekseiChannelProvider;
  channel: string;
  reason: string;
}): HostModeResolution {
  return {
    profile: "unsupported",
    runtime,
    channelProvider,
    channel,
    mode: "unsupported",
    supported: false,
    reason,
    capabilities: buildHostCapabilities("unsupported"),
  };
}

function buildHostCapabilities(profile: HostProfileId): HostCapabilities {
  if (profile === "bridge-codex-weixin") {
    return {
      ownsBridgeLifecycle: true,
      ownsSharedThreadControl: true,
      ownsWeixinLogin: true,
      supportsHostedSkillInstall: false,
      supportsLiveHostedSmoke: false,
      supportsSemanticReviewHybrid: true,
    };
  }
  if (profile === "hosted-hermes-weixin") {
    return {
      ownsBridgeLifecycle: false,
      ownsSharedThreadControl: false,
      ownsWeixinLogin: false,
      supportsHostedSkillInstall: true,
      supportsLiveHostedSmoke: true,
      supportsSemanticReviewHybrid: true,
    };
  }
  return {
    ownsBridgeLifecycle: false,
    ownsSharedThreadControl: false,
    ownsWeixinLogin: false,
    supportsHostedSkillInstall: false,
    supportsLiveHostedSmoke: false,
    supportsSemanticReviewHybrid: false,
  };
}

function normalizeRuntimeProvider(value: unknown): CodekseiRuntimeProvider | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "hermes") {
    return "hermes";
  }
  if (normalized === "openclaw-reserved") {
    return "openclaw-reserved";
  }
  return normalized === "codex" ? "codex" : "";
}

function normalizeChannelProvider(value: unknown): CodekseiChannelProvider | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "hermes") {
    return "hermes";
  }
  return normalized === "codeksei" ? "codeksei" : "";
}

function normalizeChannel(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || "weixin";
}
