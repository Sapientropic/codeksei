import { normalizeText } from "../core/text-normalization";
import { readConfig } from "../core/config";
import { runTimelineBuildCommand } from "./runtime/app/timeline-build-cli";
import { buildTimelineCategoriesHelp, runTimelineCategoriesCommand } from "./runtime/app/timeline-categories-cli";
import { runTimelineDevCommand } from "./runtime/app/timeline-dev-cli";
import { buildTimelineProposalsHelp, runTimelineProposalsCommand } from "./runtime/app/timeline-proposals-cli";
import { buildTimelineReadHelp, runTimelineReadCommand } from "./runtime/app/timeline-read-cli";
import { runTimelineScreenshotCommand } from "./runtime/app/timeline-screenshot-cli";
import { runTimelineServeCommand } from "./runtime/app/timeline-serve-cli";
import { buildTimelineWriteHelp, runTimelineWriteCommand } from "./runtime/app/timeline-write-cli";
import { resolveTimelineRuntimeConfig, type TimelineRuntimeConfig } from "./runtime-config";

type TimelineCommandHandler = (config: TimelineRuntimeConfig) => Promise<unknown>;

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
  const result = await handler(timelineConfig);
  renderTimelineCommandResult(command, result);
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

function renderTimelineCommandResult(command: string, result: unknown): void {
  if (result == null) {
    switch (command) {
      case "categories":
        console.log(buildTimelineCategoriesHelp());
        return;
      case "proposals":
        console.log(buildTimelineProposalsHelp());
        return;
      case "read":
        console.log(buildTimelineReadHelp());
        return;
      case "write":
        console.log(buildTimelineWriteHelp());
        return;
      case "serve":
        console.log("Usage: codeksei timeline serve [--port 4317]");
        return;
      case "dev":
        console.log("Usage: codeksei timeline dev [--port 4317]");
        return;
      default:
        return;
    }
  }
  if (command === "build") {
    const siteDir = typeof result === "object" && result && "siteDir" in result
      ? String((result as { siteDir?: unknown }).siteDir || "")
      : "";
    console.log(`timeline dashboard built: ${siteDir}`);
    return;
  }
  if (command === "serve") {
    const url = typeof result === "object" && result && "url" in result
      ? String((result as { url?: unknown }).url || "")
      : "";
    console.log(`timeline dashboard: ${url}`);
    return;
  }
  if (command === "dev") {
    const url = typeof result === "object" && result && "url" in result
      ? String((result as { url?: unknown }).url || "")
      : "";
    console.log(`timeline dev: ${url}`);
    return;
  }
  if (command === "write") {
    const payload = result as { date?: unknown; mode?: unknown; eventCount?: unknown; status?: unknown };
    console.log(`timeline written: ${String(payload.date || "")}`);
    console.log(`mode: ${String(payload.mode || "")}`);
    console.log(`events: ${String(payload.eventCount || 0)}`);
    console.log(`status: ${String(payload.status || "")}`);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
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

