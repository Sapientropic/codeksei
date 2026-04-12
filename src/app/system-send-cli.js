const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { loadPersistedContextTokens } = require("../adapters/channel/weixin/context-token-store");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { getCommandArgsSchema } = require("../contracts/command-args");
const { parseCliArgs } = require("../core/cli-args");
const { buildTerminalLeafHelp } = require("../core/command-registry");
const { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } = require("../core/default-targets");
const { SystemMessageQueueStore } = require("../core/system-message-queue-store");

async function runSystemSendCommand(config, args = []) {
  const options = parseSystemSendArgs(args);
  if (options.help) {
    console.log(buildTerminalLeafHelp("system.send"));
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
  const text = options.text;
  const workspaceRoot = resolvePreferredWorkspaceRoot({
    config,
    accountId: account.accountId,
    senderId,
    explicitWorkspace: options.workspace,
    sessionStore,
  });
  if (!senderId || !text || !workspaceRoot) {
    console.log(buildTerminalLeafHelp("system.send"));
    throw new Error("system send 缺少必要参数");
  }
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error(`workspace 必须是绝对路径: ${workspaceRoot}`);
  }

  let workspaceStats = null;
  try {
    workspaceStats = fs.statSync(workspaceRoot);
  } catch {
    throw new Error(`workspace 不存在: ${workspaceRoot}`);
  }
  if (!workspaceStats.isDirectory()) {
    throw new Error(`workspace 不是目录: ${workspaceRoot}`);
  }

  const contextTokens = loadPersistedContextTokens(config, account.accountId);
  if (!contextTokens[senderId]) {
    throw new Error(`找不到用户 ${senderId} 的 context token，先让这个用户和 bot 聊过一次`);
  }
  const queue = new SystemMessageQueueStore({
    filePath: config.systemMessageQueueFile,
    deadLetterFilePath: config.systemMessageDeadLetterFile,
  });
  const queued = queue.enqueue({
    id: crypto.randomUUID(),
    accountId: account.accountId,
    senderId,
    workspaceRoot,
    text,
    kind: "manual",
    createdAt: new Date().toISOString(),
  });

  console.log(`system message queued: ${queued.id}`);
  console.log(`user: ${queued.senderId}`);
  console.log(`workspace: ${queued.workspaceRoot}`);
}

function parseSystemSendArgs(args) {
  return parseCliArgs(args, getCommandArgsSchema("systemSend"));
}

function normalizeWorkspacePath(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { runSystemSendCommand };
