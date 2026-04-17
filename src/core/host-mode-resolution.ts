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
  legacyProfileIds: string[];
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
    legacyProfileIds: attachment.legacyProfileIds,
    runtime: attachment.runtime,
    runtimeProvider: attachment.runtimeProvider,
    runtimeOwner: attachment.runtimeOwner,
    channelProvider: attachment.channelProvider,
    channel: attachment.channel,
    channelKind: attachment.channelKind,
    deliveryRecipe: attachment.deliveryRecipe,
    mode: matrixEntry.mode,
    supported: attachment.supported,
    reason: attachment.reason,
    capabilities: attachment.capabilities,
  };
}

export function assertCodexMode(config: HostModeConfigInput, commandLabel: string): HostModeResolution {
  const resolved = resolveHostMode(config);
  if (resolved.profile === "codex-mode") {
    return resolved;
  }
  throw new Error(formatCodexOnlyCommandMessage(resolved, commandLabel));
}

export function assertBridgeMode(config: HostModeConfigInput, commandLabel: string): HostModeResolution {
  return assertCodexMode(config, commandLabel);
}

export function formatCodexOnlyCommandMessage(
  resolved: HostModeResolution,
  commandLabel: string,
): string {
  const label = normalizeText(commandLabel) || "该命令";
  const matrixEntry = getHostProfileMatrixEntry(resolved.profile);
  if (matrixEntry.bridgeOnlyMessageKind === "hosted_bridge_replaced") {
    return [
      `${label} 在 Hosted Mode 下不会启动 Codeksei 自己的 runtime/first-party channel adapter。`,
      "请改用当前宿主的 gateway / channel bridge，并使用 Codeksei 的 host/operator/skill 入口。",
      `当前 profile: ${resolved.profile}`,
      `当前组合: runtime=${resolved.runtimeProvider}, channelProvider=${resolved.channelProvider}, channel=${resolved.channelKind}`,
    ].join("\n");
  }
  return [
    `${label} 当前不可用。`,
    resolved.reason || "当前 host 组合不受支持。",
    `当前 profile: ${resolved.profile}`,
    `当前组合: runtime=${resolved.runtimeProvider}, channelProvider=${resolved.channelProvider}, channel=${resolved.channelKind}`,
  ].join("\n");
}

export function formatBridgeOnlyCommandMessage(
  resolved: HostModeResolution,
  commandLabel: string,
): string {
  return formatCodexOnlyCommandMessage(resolved, commandLabel);
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
