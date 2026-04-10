const {
  ensureDurableNoteSections,
  inspectDurableNoteRouting,
  resolveDurableNoteRoute,
} = require("../core/durable-note-schema");
const { syncNoteFile } = require("../core/note-sync");

async function runNoteAutoCommand(config, args = process.argv.slice(4)) {
  const options = parseNoteAutoArgs(args);
  if (options.help) {
    printNoteAutoHelp();
    return;
  }

  const text = await resolveBody(options);
  if (!text) {
    throw new Error("note 内容不能为空，传 --text 或通过 stdin 输入");
  }

  const route = resolveDurableNoteRoute(config, options);
  const schemaResult = ensureDurableNoteSections(route.filePath, route.sections);
  const result = syncNoteFile({
    filePath: route.filePath,
    section: route.section,
    text,
    style: route.style,
    slot: route.slot,
    maxItems: route.maxItems,
  });

  const action = result.changed ? "updated" : "noop";
  console.log(`note auto ${action}: ${result.filePath} [${route.family}:${route.kind} -> ${route.section}]`);
  if (schemaResult.changed) {
    console.log(`schema ensured: ${schemaResult.filePath} (${schemaResult.createdSections.join(", ")})`);
  }
}

function runNoteMaybeCommand(config, args = process.argv.slice(4)) {
  const options = parseNoteAutoArgs(args);
  if (options.help) {
    printNoteMaybeHelp();
    return;
  }

  const inspection = inspectDurableNoteRouting(config, options);
  if (options.json) {
    console.log(JSON.stringify(inspection, null, 2));
    return;
  }
  console.log(formatInspection(inspection));
}

function parseNoteAutoArgs(args) {
  const options = {
    help: false,
    json: false,
    project: "",
    scope: "",
    kind: "",
    text: "",
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
    if (arg === "--json") {
      options.json = true;
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
    } else if (arg === "--scope") {
      options.scope = value;
    } else if (arg === "--kind") {
      options.kind = value;
    } else if (arg === "--text") {
      options.text = value;
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

function formatInspection(inspection) {
  if (inspection.mode === "overview") {
    const lines = [
      "durable note 路由概览：",
      "",
      `workspace: ${inspection.workspaceRoot}`,
      `project kinds: ${inspection.project.kinds.join(", ") || "none"}`,
      `tracked projects: ${inspection.project.availableProjects.join(", ") || "none"}`,
    ];
    for (const [scope, info] of Object.entries(inspection.scopes || {})) {
      lines.push("");
      lines.push(`[${scope}] ${info.filePath}`);
      lines.push(`kinds: ${info.kinds.join(", ") || "none"}`);
      lines.push(`sections: ${info.sections.join(" / ") || "none"}`);
    }
    return lines.join("\n");
  }

  if (inspection.mode === "family") {
    return [
      `durable note family: ${inspection.family}`,
      `file: ${inspection.filePath}`,
      `kinds: ${inspection.kinds.join(", ") || "none"}`,
      `sections: ${inspection.sections.join(" / ") || "none"}`,
    ].join("\n");
  }

  return [
    `durable note route: ${inspection.family}:${inspection.route.kind}`,
    `file: ${inspection.filePath}`,
    `section: ${inspection.route.section}`,
    `style: ${inspection.route.style}`,
    `slot: ${inspection.route.slot || "-"}`,
    `maxItems: ${inspection.route.maxItems || 0}`,
  ].join("\n");
}

function printNoteAutoHelp() {
  console.log([
    "用法: npm run note:auto -- (--project <slug> | --scope <name>) --kind <kind> [--text \"内容\" | --stdin]",
    "",
    "说明：",
    "  按 workspace 级 durable note schema 自动决定 file / section / style / slot。",
    "  代码项目常用 --project；生活助理、灵感等 durable note 用 --scope。",
    "",
    "示例：",
    "  npm run note:auto -- --project cyberboss --kind recent --text \"补了 note:auto / note:maybe 路由层\"",
    "  npm run note:auto -- --project cyberboss --kind status --text \"当前已接上 durable note schema，下一步观察真实线程里的使用手感。\"",
    "  npm run note:auto -- --scope assistant --kind preference --text \"默认先接住，再定向，再推进；少 mirror，少催债式 check-in。\"",
    "  npm run note:auto -- --scope inspiration --kind idea --text \"做一个只在切换点发力的 transition mode，让主动提醒更像接线而不是催债。\"",
  ].join("\n"));
}

function printNoteMaybeHelp() {
  console.log([
    "用法: npm run note:maybe -- [--project <slug> | --scope <name>] [--kind <kind>] [--json]",
    "",
    "说明：",
    "  只看 durable note 路由，不落盘。",
    "  不传参数时列出当前 workspace 可用 scope、kinds 和 tracked projects。",
    "",
    "示例：",
    "  npm run note:maybe",
    "  npm run note:maybe -- --project cyberboss",
    "  npm run note:maybe -- --scope assistant --kind preference",
    "  npm run note:maybe -- --scope inspiration --json",
  ].join("\n"));
}

module.exports = {
  parseNoteAutoArgs,
  runNoteAutoCommand,
  runNoteMaybeCommand,
};
