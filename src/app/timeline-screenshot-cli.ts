import * as crypto from "node:crypto";
import * as path from "node:path";

import { resolveSelectedAccount } from "../adapters/channel/weixin/account-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTargetResolutionRequiredError } from "../core/cli-contract";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import { sendFileViaHermesRepoLocal } from "../core/hermes-repo-local";
import { resolveHostMode } from "../core/host-mode";
import { resolveTimelineRuntimeConfig } from "../timeline/runtime-config";
import { TimelineScreenshotQueueStore } from "../state/timeline-screenshot-queue-store";
import {
  captureTimelineScreenshot,
} from "../timeline/runtime/application/timeline/capture-screenshot";
import {
  parseTimelineScreenshotRuntimeArgs,
} from "../timeline/runtime/app/timeline-screenshot-cli";
import { inspectPreferredSenderId } from "../workspace/default-targets";

interface TimelineScreenshotOptions {
  dryRun: boolean;
  help: boolean;
  idempotencyKey: string;
  user: string;
  outputFile: string;
  forwardArgs: string[];
}

type RuntimeConfig = Pick<
  AppRuntimeConfig,
  | "accountId"
  | "accountsDir"
  | "allowedUserIds"
  | "channel"
  | "channelProvider"
  | "cliIdempotencyLedgerFile"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "runtime"
  | "sessionsFile"
  | "stateDir"
  | "timelineStateDir"
  | "timelineScreenshotQueueFile"
  | "weixinBaseUrl"
  | "weixinRouteTag"
  | "workspaceId"
  | "workspaceRoot"
>;

interface SelectedAccount {
  accountId: string;
}

interface TimelineScreenshotCommandDeps {
  captureTimelineScreenshot?: typeof captureTimelineScreenshot;
  sendFileViaHermesRepoLocal?: typeof sendFileViaHermesRepoLocal;
}

interface HostedTimelineScreenshotDryRunData {
  deliveryMode: "hermes_repo_local_origin";
  forwardArgs: string[];
  outputFile: string;
  senderId: string;
}

interface HostedTimelineScreenshotResultData {
  chatId: string;
  outputFile: string;
  platform: string;
  selector: string;
  sessionId: string;
  sessionKey: string;
  threadId: string;
  url: string;
}

interface BridgeTimelineScreenshotDryRunData {
  forwardArgs: string[];
  outputFile: string;
  senderId: string;
}

interface BridgeTimelineScreenshotResultData {
  args: string[];
  id: string;
  outputFile: string;
  senderId: string;
}

async function runTimelineScreenshotCommand(
  config: RuntimeConfig,
  args: string[] = [],
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
  if (hostMode.mode === "hosted") {
    const timelineConfig = resolveTimelineRuntimeConfig(config);
    const runtimeArgs = buildHostedRuntimeArgs(options);
    const runtimeOptions = parseTimelineScreenshotRuntimeArgs(runtimeArgs, timelineConfig);
    if (runtimeOptions.help) {
      return {
        data: null,
        text: buildTerminalLeafHelp("timeline.screenshot"),
      } satisfies CommandExecutionResult;
    }
    return runCliMutation<
      HostedTimelineScreenshotDryRunData | HostedTimelineScreenshotResultData
    >({
      commandKey: "timeline.screenshot",
      config,
      configSource: {
        timelineStateDir: timelineConfig.timelineDir,
        timelineSiteDir: timelineConfig.timelineSiteDir,
      },
      dryRun: options.dryRun,
      dryRunResult: {
        data: {
          deliveryMode: "hermes_repo_local_origin",
          forwardArgs: options.forwardArgs,
          outputFile: runtimeOptions.outputFile,
          senderId: options.user,
        },
        text: [
          "timeline screenshot dry-run",
          "delivery: hermes_repo_local_origin",
          `output: ${runtimeOptions.outputFile}`,
        ].join("\n"),
      },
      execute: async () => {
        const captureScreenshot = deps.captureTimelineScreenshot || captureTimelineScreenshot;
        const sendFile = deps.sendFileViaHermesRepoLocal || sendFileViaHermesRepoLocal;
        const screenshot = await captureScreenshot(timelineConfig, runtimeOptions);
        const delivery = sendFile(config, {
          file_path: screenshot.outputFile,
          sender_id: options.user,
        });
        return {
          data: {
            chatId: delivery.chatId,
            outputFile: screenshot.outputFile,
            platform: delivery.platform,
            selector: screenshot.selector,
            sessionId: delivery.sessionId,
            sessionKey: delivery.sessionKey,
            threadId: delivery.threadId,
            url: screenshot.url,
          },
          text: [
            `timeline screenshot sent via Hermes repo-local: ${screenshot.outputFile}`,
            "delivery_status: delivered",
          ].join("\n"),
        };
      },
      idempotencyKey: options.idempotencyKey,
      request: {
        args: options.forwardArgs,
        deliveryMode: "hermes_repo_local_origin",
        outputFile: runtimeOptions.outputFile,
        senderId: options.user,
      },
      resolvedTargets: {
        outputFile: runtimeOptions.outputFile,
        senderId: options.user || "(active-session)",
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

  const account = resolveSelectedAccount(config);
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const senderResolution = inspectPreferredSenderId({
    config,
    accountId: account.accountId,
    explicitUser: options.user,
    sessionStore,
  });
  if (!senderResolution.value) {
    throw buildTargetResolutionRequiredError(
      senderResolution.ambiguous
        ? "timeline screenshot 无法确定唯一 sender；请显式传 --user"
        : "timeline screenshot 缺少可用 sender；请显式传 --user 或先完成 bootstrap",
      { candidates: senderResolution.candidates, source: senderResolution.source },
      "显式传 --user，或让唯一目标用户先和 bot 聊过一次。"
    );
  }
  const senderId = senderResolution.value;

  return runCliMutation<
    BridgeTimelineScreenshotDryRunData | BridgeTimelineScreenshotResultData
  >({
    commandKey: "timeline.screenshot",
    config,
    configSource: {
      sessionsFile: config.sessionsFile,
      timelineScreenshotQueueFile: config.timelineScreenshotQueueFile,
    },
    dryRun: options.dryRun,
    dryRunResult: {
      data: {
        forwardArgs: options.forwardArgs,
        outputFile: options.outputFile,
        senderId,
      },
      text: [
        "timeline screenshot dry-run",
        `sender: ${senderId}`,
        `queue: ${config.timelineScreenshotQueueFile}`,
      ].join("\n"),
    },
    execute: async () => {
      const queue = new TimelineScreenshotQueueStore({ filePath: config.timelineScreenshotQueueFile });
      const queued = queue.enqueue({
        id: crypto.randomUUID(),
        accountId: account.accountId,
        senderId,
        outputFile: options.outputFile,
        args: options.forwardArgs,
        createdAt: new Date().toISOString(),
      });

      return {
        data: {
          args: queued.args,
          id: queued.id,
          outputFile: queued.outputFile,
          senderId: queued.senderId,
        },
        text: [
          `timeline screenshot queued: ${queued.id}`,
          "delivery_status: pending_bridge_send",
        ].join("\n"),
      };
    },
    idempotencyKey: options.idempotencyKey,
    request: {
      args: options.forwardArgs,
      outputFile: options.outputFile,
      senderId,
    },
    resolvedTargets: {
      queueFile: config.timelineScreenshotQueueFile,
      senderId,
      senderSource: senderResolution.source,
    },
    sideEffects: [
      {
        kind: "enqueue_timeline_screenshot",
        target: config.timelineScreenshotQueueFile,
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

function buildHostedRuntimeArgs(options: TimelineScreenshotOptions): string[] {
  const runtimeArgs = [...options.forwardArgs];
  if (options.outputFile) {
    runtimeArgs.push("--output", options.outputFile);
  }
  return runtimeArgs;
}
