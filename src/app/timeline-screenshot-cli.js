const crypto = require("crypto");
const path = require("path");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { getCommandArgsSchema } = require("../contracts/command-args");
const { parseCliArgs } = require("../core/cli-args");
const { resolvePreferredSenderId } = require("../core/default-targets");
const { TimelineScreenshotQueueStore } = require("../core/timeline-screenshot-queue-store");

async function runTimelineScreenshotCommand(config, args = []) {
  const options = parseTimelineScreenshotArgs(args);
  if (options.help) {
    printTimelineScreenshotHelp();
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
    throw new Error("缺少发送目标，传 --user 或配置 CODEKSEI_ALLOWED_USER_IDS（或旧的 CYBERBOSS_ALLOWED_USER_IDS）");
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

function parseTimelineScreenshotArgs(args) {
  const options = parseCliArgs(args, getCommandArgsSchema("timelineScreenshot"));
  if (options.outputFile) {
    options.outputFile = path.resolve(options.outputFile);
  }
  return options;
}

function printTimelineScreenshotHelp() {
  console.log(`
用法: npm run timeline:screenshot -- --send [--user <wechatUserId>] [--output /绝对路径] [其他 timeline screenshot 参数]

说明:
  这条命令只负责把截图任务排进本地队列，真正截图和发送由正在运行的微信 bridge 异步执行。
  queued 不等于“已经发到微信”；只有 bridge 真正送达后，用户那边才会看到图片或文件。

示例:
  npm run timeline:screenshot -- --send --selector timeline
`);
}

module.exports = {
  runTimelineScreenshotCommand,
  parseTimelineScreenshotArgs,
};
