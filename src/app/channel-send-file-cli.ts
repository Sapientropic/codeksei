import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import {
  deliverLocalFileToCurrentChat,
  type LocalFileDeliveryApp,
  type LocalFileDeliveryConfig,
} from "../core/local-file-delivery";
import { resolveRequiredFilePath } from "../core/local-file-path";
import { normalizeText } from "../core/text-normalization";
import { resolveHostMode } from "../core/host-mode";

interface ChannelSendFileOptions {
  dryRun?: boolean;
  help: boolean;
  idempotencyKey?: string;
  path: string;
  user: string;
}

interface ChannelSendFileResult {
  filePath: string;
}

type ChannelSendFileApp = LocalFileDeliveryApp;

type ChannelSendFileConfig = LocalFileDeliveryConfig & Partial<Pick<
  AppRuntimeConfig,
  "cliIdempotencyLedgerFile"
>>;

async function runChannelSendFileCommand(
  app: ChannelSendFileApp,
  args: string[] = [],
  config: ChannelSendFileConfig = {},
): Promise<CommandExecutionResult> {
  if (args.includes("--help") || args.includes("-h")) {
    return {
      data: null,
      text: buildTerminalLeafHelp("channel.send_file"),
    };
  }

  const options = parseArgs(args);
  if (!options.path) {
    throw new Error("缺少 --path，指定要发回微信的本地文件路径");
  }
  const hostMode = resolveHostMode(config);
  const resolvedFilePath = resolveRequiredFilePath(options.path, {
    empty: "缺少 --path，指定要发回微信的本地文件路径",
  });
  const deliveryMode = hostMode.mode === "hosted"
    ? "hermes_repo_local"
    : "bridge";
  return runCliMutation<Record<string, unknown>>({
    commandKey: "channel.send-file",
    config,
    configSource: {},
    dryRun: Boolean(options.dryRun),
    dryRunResult: {
      data: {
        deliveryMode,
        filePath: resolvedFilePath,
        senderId: normalizeText(options.user) || "",
      },
      text: [
        "channel send-file dry-run",
        `file: ${resolvedFilePath}`,
        `delivery: ${deliveryMode}`,
        `sender: ${normalizeText(options.user) || "(session-or-runtime-default)"}`,
      ].join("\n"),
    },
    execute: async () => {
      const result = await deliverLocalFileToCurrentChat(app, config, {
        filePath: resolvedFilePath,
        senderId: normalizeText(options.user),
      });
      return {
        data: {
          chatId: result.chatId,
          filePath: result.filePath,
          platform: result.platform,
          sessionId: result.sessionId,
          sessionKey: result.sessionKey,
          threadId: result.threadId,
        },
        text: hostMode.mode === "hosted"
          ? `file sent via Hermes repo-local: ${result.filePath}`
          : `file sent: ${result.filePath}`,
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      deliveryMode,
      filePath: resolvedFilePath,
      senderId: normalizeText(options.user),
    },
    resolvedTargets: {
      deliveryMode,
      filePath: resolvedFilePath,
      senderId: normalizeText(options.user) || (hostMode.mode === "hosted" ? "(active-session)" : "(runtime-default)"),
    },
    sideEffects: [
      {
        kind: "send_wechat_file",
        target: resolvedFilePath,
      },
    ],
  });
}

function parseArgs(args: string[]): ChannelSendFileOptions {
  return parseCliArgs<ChannelSendFileOptions>(args, getCommandArgsSchema("channelSendFile"));
}

export { runChannelSendFileCommand };
