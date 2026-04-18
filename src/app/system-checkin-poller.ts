import { normalizeText } from "../core/text-normalization";
import type {
  CheckinRuntimeConfig,
  WeixinBridgeConfig,
  WorkspacePathsConfig,
} from "../core/config-slices";

import { PACKAGE_NAME } from "../contracts/app-env";
import { resolveSelectedAccount } from "../adapters/channel/weixin/account-store";
import {
  processBridgeCheckinPollerIteration,
} from "../checkin";
import { logInfo } from "../core/logging";
import { formatCheckinRange } from "../state/checkin-config";
import { SystemMessageQueueStore } from "../state/system-message-queue-store";
import { createSessionStore } from "../session/session-store-factory";

const CHECKIN_POLLER_HEARTBEAT_MS = 30_000;

type CheckinPollerConfig =
  & Pick<WorkspacePathsConfig, "sessionsFile">
  & Pick<WeixinBridgeConfig, "accountId" | "accountsDir" | "weixinBaseUrl" | "weixinRouteTag">
  & Pick<CheckinRuntimeConfig, "allowedUserIds" | "checkinConfigFile" | "checkinScheduleStateFile" | "systemMessageDeadLetterFile" | "systemMessageQueueFile" | "userName" | "workspaceId" | "workspaceRoot">;

export async function runSystemCheckinPoller(config: CheckinPollerConfig) {
  const account = resolveSelectedAccount(config);
  const queue = new SystemMessageQueueStore({
    deadLetterFilePath: normalizeText(config.systemMessageDeadLetterFile),
    filePath: normalizeText(config.systemMessageQueueFile),
  });
  const sessionStore = createSessionStore(config.sessionsFile);
  if (!sessionStore) {
    throw new Error("缺少 sessionsFile，无法启动 checkin poller");
  }
  let lastRangeLabel = "";
  let lastNextWakeAt = "";
  let lastActiveTriggerId = "";
  let lastPendingTriggerId = "";

  logInfo(`[${PACKAGE_NAME}] checkin poller ready account=${account.accountId}`);

  while (true) {
    const result = processBridgeCheckinPollerIteration({
      accountId: account.accountId,
      config,
      queueStore: queue,
      sessionStore,
    });
    const rangeLabel = `${formatCheckinRange(result.tick.intervalConfig)} source=${result.tick.intervalConfig.source}`;
    if (rangeLabel !== lastRangeLabel) {
      logInfo(`[${PACKAGE_NAME}] checkin interval range ${rangeLabel}`);
      lastRangeLabel = rangeLabel;
    }

    switch (result.action) {
      case "enqueue_and_ack":
        lastPendingTriggerId = "";
        if (result.tick.activeWake?.triggerId && result.tick.activeWake.triggerId !== lastActiveTriggerId) {
          logInfo(`[${PACKAGE_NAME}] checkin queued; awaiting completion trigger=${result.tick.activeWake.triggerId}`);
          lastActiveTriggerId = result.tick.activeWake.triggerId;
        }
        break;
      case "waiting_for_queue":
        lastActiveTriggerId = "";
        if (result.tick.payload?.triggerId && result.tick.payload.triggerId !== lastPendingTriggerId) {
          logInfo(`[${PACKAGE_NAME}] checkin waiting for queue drain trigger=${result.tick.payload.triggerId}`);
          lastPendingTriggerId = result.tick.payload.triggerId;
        }
        break;
      case "waiting":
      default:
        lastPendingTriggerId = "";
        if (result.tick.activeWake?.triggerId && result.tick.activeWake.triggerId !== lastActiveTriggerId) {
          logInfo(`[${PACKAGE_NAME}] checkin in progress trigger=${result.tick.activeWake.triggerId}`);
          lastActiveTriggerId = result.tick.activeWake.triggerId;
          break;
        }
        lastActiveTriggerId = "";
        if (result.tick.nextWakeAt && result.tick.nextWakeAt !== lastNextWakeAt) {
          logInfo(`[${PACKAGE_NAME}] next checkin wake at ${result.tick.nextWakeAt}`);
          lastNextWakeAt = result.tick.nextWakeAt;
        }
        break;
    }

    await sleep(CHECKIN_POLLER_HEARTBEAT_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
