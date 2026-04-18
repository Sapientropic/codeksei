import * as path from "node:path";

import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import { resolveTimelineRuntimeConfig } from "../timeline/runtime-config";
import {
  captureTimelineScreenshot,
} from "../timeline/runtime/application/timeline/capture-screenshot";
import {
  parseTimelineScreenshotRuntimeArgs,
} from "../timeline/runtime/app/timeline-screenshot-cli";

interface TimelineScreenshotOptions {
  dryRun: boolean;
  help: boolean;
  idempotencyKey: string;
  outputFile: string;
  forwardArgs: string[];
}

type RuntimeConfig = Partial<Pick<
  AppRuntimeConfig,
  | "cliIdempotencyLedgerFile"
  | "stateDir"
  | "timelineStateDir"
  | "workspaceRoot"
>>;

interface TimelineScreenshotCommandDeps {
  captureTimelineScreenshot?: typeof captureTimelineScreenshot;
}

interface TimelineScreenshotCaptureData {
  deliveryMode: "local_file";
  outputFile: string;
  selector: string;
  url: string;
  width: number;
  height: number;
}

async function runTimelineScreenshotCommand(
  config: RuntimeConfig,
  args: string[] = [],
  deps: TimelineScreenshotCommandDeps = {},
) {
  const legacyFlagError = findLegacyTimelineDeliveryFlag(args);
  if (legacyFlagError) {
    throw new Error(legacyFlagError);
  }

  const options = parseTimelineScreenshotArgs(args);
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("timeline.screenshot"),
    } satisfies CommandExecutionResult;
  }

  const timelineConfig = resolveTimelineRuntimeConfig(config);
  const runtimeOptions = parseTimelineScreenshotRuntimeArgs(buildRuntimeArgs(options), timelineConfig);
  if (runtimeOptions.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("timeline.screenshot"),
    } satisfies CommandExecutionResult;
  }

  const captureScreenshot = deps.captureTimelineScreenshot || captureTimelineScreenshot;
  return runCliMutation<TimelineScreenshotCaptureData>({
    commandKey: "timeline.screenshot",
    config,
    configSource: {
      timelineStateDir: timelineConfig.timelineDir,
      timelineSiteDir: timelineConfig.timelineSiteDir,
    },
    dryRun: options.dryRun,
    dryRunResult: {
      data: {
        deliveryMode: "local_file",
        outputFile: runtimeOptions.outputFile,
        selector: runtimeOptions.selector,
        url: "",
        width: runtimeOptions.width,
        height: runtimeOptions.height,
      },
      text: [
        "timeline screenshot dry-run",
        "delivery: local_file",
        `output: ${runtimeOptions.outputFile}`,
        `selector: ${runtimeOptions.selector}`,
      ].join("\n"),
    },
    execute: async () => {
      const screenshot = await captureScreenshot(timelineConfig, runtimeOptions);
      return {
        data: {
          deliveryMode: "local_file",
          outputFile: screenshot.outputFile,
          selector: screenshot.selector,
          url: screenshot.url,
          width: screenshot.width,
          height: screenshot.height,
        },
        text: `timeline screenshot saved: ${screenshot.outputFile}`,
      };
    },
    idempotencyKey: options.idempotencyKey,
    request: {
      args: options.forwardArgs,
      outputFile: runtimeOptions.outputFile,
    },
    resolvedTargets: {
      outputFile: runtimeOptions.outputFile,
      selector: runtimeOptions.selector,
    },
    sideEffects: [
      {
        kind: "capture_timeline_screenshot",
        target: runtimeOptions.outputFile,
      },
    ],
  });
}

function parseTimelineScreenshotArgs(args: string[]): TimelineScreenshotOptions {
  const options = parseCliArgs<TimelineScreenshotOptions>(args, getCommandArgsSchema("timelineScreenshot"));
  if (options.outputFile) {
    options.outputFile = path.resolve(options.outputFile);
  }
  return options;
}

export {
  runTimelineScreenshotCommand,
  parseTimelineScreenshotArgs,
};

function findLegacyTimelineDeliveryFlag(args: string[]): string {
  const normalizedArgs = Array.isArray(args) ? args.map((value) => String(value || "").trim()) : [];
  for (const token of normalizedArgs) {
    if (token === "--send") {
      return [
        "timeline screenshot 不再接受 --send。",
        "先运行 `codeksei timeline screenshot ...` 生成本地图片，再运行 `codeksei channel send-file --path /absolute/path/to/screenshot.png` 发送。",
      ].join(" ");
    }
    if (token === "--user" || token.startsWith("--user=")) {
      return [
        "timeline screenshot 不再接受 --user；目标选择已属于独立 delivery 能力。",
        "先截图，再按需要运行 `codeksei channel send-file --path /absolute/path/to/screenshot.png --user <wechatUserId>`。",
      ].join(" ");
    }
  }
  return "";
}

function buildRuntimeArgs(options: TimelineScreenshotOptions): string[] {
  const runtimeArgs = [...options.forwardArgs];
  if (options.outputFile) {
    runtimeArgs.push("--output", options.outputFile);
  }
  return runtimeArgs;
}
