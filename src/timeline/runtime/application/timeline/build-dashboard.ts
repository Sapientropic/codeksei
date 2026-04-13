import type { TimelineRuntimeConfig } from "../../../runtime-config";
import { buildTimelineDashboard } from "../../infra/timeline/timeline-dashboard-builder";
import { createTimelineDashboardBuildInput } from "./shared";

async function buildTimelineSite(config: TimelineRuntimeConfig): Promise<{ siteDir: string }> {
  const buildInput = createTimelineDashboardBuildInput(config);
  await buildTimelineDashboard(buildInput);
  return {
    siteDir: buildInput.siteDir,
  };
}

export { buildTimelineSite };
