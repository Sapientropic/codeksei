import { normalizeText } from "../core/text-normalization";

import { PACKAGE_NAME } from "../contracts/app-env";
import { resolveSelectedAccount } from "../adapters/channel/weixin/account-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import {
  processBridgeCheckinPollerIteration,
} from "../core/checkin-core";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { logInfo } from "../core/logging";
import { formatCheckinRange } from "../state/checkin-config";
import { SystemMessageQueueStore } from "../state/system-message-queue-store";

const CHECKIN_POLLER_HEARTBEAT_MS = 30_000;

type CheckinPollerConfig = AppRuntimeConfig;

export async function runSystemCheckinPoller(config: CheckinPollerConfig) {
  const account = resolveSelectedAccount(config);
  const queue = new SystemMessageQueueStore({
    deadLetterFilePath: normalizeText(config.systemMessageDeadLetterFile),
    filePath: normalizeText(config.systemMessageQueueFile),
  });
  const sessionStore = new SessionStore({ filePath: normalizeText(config.sessionsFile) });
  let lastRangeLabel = "";
  let lastNextDueAt = "";
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
        if (result.tick.nextDueAt && result.tick.nextDueAt !== lastNextDueAt) {
          logInfo(`[${PACKAGE_NAME}] checkin queued; next due at ${result.tick.nextDueAt}`);
          lastNextDueAt = result.tick.nextDueAt;
        } else {
          logInfo(`[${PACKAGE_NAME}] checkin queued`);
        }
        break;
      case "waiting_for_queue":
        if (result.tick.payload?.triggerId && result.tick.payload.triggerId !== lastPendingTriggerId) {
          logInfo(`[${PACKAGE_NAME}] checkin waiting for queue drain trigger=${result.tick.payload.triggerId}`);
          lastPendingTriggerId = result.tick.payload.triggerId;
        }
        break;
      case "waiting":
      default:
        lastPendingTriggerId = "";
        if (result.tick.nextDueAt && result.tick.nextDueAt !== lastNextDueAt) {
          logInfo(`[${PACKAGE_NAME}] next checkin due at ${result.tick.nextDueAt}`);
          lastNextDueAt = result.tick.nextDueAt;
        }
        break;
    }

    await sleep(CHECKIN_POLLER_HEARTBEAT_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
