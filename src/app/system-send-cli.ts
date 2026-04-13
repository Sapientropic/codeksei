import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { resolveSelectedAccount } from "../adapters/channel/weixin/account-store";
import { loadPersistedContextTokens } from "../adapters/channel/weixin/context-token-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { SystemMessageQueueStore } from "../state/system-message-queue-store";
import { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } from "../workspace/default-targets";

interface SystemSendOptions {
  help: boolean;
  user: string;
  text: string;
  workspace: string;
}

interface RuntimeConfig extends Record<string, unknown> {
  sessionsFile: string;
  systemMessageQueueFile: string;
  systemMessageDeadLetterFile: string;
}

interface SelectedAccount {
  accountId: string;
}

interface QueuedSystemMessage {
  id: string;
  senderId: string;
  workspaceRoot: string;
}

async function runSystemSendCommand(config: RuntimeConfig, args: string[] = []) {
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

function parseSystemSendArgs(args: string[]): SystemSendOptions {
  return parseCliArgs<SystemSendOptions>(args, getCommandArgsSchema("systemSend"));
}

export { runSystemSendCommand };
