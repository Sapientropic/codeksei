const {
  resolveNoteSyncTarget,
  syncNoteFile,
} = require("../core/note-sync");

async function runNoteSyncCommand(config, args = process.argv.slice(4)) {
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
  const options = {
    help: false,
    project: "",
    path: "",
    section: "",
    text: "",
    style: "bullet",
    slot: "",
    maxItems: "",
    useStdin: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    if (!arg) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--stdin") {
      options.useStdin = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`未知参数: ${arg}`);
    }
    const value = String(args[index + 1] || "");
    if (!value || value.startsWith("--")) {
      throw new Error(`参数缺少值: ${arg}`);
    }
    if (arg === "--project") {
      options.project = value;
    } else if (arg === "--path") {
      options.path = value;
    } else if (arg === "--section") {
      options.section = value;
    } else if (arg === "--text") {
      options.text = value;
    } else if (arg === "--style") {
      options.style = value;
    } else if (arg === "--slot") {
      options.slot = value;
    } else if (arg === "--max-items") {
      options.maxItems = value;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
    index += 1;
  }

  return options;
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
    "  npm run note:sync -- --project cyberboss --section \"最近动作\" --text \"把微信 prompt 收口为更温柔的 chief-of-staff 风格\" --max-items 6",
    "  npm run note:sync -- --project cyberboss --section \"当前状态\" --slot current-status --style paragraph --text \"当前默认主 workspace 是 Website，shared bridge 正常运行。\"",
    "  npm run note:sync -- --path \"项目/Cyberboss 生活助理/README.md\" --section \"当前定位\" --text \"默认先接住，再定向，再推进，不做催债式主动提醒。\"",
  ].join("\n"));
}

module.exports = {
  parseNoteSyncArgs,
  runNoteSyncCommand,
};
