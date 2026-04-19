import { CliError } from "../../core/cli-contract";
import type { AppRuntimeConfig } from "../../core/app-service-contract";
import { tryRefreshContextBoard, type ContextBoardConfig } from "../../context/board";
import {
  runCheckinCreateHandoff,
  normalizeCheckinCompleteResult,
  runCheckinComplete,
  runCheckinFinalizeHandoff,
  runCheckinTick,
  type CheckinBookkeepingAction,
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
    bookkeepingActions = [],
    createHandoff = false,
    followupContext = "",
    provider,
    leaseId,
    observedCurrentState = "",
    result,
    nextWakeAt,
    sleepFor,
    userVisibleMessage = "",
  }: {
    bookkeepingActions?: CheckinBookkeepingAction[];
    createHandoff?: boolean;
    followupContext?: string;
    provider: string;
    leaseId: string;
    observedCurrentState?: string;
    result: HostSettleResult;
    nextWakeAt?: string;
    sleepFor?: string;
    userVisibleMessage?: string;
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

  if (createHandoff) {
    if (result === "failed") {
      throw new CliError({
        code: "validation_error",
        exitCode: 3,
        message: "create-handoff 模式不支持 result=failed；失败请改走 finalize/failed 路径。",
        retryable: false,
      });
    }
    const normalizedResult = normalizeCheckinCompleteResult(result);
    if (!normalizedResult) {
      throw new CliError({
        code: "validation_error",
        exitCode: 3,
        message: `不支持的 handoff 结果: ${result}`,
        retryable: false,
      });
    }
    assertCreateHandoffMessageContract(normalizedResult, userVisibleMessage);
    const handoff = runCheckinCreateHandoff({
      bookkeepingActions,
      config,
      followupContext,
      observedCurrentState,
      result: normalizedResult,
      target,
      triggerId: leaseId,
      userVisibleMessage,
    });
    tryRefreshContextBoard(config, target, {
      followupContext,
      mode: "proactive",
    });
    const hostedSync = provider === "hermes"
      ? syncHostedCheckinPlanViaHermes(config as Partial<HostedCheckinConfig>, target, runCheckinTick({
        config,
        target,
      }), {
        followupContext,
      })
      : null;
    return {
      ok: true as const,
      completion: null,
      handoff: handoff.handoff,
      hostedWakeSync: hostedSync ? {
        plan: hostedSync.plan,
        sync: hostedSync.sync,
      } : null,
      nextWakeAt: hostedSync?.plan.jobs[0]?.plannedWakeAt || "",
      target,
    };
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
    completion: completion.completion,
    hostedWakeSync: hostedWakeSync?.data || null,
    nextWakeAt: completion.nextWakeAt,
    target,
  };
}

function assertCreateHandoffMessageContract(
  result: Exclude<ReturnType<typeof normalizeCheckinCompleteResult>, "">,
  userVisibleMessage: string,
): void {
  const normalizedMessage = userVisibleMessage.trim();
  if (result === "sent_message" && !normalizedMessage) {
    throw new CliError({
      code: "validation_error",
      exitCode: 3,
      message: "create-handoff + result=sent_message 时必须同时提供 --message。",
      retryable: false,
    });
  }
  if (result !== "sent_message" && normalizedMessage) {
    throw new CliError({
      code: "validation_error",
      exitCode: 3,
      message: "create-handoff 只有在 result=sent_message 时才允许传 --message。",
      retryable: false,
    });
  }
}

export function finalizeDelegatedCheckin(
  config: SettleConfig,
  target: CheckinResolvedTarget,
  {
    nextWakeAt,
    provider,
    leaseId,
    result,
    sleepFor,
  }: {
    nextWakeAt?: string;
    provider: string;
    leaseId: string;
    result?: HostSettleResult;
    sleepFor?: string;
  },
) {
  if (result === "failed") {
    throw new CliError({
      code: "validation_error",
      exitCode: 3,
      message: "finalize-checkin 不支持 result=failed；失败请改走 host settle-checkin。",
      retryable: false,
    });
  }
  const normalizedResult = result ? normalizeCheckinCompleteResult(result) : "";
  if (result && !normalizedResult) {
    throw new CliError({
      code: "validation_error",
      exitCode: 3,
      message: `不支持的 finalize 结果: ${result}`,
      retryable: false,
    });
  }
  const completion = runCheckinFinalizeHandoff({
    config,
    nextWakeAt: nextWakeAt || "",
    ...(normalizedResult ? { result: normalizedResult } : {}),
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
    completion: completion.completion,
    handoff: null,
    hostedWakeSync: hostedWakeSync?.data || null,
    nextWakeAt: completion.nextWakeAt,
    target,
  };
}

export function syncNextWakeViaHermes(
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
