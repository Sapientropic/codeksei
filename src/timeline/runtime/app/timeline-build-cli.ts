import type { TimelineRuntimeConfig } from "../../runtime-config";
import { buildTimelineSite } from "../application/timeline/build-dashboard";

async function runTimelineBuildCommand(config: TimelineRuntimeConfig): Promise<void> {
  const result = await buildTimelineSite(config);
  console.log(`timeline dashboard built: ${result.siteDir}`);
}

export { runTimelineBuildCommand };
