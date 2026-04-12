const { getCommandArgsSchema } = require("../contracts/command-args");
const { parseCliArgs } = require("../core/cli-args");
const {
  resolveNoteSyncTarget,
  syncNoteFile,
} = require("../core/note-sync");

async function runNoteSyncCommand(config, args = []) {
  const options = parseNoteSyncArgs(args);
  if (options.help) {
    printNoteSyncHelp();
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

function printNoteSyncHelp() {
  console.log([
    "用法: npm run note:sync -- (--project <slug> | --path <path>) --section <标题> [--text \"内容\" | --stdin] [--style bullet|paragraph] [--slot <id>] [--max-items N]",
    "",
    "说明：",
    "  轻量把一条 durable 摘要写回指定 note 的指定 section。",
    "  默认 style 是 bullet；传 --slot 时会用受控 block 替换同一槽位的旧内容。",
    "  不传 --slot 时会做轻量追加，并对相同内容去重。",
    "",
    "示例：",
    "  npm run note:sync -- --project <slug> --section \"最近动作\" --text \"把微信 prompt 收口为更温柔的 chief-of-staff 风格\" --max-items 6",
    "  npm run note:sync -- --project <slug> --section \"当前状态\" --slot current-status --style paragraph --text \"当前 shared bridge 正常运行，默认入口稳定。\"",
    "  npm run note:sync -- --path \"/absolute/path/to/note.md\" --section \"当前定位\" --text \"默认先接住，再定向，再推进。\"",
  ].join("\n"));
}

module.exports = {
  parseNoteSyncArgs,
  runNoteSyncCommand,
};
