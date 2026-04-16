import type { AppRuntimeConfig } from "../../core/app-service-contract";
import { tryRefreshContextBoard, type ContextBoardConfig } from "../../context/board";
import {
  runCheckinScheduleNextWake,
  runCheckinTick,
  type CheckinResolvedTarget,
} from "../../checkin";
import type { HostedCheckinConfig } from "../recipes/hermes/wake-forwarder";
import { syncHostedCheckinPlanSetViaHermes, syncHostedCheckinPlanViaHermes } from "../recipes/hermes/wake-forwarder";
import { createHostedCheckinWakePlanSet } from "../../core/hosted-checkin-cron";

type SeedConfig = ContextBoardConfig & Pick<
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
  tryRefreshContextBoard(config, target, {
    followupContext,
    mode: "proactive",
  });
  if (provider === "hermes" && nextWakeAt) {
    const scheduled = runCheckinScheduleNextWake({
      config,
      nextWakeAt,
      target,
    });
    const plan = createHostedCheckinWakePlanSet(config as Partial<HostedCheckinConfig>, target, {
      followupContext,
      plannedWakeAt: scheduled.nextWakeAt,
    });
    const sync = syncHostedCheckinPlanSetViaHermes(config as Partial<HostedCheckinConfig>, plan);
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
    const synced = syncHostedCheckinPlanViaHermes(config as Partial<HostedCheckinConfig>, target, tick, {
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
