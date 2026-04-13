import type { TimelineRuntimeConfig } from "../../runtime-config";
import { buildTimelineSite } from "../application/timeline/build-dashboard";

async function runTimelineBuildCommand(config: TimelineRuntimeConfig): Promise<{ siteDir: string }> {
  return buildTimelineSite(config);
}

export { runTimelineBuildCommand };
