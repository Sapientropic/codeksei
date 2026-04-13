import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { resolveSelectedAccount } from "../adapters/channel/weixin/account-store";
import { loadPersistedContextTokens } from "../adapters/channel/weixin/context-token-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildAuthRequiredError, buildTargetResolutionRequiredError } from "../core/cli-contract";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import { normalizeText } from "../core/text-normalization";
import { SystemMessageQueueStore } from "../state/system-message-queue-store";
import { inspectPreferredSenderId, inspectPreferredWorkspaceRoot } from "../workspace/default-targets";

interface SystemSendOptions {
  dryRun?: boolean;
  help: boolean;
  idempotencyKey?: string;
  user: string;
  text: string;
  workspace: string;
}

interface RuntimeConfig extends Record<string, unknown> {
  cliIdempotencyLedgerFile?: string;
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
    return {
      data: null,
      text: buildTerminalLeafHelp("system.send"),
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
        ? "system send 无法确定唯一 sender；请显式传 --user"
        : "system send 缺少可用 sender；请显式传 --user 或先完成 bootstrap",
      { candidates: senderResolution.candidates, source: senderResolution.source },
      "显式传 --user，或让唯一目标用户先和 bot 聊过一次。"
    );
  }
  const senderId = senderResolution.value;
  const text = options.text;
  const workspaceResolution = inspectPreferredWorkspaceRoot({
    config,
    accountId: account.accountId,
    senderId,
    explicitWorkspace: options.workspace,
    sessionStore,
  });
  if (!workspaceResolution.value) {
    throw buildTargetResolutionRequiredError(
      workspaceResolution.ambiguous
        ? "system send 无法确定唯一 workspace；请显式传 --workspace"
        : "system send 缺少可用 workspace；请显式传 --workspace 或设置稳定默认值",
      { candidates: workspaceResolution.candidates, source: workspaceResolution.source },
      "显式传 --workspace，或通过 --workspace-root 固定当前 workspace。"
    );
  }
  const workspaceRoot = workspaceResolution.value;
  if (!text) {
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
    throw buildAuthRequiredError(
      `找不到用户 ${senderId} 的 context token，先让这个用户和 bot 聊过一次`,
      "让目标用户先和 bot 聊过一次，或检查当前账号的 context token 持久化状态。"
    );
  }
  return runCliMutation<Record<string, unknown>>({
    commandKey: "system.send",
    config,
    configSource: {
      sessionsFile: config.sessionsFile,
      systemMessageQueueFile: config.systemMessageQueueFile,
      systemMessageDeadLetterFile: config.systemMessageDeadLetterFile,
    },
    dryRun: Boolean(options.dryRun),
    dryRunResult: {
      data: {
        senderId,
        text,
        workspaceRoot,
      },
      text: [
        "system send dry-run",
        `user: ${senderId}`,
        `workspace: ${workspaceRoot}`,
      ].join("\n"),
    },
    execute: async () => {
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

      return {
        data: {
          id: queued.id,
          senderId: queued.senderId,
          text: queued.text,
          workspaceRoot: queued.workspaceRoot,
        },
        text: [
          `system message queued: ${queued.id}`,
          `user: ${queued.senderId}`,
          `workspace: ${queued.workspaceRoot}`,
        ].join("\n"),
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      senderId,
      text,
      workspaceRoot,
    },
    resolvedTargets: {
      senderId,
      senderSource: senderResolution.source,
      workspaceRoot,
      workspaceSource: workspaceResolution.source,
    },
    sideEffects: [
      {
        kind: "enqueue_system_message",
        target: config.systemMessageQueueFile,
      },
    ],
  });
}

function parseSystemSendArgs(args: string[]): SystemSendOptions {
  return parseCliArgs<SystemSendOptions>(args, getCommandArgsSchema("systemSend"));
}

export { runSystemSendCommand };
