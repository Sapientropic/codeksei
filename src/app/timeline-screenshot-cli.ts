import * as crypto from "node:crypto";
import * as path from "node:path";

import { resolveSelectedAccount } from "../adapters/channel/weixin/account-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTargetResolutionRequiredError } from "../core/cli-contract";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import { TimelineScreenshotQueueStore } from "../state/timeline-screenshot-queue-store";
import { inspectPreferredSenderId } from "../workspace/default-targets";

interface TimelineScreenshotOptions {
  dryRun: boolean;
  help: boolean;
  idempotencyKey: string;
  user: string;
  outputFile: string;
  forwardArgs: string[];
}

interface RuntimeConfig extends Record<string, unknown> {
  cliIdempotencyLedgerFile?: string;
  sessionsFile: string;
  timelineScreenshotQueueFile: string;
}

interface SelectedAccount {
  accountId: string;
}


async function runTimelineScreenshotCommand(config: RuntimeConfig, args: string[] = []) {
  const options = parseTimelineScreenshotArgs(args);
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("timeline.screenshot"),
    } satisfies CommandExecutionResult;
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

  return runCliMutation<Record<string, unknown>>({
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
