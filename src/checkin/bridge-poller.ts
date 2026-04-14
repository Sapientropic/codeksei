import * as crypto from "node:crypto";

import { readPrefixedEnv } from "../contracts/app-env";
import type { AppRuntimeConfig, SystemMessageQueueLike } from "../core/app-service-contract";
import {
  buildCheckinTargetResolutionErrorMessage,
  type CheckinSessionStoreLike,
  resolveCheckinTarget,
} from "./target-resolution";
import {
  runCheckinTick,
  type CheckinTickResult,
} from "./scheduler";

type BridgeCheckinPollerConfig = Pick<
  AppRuntimeConfig,
  | "allowedUserIds"
  | "checkinConfigFile"
  | "checkinScheduleStateFile"
  | "systemMessageDeadLetterFile"
  | "systemMessageQueueFile"
  | "userName"
  | "workspaceId"
  | "workspaceRoot"
>;

interface BridgeCheckinPollerIterationArgs {
  accountId: string;
  config: BridgeCheckinPollerConfig;
  nowMs?: number;
  queueStore: Pick<SystemMessageQueueLike, "enqueue" | "hasPendingForAccount">;
  sessionStore: CheckinSessionStoreLike;
}

export interface BridgeCheckinPollerIterationResult {
  action: "enqueue_and_ack" | "waiting" | "waiting_for_queue";
  tick: CheckinTickResult;
}

export function processBridgeCheckinPollerIteration({
  accountId,
  config,
  nowMs = Date.now(),
  queueStore,
  sessionStore,
}: BridgeCheckinPollerIterationArgs): BridgeCheckinPollerIterationResult {
  const resolution = resolveCheckinTarget({
    accountId,
    config,
    explicitUser: readPrefixedEnv(process.env, "CHECKIN_USER_ID") || "",
    explicitWorkspace: readPrefixedEnv(process.env, "CHECKIN_WORKSPACE") || "",
    sessionStore,
  });
  if (!resolution.ok || !resolution.value) {
    throw new Error(buildCheckinTargetResolutionErrorMessage(resolution));
  }

  const tick = runCheckinTick({
    config,
    nowMs,
    target: resolution.value,
  });
  if (!tick.due || !tick.payload) {
    return {
      action: "waiting",
      tick,
    };
  }
  if (queueStore.hasPendingForAccount(accountId)) {
    return {
      action: "waiting_for_queue",
      tick,
    };
  }

  queueStore.enqueue({
    accountId,
    checkinTriggerId: tick.payload.triggerId,
    createdAt: tick.payload.createdAt,
    id: crypto.randomUUID(),
    kind: "checkin",
    senderId: tick.payload.senderId,
    text: tick.payload.text,
    workspaceRoot: tick.payload.workspaceRoot,
  });

  const acked = runCheckinTick({
    ack: tick.payload.triggerId,
    config,
    nowMs,
    target: resolution.value,
  });
  return {
    action: "enqueue_and_ack",
    tick: acked,
  };
}
