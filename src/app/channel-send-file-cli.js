const { getCommandArgsSchema } = require("../contracts/command-args");
const { parseCliArgs } = require("../core/cli-args");
const { buildTerminalLeafHelp } = require("../core/command-registry");

async function runChannelSendFileCommand(app, args = []) {
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

function parseArgs(args) {
  return parseCliArgs(args, getCommandArgsSchema("channelSendFile"));
}

module.exports = { runChannelSendFileCommand };
