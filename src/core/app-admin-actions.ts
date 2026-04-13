import { probeCodexAppServerCapabilities } from "../adapters/runtime/codex/capability-probe";
import { writeSharedBridgeHeartbeat } from "../shared/shared-bridge-heartbeat";
import { formatCheckinRange, resolveCheckinConfig } from "../state/checkin-config";
import { normalizeTrimmedText } from "./approval-command-policy";
import { formatErrorMessage } from "./app-poll-loop";
import type {
  AppRuntimeConfig,
  ChannelAdapterLike,
  RuntimeAdapterLike,
  ThreadStateStoreLike,
  TimelineIntegrationLike,
} from "./app-service-contract";

interface PrintDoctorArgs {
  config: AppRuntimeConfig;
  channelAdapter: Pick<ChannelAdapterLike, "describe">;
  runtimeAdapter: Pick<RuntimeAdapterLike, "describe">;
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
  const checkinConfigFile = normalizeTrimmedText(config.checkinConfigFile);
  const checkin = checkinConfigFile
    ? resolveCheckinConfig({ filePath: checkinConfigFile })
    : null;
  console.log(JSON.stringify({
    stateDir: config.stateDir,
    channel: channelAdapter.describe(),
    runtime: runtimeAdapter.describe(),
    codexCapabilities: probeCodexAppServerCapabilities(config.codexCommand || "codex"),
    timeline: timelineIntegration.describe(),
    checkin: checkin
      ? {
        ...checkin,
        range: formatCheckinRange(checkin),
      }
      : null,
    threads: threadStateStore.snapshot(),
  }, null, 2));
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
    console.error(`[codeksei] bridge heartbeat write failed: ${formatErrorMessage(error)}`);
  }
}
