import { createRequire } from "node:module";
import { readConfig } from "../core/config";
import { resolveTimelineRuntimeConfig, type TimelineRuntimeConfig } from "./runtime-config";

const runtimeRequire = createRequire(__filename);

type TimelineCommandHandler = (config: TimelineRuntimeConfig) => Promise<void>;

const { runTimelineBuildCommand } = runtimeRequire("./runtime/app/timeline-build-cli.js") as {
  runTimelineBuildCommand: TimelineCommandHandler;
};
const { runTimelineCategoriesCommand } = runtimeRequire("./runtime/app/timeline-categories-cli.js") as {
  runTimelineCategoriesCommand: TimelineCommandHandler;
};
const { runTimelineDevCommand } = runtimeRequire("./runtime/app/timeline-dev-cli.js") as {
  runTimelineDevCommand: TimelineCommandHandler;
};
const { runTimelineProposalsCommand } = runtimeRequire("./runtime/app/timeline-proposals-cli.js") as {
  runTimelineProposalsCommand: TimelineCommandHandler;
};
const { runTimelineReadCommand } = runtimeRequire("./runtime/app/timeline-read-cli.js") as {
  runTimelineReadCommand: TimelineCommandHandler;
};
const { runTimelineScreenshotCommand } = runtimeRequire("./runtime/app/timeline-screenshot-cli.js") as {
  runTimelineScreenshotCommand: TimelineCommandHandler;
};
const { runTimelineServeCommand } = runtimeRequire("./runtime/app/timeline-serve-cli.js") as {
  runTimelineServeCommand: TimelineCommandHandler;
};
const { runTimelineWriteCommand } = runtimeRequire("./runtime/app/timeline-write-cli.js") as {
  runTimelineWriteCommand: TimelineCommandHandler;
};

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

async function main(argv: string[] = process.argv): Promise<void> {
  const command = normalizeText(argv[2]);
  if (!command || ["help", "--help", "-h"].includes(command)) {
    printHelp();
    return;
  }

  const handler = COMMAND_HANDLERS[command];
  if (!handler) {
    throw new Error(`Unknown timeline command: ${command}`);
  }

  const baseConfig = readConfig();
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
