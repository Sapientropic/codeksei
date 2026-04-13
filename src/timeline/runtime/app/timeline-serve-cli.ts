import type { TimelineRuntimeConfig } from "../../runtime-config";
import { getCommandArgsSchema } from "../../../contracts/command-args";
import { parseCliArgs } from "../../../core/cli-args";
import { startTimelineSiteServer } from "../application/timeline/serve-site";

interface TimelineServeCliOptions extends Record<string, unknown> {
  help: boolean;
  port: string;
}

async function runTimelineServeCommand(
  config: TimelineRuntimeConfig,
  args: string[] = process.argv.slice(3),
): Promise<{ port: number; url: string } | null> {
  const options = parseTimelineServeArgs(args);
  if (options.help) {
    return null;
  }
  const port = parsePort(options.port, config.timelinePort);
  const { info } = await startTimelineSiteServer(config, { port });
  return info;
}

function parseTimelineServeArgs(args: string[]): TimelineServeCliOptions {
  return parseCliArgs<TimelineServeCliOptions>(args, getCommandArgsSchema("timelineServe"));
}

function parsePort(value: string, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

export { parseTimelineServeArgs, runTimelineServeCommand };
