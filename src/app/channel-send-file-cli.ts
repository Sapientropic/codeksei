import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";

interface ChannelSendFileOptions {
  help: boolean;
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

async function runChannelSendFileCommand(app: ChannelSendFileApp, args: string[] = []) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(buildTerminalLeafHelp("channel.send_file"));
    return;
  }

  const options = parseArgs(args);
  if (!options.path) {
    throw new Error("缺少 --path，指定要发回微信的本地文件路径");
  }

  const result = await app.sendLocalFileToCurrentChat({
    senderId: options.user,
    filePath: options.path,
  });
  console.log(`file sent: ${result.filePath}`);
}

function parseArgs(args: string[]): ChannelSendFileOptions {
  return parseCliArgs(args, getCommandArgsSchema("channelSendFile")) as unknown as ChannelSendFileOptions;
}

export { runChannelSendFileCommand };
