import type { AppRuntimeConfig } from "../../../core/app-service-contract";
import type { FrameRuntimeConfig } from "../../runtime-config";
import { parseFrameServeArgs, runFrameServeCommand } from "./frame-serve-cli";

async function runFrameDevCommand(
  config: FrameRuntimeConfig & Partial<AppRuntimeConfig>,
  args: string[] = process.argv.slice(3),
): Promise<{ port: number; url: string } | null> {
  const options = parseFrameServeArgs(args);
  if (options.help) {
    return null;
  }
  return runFrameServeCommand(config, args);
}

export { runFrameDevCommand };
