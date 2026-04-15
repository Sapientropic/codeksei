import { CliError } from "../../core/cli-contract";
import type { AppRuntimeConfig } from "../../core/app-service-contract";
import {
  normalizeCheckinCompleteResult,
  runCheckinComplete,
  runCheckinTick,
  type CheckinResolvedTarget,
} from "../../checkin";
import { syncHostedCheckinPlanViaHermes } from "../recipes/hermes/wake-forwarder";
import { createHostedCheckinWakePlan } from "../../core/hosted-checkin-cron";
import { syncCheckinCronViaHermesRepoLocal } from "../recipes/hermes/repo-local";
import type { HostSettleResult } from "../contracts/settle-result";

type SettleConfig = Pick<
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
      ? syncHostedCheckinPlanViaHermes(config, target, current)
      : null;
    return {
      ok: "partial" as const,
      completion: null,
      hostedWakeSync: hostedSync ? {
        plan: hostedSync.plan,
        sync: hostedSync.sync,
      } : null,
      nextWakeAt: hostedSync?.plan.plannedWakeAt || "",
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
    const plan = createHostedCheckinWakePlan(config, target, nextWakeAt);
    const sync = syncCheckinCronViaHermesRepoLocal(config, {
      due_at_iso: plan.plannedWakeAt,
      env: plan.env,
      name: plan.name,
      prompt: plan.prompt,
      role: plan.role,
      sender_id: plan.senderId,
      target_key: plan.targetKey,
      workspace_root: plan.workspaceRoot,
    });
    return {
      ok: true as const,
      data: {
        created: sync.created,
        deliver: sync.deliver,
        jobId: sync.jobId,
        name: sync.name,
        nextRunAt: sync.nextRunAt,
        removedJobIds: sync.removedJobIds,
        role: sync.role,
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
