import type { FrameRuntimeConfig } from "../../runtime-config";
import { buildFrameSite } from "../application/frame/build-site";

async function runFrameBuildCommand(config: FrameRuntimeConfig): Promise<{ siteDir: string }> {
  return buildFrameSite(config);
}

export { runFrameBuildCommand };
