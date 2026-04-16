import { CliError } from "../../core/cli-contract";
import type { AppRuntimeConfig } from "../../core/app-service-contract";
import { tryRefreshContextBoard, type ContextBoardConfig } from "../../context/board";
import {
  normalizeCheckinCompleteResult,
  runCheckinComplete,
  runCheckinTick,
  type CheckinResolvedTarget,
} from "../../checkin";
import { createHostedCheckinWakePlanSet } from "../../core/hosted-checkin-cron";
import type { HostedCheckinConfig } from "../recipes/hermes/wake-forwarder";
import {
  syncHostedCheckinPlanSetViaHermes,
  syncHostedCheckinPlanViaHermes,
} from "../recipes/hermes/wake-forwarder";
import type { HostSettleResult } from "../contracts/settle-result";

type SettleConfig = ContextBoardConfig & Pick<
  AppRuntimeConfig,
  "checkinConfigFile" | "checkinScheduleStateFile"
> & Partial<Pick<
  AppRuntimeConfig,
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
>>;

export function settleDelegatedCheckin(
  config: SettleConfig,
  target: CheckinResolvedTarget,
  {
    provider,
    leaseId,
    result,
    nextWakeAt,
    sleepFor,
  }: {
    provider: string;
    leaseId: string;
    result: HostSettleResult;
    nextWakeAt?: string;
    sleepFor?: string;
  },
) {
  const current = runCheckinTick({
    config,
    target,
  });

  if (!current.activeWake) {
    throw new CliError({
      code: "stale_lease",
      exitCode: 1,
      message: "当前没有 active wake；这条 lease 已经过期或已被回收。",
      retryable: true,
    });
  }
  if (current.activeWake.triggerId !== leaseId) {
    throw new CliError({
      code: "trigger_mismatch",
      exitCode: 3,
      message: `当前 active wake 与 lease 不匹配：expected ${current.activeWake.triggerId}, got ${leaseId}`,
      retryable: false,
    });
  }

  if (result === "failed") {
    const hostedSync = provider === "hermes"
      ? syncHostedCheckinPlanViaHermes(config as Partial<HostedCheckinConfig>, target, current)
      : null;
    return {
      ok: "partial" as const,
      completion: null,
      hostedWakeSync: hostedSync ? {
        plan: hostedSync.plan,
        sync: hostedSync.sync,
      } : null,
      nextWakeAt: hostedSync?.plan.jobs[0]?.plannedWakeAt || "",
      target,
    };
  }

  const normalizedResult = normalizeCheckinCompleteResult(result);
  if (!normalizedResult) {
    throw new CliError({
      code: "validation_error",
      exitCode: 3,
      message: `不支持的 settle 结果: ${result}`,
      retryable: false,
    });
  }

  const completion = runCheckinComplete({
    config,
    nextWakeAt: nextWakeAt || "",
    result: normalizedResult,
    sleepFor: sleepFor || "",
    target,
    triggerId: leaseId,
  });
  tryRefreshContextBoard(config, target, {
    clearFollowupContext: true,
    mode: "proactive",
  });
  const hostedWakeSync = provider === "hermes"
    ? syncNextWakeViaHermes(config, target, completion.nextWakeAt)
    : null;
  return {
    ok: hostedWakeSync?.ok === "partial" ? "partial" as const : true,
    completion,
    hostedWakeSync: hostedWakeSync?.data || null,
    nextWakeAt: completion.nextWakeAt,
    target,
  };
}

function syncNextWakeViaHermes(
  config: SettleConfig,
  target: CheckinResolvedTarget,
  nextWakeAt: string,
) {
  try {
    const planSet = createHostedCheckinWakePlanSet(config as Partial<HostedCheckinConfig>, target, {
      plannedWakeAt: nextWakeAt,
    });
    const sync = syncHostedCheckinPlanSetViaHermes(config as Partial<HostedCheckinConfig>, planSet);
    return {
      ok: true as const,
      data: {
        deliver: sync.deliver,
        jobs: sync.jobs,
        nextRunAt: sync.jobs[0]?.nextRunAt || nextWakeAt,
        removedJobIds: sync.removedJobIds,
      },
    };
  } catch (error) {
    return {
      ok: "partial" as const,
      data: {
        error: error instanceof Error ? error.message : String(error || "unknown error"),
      },
    };
  }
}
