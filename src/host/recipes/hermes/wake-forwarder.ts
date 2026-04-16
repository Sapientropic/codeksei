import {
  collectHostedCheckinCronSummary,
  createHostedCheckinCronPlanSetFromTick,
  createHostedCheckinWakePlanSet,
  isHostedHermesCheckinEnabled,
  type HostedCheckinConfig,
  type HostedCheckinCronSummary,
  type HostedCheckinCronSyncJobPlan,
  type HostedCheckinCronSyncPlanSet,
} from "../../../core/hosted-checkin-cron";
import type { CheckinResolvedTarget, CheckinTickResult } from "../../../checkin";
import { syncCheckinCronViaHermesRepoLocal } from "./repo-local";

export type {
  HostedCheckinConfig,
  HostedCheckinCronSummary,
  HostedCheckinCronSyncJobPlan,
  HostedCheckinCronSyncPlanSet,
};

export {
  collectHostedCheckinCronSummary,
  createHostedCheckinCronPlanSetFromTick,
  createHostedCheckinWakePlanSet,
  isHostedHermesCheckinEnabled,
};

export function syncHostedCheckinPlanViaHermes(
  config: Partial<HostedCheckinConfig>,
  target: CheckinResolvedTarget,
  tick: CheckinTickResult,
  {
    followupContext = "",
  }: {
    followupContext?: string;
  } = {},
) {
  const planSet = createHostedCheckinCronPlanSetFromTick(config, target, tick, {
    followupContext,
  });
  const sync = syncHostedCheckinPlanSetViaHermes(config, planSet);
  return {
    plan: planSet,
    sync,
    summary: collectHostedCheckinCronSummary(config, target),
  };
}

export function syncHostedCheckinPlanSetViaHermes(
  config: Partial<HostedCheckinConfig>,
  planSet: HostedCheckinCronSyncPlanSet,
) {
  return syncCheckinCronViaHermesRepoLocal(config, {
    plans: planSet.jobs.map((job) => ({
      due_at_iso: job.plannedWakeAt,
      env: job.env,
      name: job.name,
      prompt: job.prompt,
      role: job.role,
      sender_id: job.senderId,
      target_key: job.targetKey,
      workspace_root: job.workspaceRoot,
    })),
    sender_id: planSet.senderId,
    target_key: planSet.targetKey,
    workspace_root: planSet.workspaceRoot,
  });
}
