import { readConfig } from "../core/config";
import { runTimelineBuildCommand } from "./runtime/app/timeline-build-cli";
import { runTimelineCategoriesCommand } from "./runtime/app/timeline-categories-cli";
import { runTimelineDevCommand } from "./runtime/app/timeline-dev-cli";
import { runTimelineProposalsCommand } from "./runtime/app/timeline-proposals-cli";
import { runTimelineReadCommand } from "./runtime/app/timeline-read-cli";
import { runTimelineScreenshotCommand } from "./runtime/app/timeline-screenshot-cli";
import { runTimelineServeCommand } from "./runtime/app/timeline-serve-cli";
import { runTimelineWriteCommand } from "./runtime/app/timeline-write-cli";
import { resolveTimelineRuntimeConfig, type TimelineRuntimeConfig } from "./runtime-config";

type TimelineCommandHandler = (config: TimelineRuntimeConfig) => Promise<void>;

const COMMAND_HANDLERS: Record<string, TimelineCommandHandler> = {
  build: runTimelineBuildCommand,
  categories: runTimelineCategoriesCommand,
  dev: runTimelineDevCommand,
  proposals: runTimelineProposalsCommand,
  read: runTimelineReadCommand,
  screenshot: runTimelineScreenshotCommand,
  serve: runTimelineServeCommand,
  write: runTimelineWriteCommand,
};

type TimelineBaseConfig = Parameters<typeof resolveTimelineRuntimeConfig>[0];

async function main(
  argv: string[] = process.argv,
  baseConfig: TimelineBaseConfig = readConfig(),
): Promise<void> {
  const command = normalizeText(argv[2]);
  if (!command || ["help", "--help", "-h"].includes(command)) {
    printHelp();
    return;
  }

  const handler = COMMAND_HANDLERS[command];
  if (!handler) {
    throw new Error(`Unknown timeline command: ${command}`);
  }

  const timelineConfig = resolveTimelineRuntimeConfig(baseConfig);
  await handler(timelineConfig);
}

function printHelp(): void {
  console.log(`
Usage: codeksei timeline <command>

Commands:
  categories   Show the available category / subcategory / eventNode summary
  proposals    Show newly proposed event nodes
  read         Read the controlled timeline event JSON for a given day
  write        Write or incrementally update the timeline JSON for a given day
  build        Build the local static timeline dashboard
  serve        Start the local static timeline dashboard server
  dev          Watch source and data files, then rebuild and hot reload
  screenshot   Capture the timeline dashboard
  help         Show this help
`);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}

export {
  main,
};
