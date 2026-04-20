import { getCommandArgsSchema } from "../../../contracts/command-args";
import { parseCliArgs } from "../../../core/cli-args";
import type { AppRuntimeConfig } from "../../../core/app-service-contract";
import type { FrameRuntimeConfig } from "../../runtime-config";
import { startFrameSiteServer } from "../application/frame/serve-site";

interface FrameServeCliOptions extends Record<string, unknown> {
  help: boolean;
  port: string;
}

async function runFrameServeCommand(
  config: FrameRuntimeConfig & Partial<AppRuntimeConfig>,
  args: string[] = process.argv.slice(3),
): Promise<{ port: number; url: string } | null> {
  const options = parseFrameServeArgs(args);
  if (options.help) {
    return null;
  }
  const port = parsePort(options.port, config.framePort);
  const { info } = await startFrameSiteServer(config, { port });
  return info;
}

function parseFrameServeArgs(args: string[]): FrameServeCliOptions {
  return parseCliArgs<FrameServeCliOptions>(args, getCommandArgsSchema("frameServe"));
}

function parsePort(value: string, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}

export { parseFrameServeArgs, runFrameServeCommand };
