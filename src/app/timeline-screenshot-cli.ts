import * as crypto from "node:crypto";
import * as path from "node:path";

import * as accountStoreModule from "../adapters/channel/weixin/account-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { TimelineScreenshotQueueStore } from "../state/timeline-screenshot-queue-store";
import { resolvePreferredSenderId } from "../workspace/default-targets";

interface TimelineScreenshotOptions {
  help: boolean;
  user: string;
  outputFile: string;
  forwardArgs: string[];
}

interface RuntimeConfig extends Record<string, unknown> {
  sessionsFile: string;
  timelineScreenshotQueueFile: string;
}

interface SelectedAccount {
  accountId: string;
}

const { resolveSelectedAccount } = accountStoreModule as {
  resolveSelectedAccount: (config: unknown) => SelectedAccount;
};

async function runTimelineScreenshotCommand(config: RuntimeConfig, args: string[] = []) {
  const options = parseTimelineScreenshotArgs(args);
  if (options.help) {
    console.log(buildTerminalLeafHelp("timeline.screenshot"));
    return;
  }

  const account = resolveSelectedAccount(config);
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const senderId = resolvePreferredSenderId({
    config,
    accountId: account.accountId,
    explicitUser: options.user,
    sessionStore,
  });

  if (!senderId) {
    throw new Error("缺少发送目标，传 --user 或配置 CODEKSEI_ALLOWED_USER_IDS");
  }

  const queue = new TimelineScreenshotQueueStore({ filePath: config.timelineScreenshotQueueFile });
  const queued = queue.enqueue({
    id: crypto.randomUUID(),
    accountId: account.accountId,
    senderId,
    outputFile: options.outputFile,
    args: options.forwardArgs,
    createdAt: new Date().toISOString(),
  });

  console.log(`timeline screenshot queued: ${queued.id}`);
  console.log("delivery_status: pending_bridge_send");
}

function parseTimelineScreenshotArgs(args: string[]): TimelineScreenshotOptions {
  const options = parseCliArgs(args, getCommandArgsSchema("timelineScreenshot")) as unknown as TimelineScreenshotOptions;
  if (options.outputFile) {
    options.outputFile = path.resolve(options.outputFile);
  }
  return options;
}

export {
  runTimelineScreenshotCommand,
  parseTimelineScreenshotArgs,
};
