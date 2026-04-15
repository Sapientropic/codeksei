import type { AppRuntimeConfig } from "../../core/app-service-contract";
import { runCheckinTick, type CheckinResolvedTarget } from "../../checkin";
import { createHostedCheckinWakePlan } from "../../core/hosted-checkin-cron";
import { syncCheckinCronViaHermesRepoLocal } from "../recipes/hermes/repo-local";
import { syncHostedCheckinPlanViaHermes } from "../recipes/hermes/wake-forwarder";

type SeedConfig = Pick<
  AppRuntimeConfig,
  "checkinConfigFile" | "checkinScheduleStateFile"
> & Partial<Pick<
  AppRuntimeConfig,
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
>>;

export function seedProactiveCheckin(
  config: SeedConfig,
  target: CheckinResolvedTarget,
  {
    provider,
    nextWakeAt,
  }: {
    provider: string;
    nextWakeAt?: string;
  },
) {
  if (provider === "hermes" && nextWakeAt) {
    const plan = createHostedCheckinWakePlan(config, target, nextWakeAt);
    const sync = syncCheckinCronViaHermesRepoLocal(config, {
      due_at_iso: plan.plannedWakeAt,
      name: plan.name,
      prompt: plan.prompt,
      role: plan.role,
      sender_id: plan.senderId,
      target_key: plan.targetKey,
      workspace_root: plan.workspaceRoot,
    });
    return {
      status: "seeded",
      nextWakeAt: plan.plannedWakeAt,
      sync,
      summary: null,
    };
  }

  const tick = runCheckinTick({
    config,
    target,
  });
  if (provider === "hermes") {
    const synced = syncHostedCheckinPlanViaHermes(config, target, tick);
    return {
      status: tick.status === "scheduled" ? "seeded" : tick.status,
      nextWakeAt: synced.plan.plannedWakeAt,
      sync: synced.sync,
      summary: synced.summary,
    };
  }
  return {
    status: tick.status === "scheduled" ? "seeded" : tick.status,
    nextWakeAt: tick.nextWakeAt,
    sync: null,
    summary: null,
  };
}
