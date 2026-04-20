import * as path from "node:path";

import { readPrefixedIntEnv, resolveStateDir } from "../contracts/app-env";
import { normalizeText } from "../contracts/text-normalization";

export interface FrameRuntimeBaseConfig {
  stateDir?: unknown;
}

export interface FrameRuntimeConfig {
  frameAssetsDir: string;
  framePort: number;
  frameRootDir: string;
  frameSiteDir: string;
  stateDir: string;
}

function resolveFrameRuntimeConfig(baseConfig: FrameRuntimeBaseConfig = {}): FrameRuntimeConfig {
  const stateDir = normalizeText(baseConfig.stateDir) || resolveStateDir({ env: process.env });
  const frameRootDir = path.join(stateDir, "frame");
  return {
    frameAssetsDir: path.join(frameRootDir, "assets"),
    framePort: resolveFramePort(),
    frameRootDir,
    frameSiteDir: path.join(frameRootDir, "site"),
    stateDir,
  };
}

function resolveFramePort(): number {
  const codekseiPort = readPrefixedIntEnv(process.env, "FRAME_PORT", 0);
  return codekseiPort > 0 ? codekseiPort : 4327;
}

export { resolveFrameRuntimeConfig };
