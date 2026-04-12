const { getCommandArgsSchema } = require("../contracts/command-args");
const { parseCliArgs } = require("../core/cli-args");
const { buildTerminalLeafHelp } = require("../core/command-registry");
const {
  ensureDurableNoteSections,
  inspectDurableNoteRouting,
  resolveDurableNoteRoute,
} = require("../core/durable-note-schema");
const { syncNoteFile } = require("../core/note-sync");

async function runNoteAutoCommand(config: any, args: any[] = []) {
  const options = parseNoteAutoArgs(args);
  if (options.help) {
    console.log(buildTerminalLeafHelp("note.auto"));
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

function runNoteMaybeCommand(config: any, args: any[] = []) {
  const options = parseNoteAutoArgs(args);
  if (options.help) {
    console.log(buildTerminalLeafHelp("note.maybe"));
    return;
  }

  const inspection = inspectDurableNoteRouting(config, options);
  if (options.json) {
    console.log(JSON.stringify(inspection, null, 2));
    return;
  }
  console.log(formatInspection(inspection));
}

function parseNoteAutoArgs(args: any) {
  return parseCliArgs(args, getCommandArgsSchema("noteAuto"));
}

async function resolveBody(options: any) {
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
  return new Promise((resolve: any, reject: any) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: any) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer.trim()));
    process.stdin.on("error", reject);
  });
}

function formatInspection(inspection: any) {
  if (inspection.mode === "overview") {
    const scopeEntries = Object.entries(inspection.scopes || {}) as Array<[string, any]>;
    const lines = [
      "durable note 路由概览：",
      "",
      `workspace: ${inspection.workspaceRoot}`,
      `project kinds: ${inspection.project.kinds.join(", ") || "none"}`,
      `tracked projects: ${inspection.project.availableProjects.join(", ") || "none"}`,
    ];
    for (const [scope, info] of scopeEntries) {
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

module.exports = {
  parseNoteAutoArgs,
  runNoteAutoCommand,
  runNoteMaybeCommand,
};

export {};
