import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { bestEffortRefreshContextBoard, type ContextBoardConfig } from "../context/board";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import { resolveNoteSyncTarget, syncNoteFile } from "../notes/note-sync";

interface NoteSyncOptions {
  dryRun: boolean;
  help: boolean;
  idempotencyKey: string;
  project: string;
  path: string;
  section: string;
  text: string;
  style: string;
  slot: string;
  maxItems: string;
  useStdin: boolean;
}

interface NoteSyncTarget {
  kind: string;
  label: string;
  filePath: string;
}

interface NoteSyncResult {
  changed: boolean;
  filePath: string;
}


type NoteSyncRuntimeConfig = ContextBoardConfig & {
  cliIdempotencyLedgerFile?: string;
};

async function runNoteSyncCommand(config: NoteSyncRuntimeConfig, args: string[] = []) {
  const options = parseNoteSyncArgs(args);
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("note.sync"),
    } satisfies CommandExecutionResult;
  }

  const text = await resolveBody(options);
  if (!text) {
    throw new Error("note 内容不能为空，传 --text 或通过 stdin 输入");
  }

  const target = resolveNoteSyncTarget(
    config as Parameters<typeof resolveNoteSyncTarget>[0],
    options,
  );
  return runCliMutation<Record<string, unknown>>({
    commandKey: "note.sync",
    config: normalizeConfig(config),
    configSource: {
      workspaceRoot: normalizeConfig(config).workspaceRoot || "",
    },
    dryRun: options.dryRun,
    dryRunResult: {
      data: {
        filePath: target.filePath,
        label: target.label,
        section: options.section,
        style: options.style || "bullet",
        slot: options.slot,
      },
      text: [
        "note sync dry-run",
        `file: ${target.filePath}`,
        `section: ${options.section}`,
      ].join("\n"),
    },
    execute: async () => {
      const result = syncNoteFile({
        filePath: target.filePath,
        section: options.section,
        text,
        style: options.style,
        slot: options.slot,
        maxItems: options.maxItems,
      });

      const action = result.changed ? "updated" : "noop";
      bestEffortRefreshContextBoard(normalizeConfig(config), {
        mode: "proactive",
      });
      return {
        data: {
          action,
          filePath: result.filePath,
          section: options.section,
          target,
        },
        text: `note ${action}: ${result.filePath} [${options.section}]`,
      };
    },
    idempotencyKey: options.idempotencyKey,
    request: {
      filePath: target.filePath,
      maxItems: options.maxItems,
      section: options.section,
      slot: options.slot,
      style: options.style,
      text,
    },
    resolvedTargets: {
      filePath: target.filePath,
      label: target.label,
      section: options.section,
    },
    sideEffects: [
      {
        kind: "write_note",
        target: target.filePath,
      },
    ],
  });
}

function parseNoteSyncArgs(args: string[]): NoteSyncOptions {
  return parseCliArgs<NoteSyncOptions>(args, getCommandArgsSchema("noteSync"));
}

async function resolveBody(options: NoteSyncOptions): Promise<string> {
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

export {
  parseNoteSyncArgs,
  runNoteSyncCommand,
};

function normalizeConfig(config: unknown): NoteSyncRuntimeConfig {
  return config && typeof config === "object" ? { ...config } : {};
}
