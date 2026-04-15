import {
  collectHostedCheckinCronSummary,
  createHostedCheckinCronPlanFromTick,
  createHostedCheckinWakePlan,
  isHostedHermesCheckinEnabled,
  type HostedCheckinConfig,
  type HostedCheckinCronSummary,
  type HostedCheckinCronSyncPlan,
} from "../../../core/hosted-checkin-cron";
import type { CheckinResolvedTarget, CheckinTickResult } from "../../../checkin";
import { syncCheckinCronViaHermesRepoLocal } from "./repo-local";

export type {
  HostedCheckinConfig,
  HostedCheckinCronSummary,
  HostedCheckinCronSyncPlan,
};

export {
  collectHostedCheckinCronSummary,
  createHostedCheckinCronPlanFromTick,
  createHostedCheckinWakePlan,
  isHostedHermesCheckinEnabled,
};

export function syncHostedCheckinPlanViaHermes(
  config: Partial<HostedCheckinConfig>,
  target: CheckinResolvedTarget,
  tick: CheckinTickResult,
) {
  const plan = createHostedCheckinCronPlanFromTick(config, target, tick);
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
    plan,
    sync,
    summary: collectHostedCheckinCronSummary(config, target),
  };
}
