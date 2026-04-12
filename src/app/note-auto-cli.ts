import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import * as durableNoteSchemaModule from "../notes/durable-note-schema";
import * as noteSyncModule from "../notes/note-sync";

interface NoteAutoOptions {
  help: boolean;
  json: boolean;
  project: string;
  scope: string;
  kind: string;
  text: string;
  useStdin: boolean;
}

interface DurableNoteRoute {
  family: string;
  kind: string;
  filePath: string;
  section: string;
  style: string;
  slot: string;
  maxItems: number;
  sections: string[];
}

interface EnsureSectionsResult {
  changed: boolean;
  filePath: string;
  createdSections: string[];
}

interface NoteSyncResult {
  changed: boolean;
  filePath: string;
}

interface DurableNoteInspection {
  mode: string;
  workspaceRoot?: string;
  project?: {
    kinds: string[];
    availableProjects: string[];
  };
  scopes?: Record<string, { filePath: string; kinds: string[]; sections: string[] }>;
  family?: string;
  filePath: string;
  kinds?: string[];
  sections?: string[];
  route?: {
    kind: string;
    section: string;
    style: string;
    slot: string;
    maxItems: number;
  };
}

const {
  ensureDurableNoteSections,
  inspectDurableNoteRouting,
  resolveDurableNoteRoute,
} = durableNoteSchemaModule as {
  ensureDurableNoteSections: (filePath: string, sections: string[]) => EnsureSectionsResult;
  inspectDurableNoteRouting: (config: unknown, options: NoteAutoOptions) => DurableNoteInspection;
  resolveDurableNoteRoute: (config: unknown, options: NoteAutoOptions) => DurableNoteRoute;
};
const { syncNoteFile } = noteSyncModule as {
  syncNoteFile: (options: {
    filePath: string;
    section: string;
    text: string;
    style: string;
    slot: string;
    maxItems: number;
  }) => NoteSyncResult;
};

async function runNoteAutoCommand(config: unknown, args: string[] = []) {
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

function runNoteMaybeCommand(config: unknown, args: string[] = []) {
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

function parseNoteAutoArgs(args: string[]): NoteAutoOptions {
  return parseCliArgs(args, getCommandArgsSchema("noteAuto")) as unknown as NoteAutoOptions;
}

async function resolveBody(options: NoteAutoOptions): Promise<string> {
  const inline = String(options.text || "").trim();
  if (inline) {
    return inline;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return readStdin();
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer.trim()));
    process.stdin.on("error", reject);
  });
}

function formatInspection(inspection: DurableNoteInspection): string {
  if (inspection.mode === "overview") {
    const scopeEntries = Object.entries(inspection.scopes || {});
    const lines = [
      "durable note 路由概览：",
      "",
      `workspace: ${inspection.workspaceRoot || ""}`,
      `project kinds: ${inspection.project?.kinds.join(", ") || "none"}`,
      `tracked projects: ${inspection.project?.availableProjects.join(", ") || "none"}`,
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
      `durable note family: ${inspection.family || ""}`,
      `file: ${inspection.filePath}`,
      `kinds: ${inspection.kinds?.join(", ") || "none"}`,
      `sections: ${inspection.sections?.join(" / ") || "none"}`,
    ].join("\n");
  }

  return [
    `durable note route: ${inspection.family || ""}:${inspection.route?.kind || ""}`,
    `file: ${inspection.filePath}`,
    `section: ${inspection.route?.section || ""}`,
    `style: ${inspection.route?.style || ""}`,
    `slot: ${inspection.route?.slot || "-"}`,
    `maxItems: ${inspection.route?.maxItems || 0}`,
  ].join("\n");
}

export {
  parseNoteAutoArgs,
  runNoteAutoCommand,
  runNoteMaybeCommand,
};
