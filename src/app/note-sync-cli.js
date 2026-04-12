const { getCommandArgsSchema } = require("../contracts/command-args");
const { parseCliArgs } = require("../core/cli-args");
const { buildTerminalLeafHelp } = require("../core/command-registry");
const {
  resolveNoteSyncTarget,
  syncNoteFile,
} = require("../core/note-sync");

async function runNoteSyncCommand(config, args = []) {
  const options = parseNoteSyncArgs(args);
  if (options.help) {
    console.log(buildTerminalLeafHelp("note.sync"));
    return;
  }

  const text = await resolveBody(options);
  if (!text) {
    throw new Error("note 内容不能为空，传 --text 或通过 stdin 输入");
  }

  const target = resolveNoteSyncTarget(config, options);
  const result = syncNoteFile({
    filePath: target.filePath,
    section: options.section,
    text,
    style: options.style,
    slot: options.slot,
    maxItems: options.maxItems,
  });

  const action = result.changed ? "updated" : "noop";
  console.log(`note ${action}: ${result.filePath} [${options.section}]`);
}

function parseNoteSyncArgs(args) {
  return parseCliArgs(args, getCommandArgsSchema("noteSync"));
}

async function resolveBody(options) {
  const inline = String(options.text || "").trim();
  if (inline) {
    return inline;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return readStdin();
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer.trim()));
    process.stdin.on("error", reject);
  });
}

module.exports = {
  parseNoteSyncArgs,
  runNoteSyncCommand,
};
