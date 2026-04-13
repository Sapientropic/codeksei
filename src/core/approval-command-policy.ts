// @ts-check

import * as path from "node:path";
import {
  findTerminalCommandManifest,
  findTerminalManifestByScriptName,
  type TerminalCommandManifestEntry,
} from "../contracts/command-surface";
import { matchesRuntimeEntrypoint } from "../contracts/runtime-entrypoints";

const SHELL_EXECUTABLES = new Set(["sh", "bash", "zsh"]);
const NODE_EXECUTABLES = new Set(["node", "node.exe"]);
const TERMINAL_BIN_EXECUTABLES = new Set([
  "codeksei",
  "codeksei.cmd",
  "codeksei.js",
]);

interface ApprovalRequestLike {
  reason?: unknown;
  command?: unknown;
  commandTokens?: unknown;
}

function buildApprovalPromptText(approval: ApprovalRequestLike): string {
  const reasonText = normalizeTrimmedText(approval.reason);
  const commandText = normalizeTrimmedText(approval.command);
  const sections = ["Codex 请求授权"];

  if (reasonText && reasonText !== commandText) {
    sections.push(`操作说明：\n${reasonText}`);
  }

  if (commandText) {
    sections.push(`待执行命令：\n${commandText}`);
  } else if (!reasonText) {
    sections.push("(unknown)");
  }

  sections.push([
    "回复以下命令继续：",
    "/yes  本次允许",
    "/always  本项目后续同前缀自动允许",
    "/no  拒绝本次请求",
  ].join("\n"));

  return sections.join("\n\n");
}

function buildApprovalPromptSignature(approval: ApprovalRequestLike): string {
  const reasonText = normalizeTrimmedText(approval.reason);
  const commandText = normalizeTrimmedText(approval.command);
  const commandTokens = normalizeCommandTokens(approval.commandTokens);
  return JSON.stringify({
    reason: reasonText,
    command: commandText,
    commandTokens,
  });
}

function matchesCommandPrefix(commandTokens: unknown, allowlist: unknown): boolean {
  const normalizedCommandTokens = normalizeCommandTokens(commandTokens);
  if (!normalizedCommandTokens.length || !Array.isArray(allowlist) || !allowlist.length) {
    return false;
  }
  return allowlist.some((prefix) => {
    if (!isStringArray(prefix) || !prefix.length || prefix.length > normalizedCommandTokens.length) {
      return false;
    }
    return prefix.every((part, index) => normalizeCommandArgument(part) === normalizedCommandTokens[index]);
  });
}

function matchesBuiltInCommandPrefix(commandTokens: unknown): boolean {
  const normalized = normalizeCommandTokensForMatching(commandTokens);
  if (!normalized.length) {
    return false;
  }

  if (matchesBuiltInShellScript(normalized[0])) {
    return true;
  }

  const executable = path.basename(normalizeCommandArgument(normalized[0])).toLowerCase();
  if (SHELL_EXECUTABLES.has(executable) && matchesBuiltInShellScript(normalized[1])) {
    return true;
  }

  const manifest = resolveBuiltInTerminalManifest(normalized);
  return Boolean(manifest?.approval.autoApprove);
}

function normalizeCommandTokensForMatching(commandTokens: unknown): string[] {
  const normalized = normalizeCommandTokens(commandTokens);
  if (normalized.length >= 3 && isShellWrapper(normalized[0], normalized[1])) {
    return splitCommandLine(normalized.slice(2).join(" "));
  }
  return normalized;
}

function resolveBuiltInTerminalManifest(commandTokens: string[]): TerminalCommandManifestEntry | null {
  if (!commandTokens.length) {
    return null;
  }

  const npmManifest = resolveManifestFromNpmRun(commandTokens);
  if (npmManifest) {
    return npmManifest;
  }

  const executable = path.basename(normalizeCommandArgument(commandTokens[0])).toLowerCase();
  if (NODE_EXECUTABLES.has(executable) && looksLikeCodekseiBinPath(commandTokens[1])) {
    return findManifestForTerminalCommand(commandTokens.slice(2));
  }
  if (TERMINAL_BIN_EXECUTABLES.has(executable)) {
    return findManifestForTerminalCommand(commandTokens.slice(1));
  }
  return null;
}

function resolveManifestFromNpmRun(commandTokens: string[]): TerminalCommandManifestEntry | null {
  if (commandTokens[0] !== "npm") {
    return null;
  }
  const runIndex = commandTokens.indexOf("run");
  if (runIndex < 0) {
    return null;
  }
  return findManifestForPackageScript(commandTokens[runIndex + 1]);
}

function findManifestForPackageScript(scriptName: unknown): TerminalCommandManifestEntry | null {
  return findTerminalManifestByScriptName(scriptName);
}

function findManifestForTerminalCommand(commandTokens: string[]): TerminalCommandManifestEntry | null {
  if (!commandTokens.length) {
    return null;
  }
  const command = normalizeCommandArgument(commandTokens[0]).toLowerCase();
  const subcommand = normalizeCommandArgument(commandTokens[1]).toLowerCase();
  if (!command) {
    return null;
  }
  return findTerminalCommandManifest(command, subcommand);
}

function looksLikeCodekseiBinPath(binPath: unknown): boolean {
  return matchesRuntimeEntrypoint(binPath, "cli");
}

function isShellWrapper(command: unknown, flag: unknown): boolean {
  const executable = path.basename(normalizeCommandArgument(command)).toLowerCase();
  return SHELL_EXECUTABLES.has(executable) && flag === "-lc";
}

function matchesBuiltInShellScript(scriptPath: unknown): boolean {
  const basename = path.basename(normalizeCommandArgument(scriptPath)).toLowerCase();
  return basename === "timeline-screenshot.sh";
}

function splitCommandLine(input: unknown): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (const char of String(input || "")) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function normalizeCommandTokens(commandTokens: unknown): string[] {
  const normalized: string[] = [];
  if (!Array.isArray(commandTokens)) {
    return normalized;
  }
  for (const part of commandTokens) {
    const normalizedPart = normalizeCommandArgument(part);
    if (normalizedPart) {
      normalized.push(normalizedPart);
    }
  }
  return normalized;
}

function normalizeCommandArgument(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTrimmedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export {
  buildApprovalPromptSignature,
  buildApprovalPromptText,
  matchesBuiltInCommandPrefix,
  matchesCommandPrefix,
  normalizeCommandArgument,
  normalizeTrimmedText,
  splitCommandLine,
};
