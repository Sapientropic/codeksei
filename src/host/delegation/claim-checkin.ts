import { CliError } from "../../core/cli-contract";
import type { AppRuntimeConfig } from "../../core/app-service-contract";
import {
  CHECKIN_ACTIVE_WAKE_TIMEOUT_MS,
  runCheckinTick,
  type CheckinResolvedTarget,
} from "../../checkin";
import { syncHostedCheckinPlanViaHermes } from "../recipes/hermes/wake-forwarder";
import type { ClaimedPayload, DelegationLease, HostClaimStatus, PersistedOriginRef } from "../contracts/claim-ticket";

type ClaimConfig = Pick<
  AppRuntimeConfig,
  "checkinConfigFile" | "checkinScheduleStateFile"
> & Partial<Pick<
  AppRuntimeConfig,
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
>>;

export interface HostClaimCheckinResult {
  status: HostClaimStatus;
  lease: DelegationLease | null;
  payload: ClaimedPayload | null;
  origin: PersistedOriginRef | null;
  nextWakeAt: string;
  hostedSync: Record<string, unknown> | null;
}

export function claimDelegatedCheckin(
  config: ClaimConfig,
  target: CheckinResolvedTarget,
  provider: string,
): HostClaimCheckinResult {
  const firstTick = runCheckinTick({
    config,
    target,
  });

  if (firstTick.status === "scheduled") {
    return {
      status: "idle",
      lease: null,
      payload: null,
      origin: null,
      nextWakeAt: firstTick.nextWakeAt,
      hostedSync: null,
    };
  }

  if (firstTick.status === "in_progress") {
    const hostedSync = provider === "hermes"
      ? syncHostedCheckinPlanViaHermes(config, target, firstTick)
      : null;
    return {
      status: "in_progress",
      lease: firstTick.activeWake ? buildDelegationLease(firstTick.activeWake.triggerId, firstTick.activeWake.startedAt) : null,
      payload: null,
      origin: buildOriginRef(target),
      nextWakeAt: hostedSync?.plan.plannedWakeAt || "",
      hostedSync: hostedSync ? {
        plan: hostedSync.plan,
        sync: hostedSync.sync,
      } : null,
    };
  }

  if (!firstTick.payload?.triggerId) {
    throw new CliError({
      code: "resident_daemon_unavailable",
      exitCode: 1,
      message: "当前没有可 claim 的 proactive trigger。",
      retryable: true,
    });
  }

  let acknowledged;
  try {
    acknowledged = runCheckinTick({
      ack: firstTick.payload.triggerId,
      config,
      target,
    });
  } catch (error) {
    throw new CliError({
      code: "stale_lease",
      exitCode: 1,
      message: error instanceof Error ? error.message : "claim-checkin ack failed",
      retryable: true,
    });
  }

  const hostedSync = provider === "hermes"
    ? syncHostedCheckinPlanViaHermes(config, target, acknowledged)
    : null;
  return {
    status: "claimed",
    lease: acknowledged.activeWake ? buildDelegationLease(acknowledged.activeWake.triggerId, acknowledged.activeWake.startedAt) : null,
    payload: firstTick.payload ? {
      kind: "proactive_checkin",
      format: "plain_text",
      text: firstTick.payload.text,
    } : null,
    origin: buildOriginRef(target),
    nextWakeAt: hostedSync?.plan.plannedWakeAt || "",
    hostedSync: hostedSync ? {
      plan: hostedSync.plan,
      sync: hostedSync.sync,
    } : null,
  };
}

function buildDelegationLease(triggerId: string, startedAt: string): DelegationLease {
  const claimedAt = startedAt || new Date().toISOString();
  const startedAtMs = Date.parse(claimedAt);
  return {
    id: triggerId,
    triggerId,
    claimedAt,
    expiresAt: Number.isFinite(startedAtMs)
      ? new Date(startedAtMs + CHECKIN_ACTIVE_WAKE_TIMEOUT_MS).toISOString()
      : new Date(Date.now() + CHECKIN_ACTIVE_WAKE_TIMEOUT_MS).toISOString(),
    recoveryOnExpiry: true,
  };
}

function buildOriginRef(target: CheckinResolvedTarget): PersistedOriginRef {
  return {
    channel: "weixin",
    senderId: target.senderId,
    raw: {
      workspaceRoot: target.workspaceRoot,
    },
  };
}
