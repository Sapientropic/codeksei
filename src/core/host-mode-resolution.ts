import { normalizeText } from "../contracts/text-normalization";
import {
  normalizeCodekseiChannelProvider,
  normalizeCodekseiRuntimeProvider,
  type CodekseiChannelProvider,
  type CodekseiExecutionMode,
  type CodekseiRuntimeProvider,
} from "./config-value-types";
import { getHostProfileMatrixEntry, type HostCapabilities, type HostProfileId } from "./host-profile-matrix";
import { resolveHostAttachment } from "../host/attach/model";

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
  const attachment = resolveHostAttachment(config);
  const matrixEntry = getHostProfileMatrixEntry(attachment.profile);
  return {
    profile: attachment.profile,
    runtime: attachment.runtime,
    channelProvider: attachment.channelProvider,
    channel: attachment.channel,
    mode: matrixEntry.mode,
    supported: attachment.supported,
    reason: attachment.reason,
    capabilities: matrixEntry.capabilities,
  };
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
  const matrixEntry = getHostProfileMatrixEntry(resolved.profile);
  if (matrixEntry.bridgeOnlyMessageKind === "hosted_bridge_replaced") {
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

export type {
  CodekseiChannelProvider,
  CodekseiExecutionMode,
  CodekseiRuntimeProvider,
} from "./config-value-types";
export type {
  HostCapabilities,
  HostProfileId,
} from "./host-profile-matrix";
