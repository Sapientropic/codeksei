import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import { normalizeText } from "../core/text-normalization";

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

interface ChannelSendFileApp {
  sendLocalFileToCurrentChat(args: {
    senderId: string;
    filePath: string;
  }): Promise<ChannelSendFileResult>;
}

interface ChannelSendFileConfig {
  cliIdempotencyLedgerFile?: string;
}

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
  return runCliMutation<Record<string, unknown>>({
    commandKey: "channel.send-file",
    config,
    configSource: {},
    dryRun: Boolean(options.dryRun),
    dryRunResult: {
      data: {
        filePath: options.path,
        senderId: normalizeText(options.user) || "",
      },
      text: [
        "channel send-file dry-run",
        `file: ${options.path}`,
        `sender: ${normalizeText(options.user) || "(runtime-default)"}`,
      ].join("\n"),
    },
    execute: async () => {
      const result = await app.sendLocalFileToCurrentChat({
        senderId: options.user,
        filePath: options.path,
      });
      return {
        data: {
          filePath: result.filePath,
        },
        text: `file sent: ${result.filePath}`,
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      filePath: options.path,
      senderId: normalizeText(options.user),
    },
    resolvedTargets: {
      filePath: options.path,
      senderId: normalizeText(options.user) || "(runtime-default)",
    },
    sideEffects: [
      {
        kind: "send_wechat_file",
        target: options.path,
      },
    ],
  });
}

function parseArgs(args: string[]): ChannelSendFileOptions {
  return parseCliArgs<ChannelSendFileOptions>(args, getCommandArgsSchema("channelSendFile"));
}

export { runChannelSendFileCommand };
