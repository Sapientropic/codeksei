import * as fs from "node:fs";

import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { runCliMutation } from "../core/cli-mutation";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { normalizeText } from "../core/text-normalization";
import {
  rememberCompanionMemory,
  type CompanionMemoryRuntimeConfig,
} from "../companion-memory/remember";
import { type CompanionMemorySource } from "../companion-memory/contracts";
import { readForeignJsonDocument } from "../state/json-state";

interface CompanionRememberOptions {
  contextFile: string;
  dryRun: boolean;
  help: boolean;
  idempotencyKey: string;
  source: string;
  text: string;
  useStdin: boolean;
  user: string;
  workspace: string;
}

type CompanionRememberCliConfig = CompanionMemoryRuntimeConfig;

export async function runCompanionRememberCommand(
  config: CompanionRememberCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<CompanionRememberOptions>(args, getCommandArgsSchema("companionRemember"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("companion.remember"),
    };
  }

  const userId = requireUserId(options.user);
  const workspaceRoot = requireWorkspaceRoot(options.workspace || String(config.workspaceRoot || ""));
  const source = requireCompanionMemorySource(options.source);
  const text = await resolveBody(options.text, options.useStdin);
  if (!text) {
    throw new Error("companion remember 需要输入用户最新内容，传 --text 或 --stdin。");
  }
  const context = readContextFile(options.contextFile);

  return runCliMutation<Record<string, unknown>>({
    commandKey: "companion.remember",
    config,
    configSource: {
      stateDir: normalizeText(config.stateDir),
      workspaceRoot,
    },
    dryRun: options.dryRun,
    dryRunResult: {
      data: {
        context,
        source,
        text,
        userId,
        workspaceRoot,
      },
      text: [
        "companion remember dry-run",
        `user: ${userId}`,
        `workspace: ${workspaceRoot}`,
        `source: ${source}`,
      ].join("\n"),
    },
    execute: async () => {
      const result = await rememberCompanionMemory(config, {
        options: context,
        source,
        text,
        userId,
        workspaceRoot,
      });
      return {
        data: {
          boardRefreshed: result.boardRefreshed,
          noteFiles: result.noteFiles,
          reasons: result.reasons,
          source,
          state: result.state,
          status: result.status,
          updatedSlots: result.updatedSlots,
          userId,
          writes: result.writes,
          workspaceRoot,
        },
        text: renderCompanionRememberText(result, userId, source),
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      context,
      source,
      text,
      userId,
      workspaceRoot,
    },
    resolvedTargets: {
      stateFile: `${normalizeText(config.stateDir)}/companion-memory/<user>.json`,
      userId,
      workspaceRoot,
    },
    sideEffects: [
      {
        kind: "write_companion_memory",
        target: `${normalizeText(config.stateDir)}/companion-memory/<user>.json`,
      },
      {
        kind: "write_note",
        target: "companion scope",
      },
      {
        kind: "refresh_context_board",
        target: `${normalizeText(config.stateDir)}/context/boards/<target>.md`,
      },
    ],
  });
}

async function resolveBody(text: string, useStdin: boolean): Promise<string> {
  const inline = normalizeText(text);
  if (inline) {
    return inline;
  }
  if (!useStdin && process.stdin.isTTY) {
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

function readContextFile(filePath: string): Record<string, unknown> {
  const normalized = normalizeText(filePath);
  if (!normalized) {
    return {};
  }
  if (!fs.existsSync(normalized)) {
    throw new Error(`找不到 context-file: ${normalized}`);
  }
  const value = readForeignJsonDocument<Record<string, unknown>>(normalized, { fallback: {} });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`context-file 不是有效 JSON object: ${normalized}`);
  }
  return value;
}

function requireUserId(userId: string): string {
  const normalized = normalizeText(userId);
  if (!normalized) {
    throw new Error("缺少 --user <id>。");
  }
  return normalized;
}

function requireWorkspaceRoot(workspaceRoot: string): string {
  const normalized = normalizeText(workspaceRoot);
  if (!normalized) {
    throw new Error("缺少 --workspace <path>，且当前配置里也没有稳定 workspaceRoot。");
  }
  return normalized;
}

function requireCompanionMemorySource(value: string): CompanionMemorySource {
  const normalized = normalizeText(value);
  if (
    normalized !== "host_user_turn"
    && normalized !== "onboarding_turn"
    && normalized !== "checkin_followup"
    && normalized !== "review_summary"
    && normalized !== "diary_supplement"
    && normalized !== "reminder_proactive"
  ) {
    throw new Error(`不支持的 companion remember source: ${value}`);
  }
  return normalized;
}

function renderCompanionRememberText(
  result: Awaited<ReturnType<typeof rememberCompanionMemory>>,
  userId: string,
  source: CompanionMemorySource,
): string {
  return [
    `user: ${userId}`,
    `source: ${source}`,
    `status: ${result.status}`,
    `updatedSlots: ${result.updatedSlots.join(", ") || "(none)"}`,
    `noteFiles: ${result.noteFiles.join(", ") || "(none)"}`,
    `boardRefreshed: ${result.boardRefreshed ? "yes" : "no"}`,
    `reasons: ${result.reasons.join(", ") || "(none)"}`,
  ].join("\n");
}
