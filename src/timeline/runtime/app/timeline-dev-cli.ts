import type { TimelineRuntimeConfig } from "../../runtime-config";
import { getCommandArgsSchema } from "../../../contracts/command-args";
import { parseCliArgs } from "../../../core/cli-args";
import { runTimelineDevServer } from "../application/timeline/dev-server";

interface TimelineDevCliOptions extends Record<string, unknown> {
  help: boolean;
  port: string;
}

async function runTimelineDevCommand(
  config: TimelineRuntimeConfig,
  args: string[] = process.argv.slice(3),
): Promise<{ port: number; url: string } | null> {
  const options = parseTimelineDevArgs(args);
  if (options.help) {
    return null;
  }
  const port = parsePort(options.port, config.timelinePort);
  return runTimelineDevServer(config, { port });
}

function parseTimelineDevArgs(args: string[]): TimelineDevCliOptions {
  return parseCliArgs<TimelineDevCliOptions>(args, getCommandArgsSchema("timelineDev"));
}

function parsePort(value: string, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

export { parseTimelineDevArgs, runTimelineDevCommand };
