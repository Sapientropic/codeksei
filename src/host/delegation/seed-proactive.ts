import type { AppRuntimeConfig } from "../../core/app-service-contract";
import {
  runCheckinScheduleNextWake,
  runCheckinTick,
  type CheckinResolvedTarget,
} from "../../checkin";
import { syncHostedCheckinPlanSetViaHermes, syncHostedCheckinPlanViaHermes } from "../recipes/hermes/wake-forwarder";
import { createHostedCheckinWakePlanSet } from "../../core/hosted-checkin-cron";

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
    followupContext = "",
    provider,
    nextWakeAt,
  }: {
    followupContext?: string;
    provider: string;
    nextWakeAt?: string;
  },
) {
  if (provider === "hermes" && nextWakeAt) {
    const scheduled = runCheckinScheduleNextWake({
      config,
      nextWakeAt,
      target,
    });
    const plan = createHostedCheckinWakePlanSet(config, target, {
      followupContext,
      plannedWakeAt: scheduled.nextWakeAt,
    });
    const sync = syncHostedCheckinPlanSetViaHermes(config, plan);
    return {
      status: "seeded",
      nextWakeAt: scheduled.nextWakeAt,
      sync,
      summary: null,
    };
  }

  const tick = runCheckinTick({
    config,
    target,
  });
  if (provider === "hermes") {
    const synced = syncHostedCheckinPlanViaHermes(config, target, tick, {
      followupContext,
    });
    return {
      status: tick.status === "scheduled" ? "seeded" : tick.status,
      nextWakeAt: synced.plan.jobs[0]?.plannedWakeAt || "",
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
