import { writeSharedBridgeHeartbeat } from "../shared/shared-bridge-heartbeat";
import { formatCheckinRange, resolveCheckinConfig } from "../state/checkin-config";
import { normalizeTrimmedText } from "./approval-command-policy";
import { formatErrorMessage } from "./app-poll-loop";
import { collectHermesHostedDoctorReport, resolveHostMode } from "./host-mode";
import type {
  AppRuntimeConfig,
  ChannelAdapterLike,
  RuntimeAdapterLike,
  ThreadStateStoreLike,
  TimelineIntegrationLike,
} from "./app-service-contract";
import { logError } from "./logging";
import { writeJson } from "./terminal-output";

interface PrintDoctorArgs {
  config: AppRuntimeConfig;
  channelAdapter: Pick<ChannelAdapterLike, "describe">;
  runtimeAdapter: Pick<RuntimeAdapterLike, "describe" | "probeRuntimeCapabilities">;
  threadStateStore: Pick<ThreadStateStoreLike, "snapshot">;
  timelineIntegration: Pick<TimelineIntegrationLike, "describe">;
}

export function printDoctorReport({
  config,
  channelAdapter,
  runtimeAdapter,
  threadStateStore,
  timelineIntegration,
}: PrintDoctorArgs): void {
  writeJson(collectDoctorReport({
    config,
    channelAdapter,
    runtimeAdapter,
    threadStateStore,
    timelineIntegration,
  }));
}

export function collectDoctorReport({
  config,
  channelAdapter,
  runtimeAdapter,
  threadStateStore,
  timelineIntegration,
}: PrintDoctorArgs): Record<string, unknown> {
  const checkinConfigFile = normalizeTrimmedText(config.checkinConfigFile);
  const checkin = checkinConfigFile
    ? resolveCheckinConfig({ filePath: checkinConfigFile })
    : null;
  const hostMode = resolveHostMode(config);
  return {
    stateDir: config.stateDir,
    profile: hostMode.profile,
    mode: hostMode.mode,
    runtimeProvider: hostMode.runtime,
    channelProvider: hostMode.channelProvider,
    capabilities: hostMode.capabilities,
    compatibility: {
      supported: hostMode.supported,
      reason: hostMode.reason,
      channel: hostMode.channel,
    },
    hostedHermes: hostMode.mode === "hosted"
      ? collectHermesHostedDoctorReport(config)
      : null,
    channel: channelAdapter.describe(),
    runtime: runtimeAdapter.describe(),
    runtimeCapabilities: typeof runtimeAdapter.probeRuntimeCapabilities === "function"
      ? runtimeAdapter.probeRuntimeCapabilities(config.runtimeCommand || "codex")
      : null,
    timeline: timelineIntegration.describe(),
    checkin: checkin
      ? {
        ...checkin,
        range: formatCheckinRange(checkin),
      }
      : null,
    threads: threadStateStore.snapshot(),
  };
}

export async function loginChannel(channelAdapter: Pick<ChannelAdapterLike, "login">): Promise<void> {
  await channelAdapter.login();
}

export function printChannelAccounts(channelAdapter: Pick<ChannelAdapterLike, "printAccounts">): void {
  channelAdapter.printAccounts();
}

export function updateBridgeHeartbeatFile({
  config,
  patch,
}: {
  config: AppRuntimeConfig;
  patch: Record<string, unknown>;
}): void {
  const filePath = normalizeTrimmedText(config.sharedBridgeHeartbeatFile);
  if (!filePath) {
    return;
  }
  try {
    writeSharedBridgeHeartbeat(filePath, patch);
  } catch (error) {
    logError(`[codeksei] bridge heartbeat write failed: ${formatErrorMessage(error)}`);
  }
}
