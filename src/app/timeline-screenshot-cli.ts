import * as path from "node:path";

import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import {
  deliverLocalFileToCurrentChat,
  type LocalFileDeliveryApp,
  type DeliveredLocalFile,
  type LocalFileDeliveryConfig,
} from "../core/local-file-delivery";
import { resolveHostMode } from "../core/host-mode";
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
  send: boolean;
  user: string;
  forwardArgs: string[];
}

type RuntimeConfig = LocalFileDeliveryConfig & Partial<Pick<
  AppRuntimeConfig,
  | "cliIdempotencyLedgerFile"
  | "stateDir"
  | "timelineStateDir"
  | "workspaceRoot"
>>;

type TimelineScreenshotApp = LocalFileDeliveryApp;

interface TimelineScreenshotCommandDeps {
  captureTimelineScreenshot?: typeof captureTimelineScreenshot;
  deliverLocalFileToCurrentChat?: (
    app: TimelineScreenshotApp | null,
    config: RuntimeConfig,
    args: { filePath: string; senderId?: string },
  ) => Promise<DeliveredLocalFile>;
}

interface TimelineScreenshotCaptureData {
  deliveryMode: "local_file";
  outputFile: string;
  selector: string;
  url: string;
  width: number;
  height: number;
}

interface TimelineScreenshotSentData {
  chatId: string;
  deliveryMode: "current_host_delivery";
  height: number;
  outputFile: string;
  platform: string;
  selector: string;
  senderId: string;
  sessionId: string;
  sessionKey: string;
  threadId: string;
  url: string;
  width: number;
}

async function runTimelineScreenshotCommand(
  config: RuntimeConfig,
  args: string[] = [],
  app: TimelineScreenshotApp | null = null,
  deps: TimelineScreenshotCommandDeps = {},
) {
  const options = parseTimelineScreenshotArgs(args);
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("timeline.screenshot"),
    } satisfies CommandExecutionResult;
  }

  const hostMode = resolveHostMode(config);
  const timelineConfig = resolveTimelineRuntimeConfig(config);
  const runtimeOptions = parseTimelineScreenshotRuntimeArgs(buildRuntimeArgs(options), timelineConfig);
  if (runtimeOptions.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("timeline.screenshot"),
    } satisfies CommandExecutionResult;
  }

  const captureScreenshot = deps.captureTimelineScreenshot || captureTimelineScreenshot;
  const deliverFile = deps.deliverLocalFileToCurrentChat || deliverLocalFileToCurrentChat;
  if (!options.send) {
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

  return runCliMutation<TimelineScreenshotCaptureData | TimelineScreenshotSentData>({
    commandKey: "timeline.screenshot",
    config,
    configSource: {
      hostProfile: hostMode.profile,
      timelineStateDir: timelineConfig.timelineDir,
      timelineSiteDir: timelineConfig.timelineSiteDir,
    },
    dryRun: options.dryRun,
    dryRunResult: {
      data: {
        chatId: "",
        deliveryMode: "current_host_delivery",
        outputFile: runtimeOptions.outputFile,
        platform: "",
        selector: runtimeOptions.selector,
        senderId: options.user,
        sessionId: "",
        sessionKey: "",
        threadId: "",
        url: "",
        width: runtimeOptions.width,
        height: runtimeOptions.height,
      },
      text: [
        "timeline screenshot dry-run",
        "delivery: current_host_delivery",
        `output: ${runtimeOptions.outputFile}`,
        `selector: ${runtimeOptions.selector}`,
        `sender: ${options.user || (hostMode.mode === "hosted" ? "(active-session)" : "(runtime-default)")}`,
      ].join("\n"),
    },
    execute: async () => {
      const screenshot = await captureScreenshot(timelineConfig, runtimeOptions);
      const delivery = await deliverFile(app, config, {
        filePath: screenshot.outputFile,
        senderId: options.user,
      });
      return {
        data: {
          chatId: delivery.chatId,
          deliveryMode: "current_host_delivery",
          outputFile: screenshot.outputFile,
          platform: delivery.platform,
          selector: screenshot.selector,
          senderId: options.user,
          sessionId: delivery.sessionId,
          sessionKey: delivery.sessionKey,
          threadId: delivery.threadId,
          url: screenshot.url,
          width: screenshot.width,
          height: screenshot.height,
        },
        text: hostMode.mode === "hosted"
          ? `timeline screenshot sent via Hermes repo-local: ${screenshot.outputFile}`
          : `timeline screenshot sent: ${screenshot.outputFile}`,
      };
    },
    idempotencyKey: options.idempotencyKey,
    request: {
      args: options.forwardArgs,
      outputFile: runtimeOptions.outputFile,
      send: true,
      senderId: options.user,
    },
    resolvedTargets: {
      outputFile: runtimeOptions.outputFile,
      selector: runtimeOptions.selector,
      senderId: options.user || (hostMode.mode === "hosted" ? "(active-session)" : "(runtime-default)"),
    },
    sideEffects: [
      {
        kind: "capture_timeline_screenshot",
        target: runtimeOptions.outputFile,
      },
      {
        kind: "send_wechat_file",
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

function buildRuntimeArgs(options: TimelineScreenshotOptions): string[] {
  const runtimeArgs = [...options.forwardArgs];
  if (options.outputFile) {
    runtimeArgs.push("--output", options.outputFile);
  }
  return runtimeArgs;
}
