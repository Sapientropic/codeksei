import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { bestEffortRefreshContextBoard, type ContextBoardConfig } from "../context/board";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import {
  type DurableNoteRoutingInspection,
  type ResolvedDurableNoteRoute,
  ensureDurableNoteSections,
  inspectDurableNoteRouting,
  resolveDurableNoteRoute,
} from "../notes/durable-note-schema";
import { syncNoteFile } from "../notes/note-sync";
import { runCliMutation } from "../core/cli-mutation";

interface NoteAutoOptions {
  dryRun: boolean;
  help: boolean;
  idempotencyKey: string;
  json: boolean;
  project: string;
  scope: string;
  kind: string;
  text: string;
  useStdin: boolean;
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

type NoteAutoRuntimeConfig = ContextBoardConfig & {
  cliIdempotencyLedgerFile?: string;
};

async function runNoteAutoCommand(config: NoteAutoRuntimeConfig, args: string[] = []) {
  const options = parseNoteAutoArgs(args);
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("note.auto"),
    } satisfies CommandExecutionResult;
  }

  const text = await resolveBody(options);
  if (!text) {
    throw new Error("note 内容不能为空，传 --text 或通过 stdin 输入");
  }

  const route = resolveDurableNoteRoute(normalizeConfig(config), options);
  return runCliMutation<Record<string, unknown>>({
    commandKey: "note.auto",
    config: normalizeConfig(config),
    configSource: {
      durableNoteSchemaConfigFile: normalizeConfig(config).durableNoteSchemaConfigFile || "",
      workspaceRoot: normalizeConfig(config).workspaceRoot || "",
    },
    dryRun: options.dryRun,
    dryRunResult: {
      data: {
        family: route.family,
        filePath: route.filePath,
        kind: route.kind,
        maxItems: route.maxItems,
        section: route.section,
        slot: route.slot,
        style: route.style,
      },
      text: [
        "note auto dry-run",
        `file: ${route.filePath}`,
        `section: ${route.section}`,
        `kind: ${route.kind}`,
      ].join("\n"),
    },
    execute: async () => {
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
      const lines = [`note auto ${action}: ${result.filePath} [${route.family}:${route.kind} -> ${route.section}]`];
      if (schemaResult.changed) {
        lines.push(`schema ensured: ${schemaResult.filePath} (${schemaResult.createdSections.join(", ")})`);
      }
      bestEffortRefreshContextBoard(normalizeConfig(config), {
        mode: "proactive",
      });

      return {
        data: {
          action,
          filePath: result.filePath,
          kind: route.kind,
          route,
          schemaEnsured: schemaResult,
        },
        text: lines.join("\n"),
      };
    },
    idempotencyKey: options.idempotencyKey,
    request: {
      body: text,
      kind: route.kind,
      section: route.section,
      slot: route.slot,
      style: route.style,
    },
    resolvedTargets: {
      filePath: route.filePath,
      kind: route.kind,
      section: route.section,
    },
    sideEffects: [
      {
        kind: "write_note",
        target: route.filePath,
      },
    ],
  });
}

function runNoteMaybeCommand(config: NoteAutoRuntimeConfig, args: string[] = []) {
  const options = parseNoteAutoArgs(args);
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("note.maybe"),
    } satisfies CommandExecutionResult;
  }

  const inspection = inspectDurableNoteRouting(normalizeConfig(config), options);
  return {
    data: inspection,
    meta: {
      effectiveWorkspaceRoot: inspection.mode === "overview" ? inspection.workspaceRoot : "",
    },
    text: options.json ? JSON.stringify(inspection, null, 2) : formatInspection(inspection),
  } satisfies CommandExecutionResult;
}

function parseNoteAutoArgs(args: string[]): NoteAutoOptions {
  return parseCliArgs<NoteAutoOptions>(args, getCommandArgsSchema("noteAuto"));
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

function formatInspection(inspection: DurableNoteRoutingInspection): string {
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

function normalizeConfig(config: unknown): NoteAutoRuntimeConfig {
  return config && typeof config === "object" ? { ...config } : {};
}

export {
  parseNoteAutoArgs,
  runNoteAutoCommand,
  runNoteMaybeCommand,
};
