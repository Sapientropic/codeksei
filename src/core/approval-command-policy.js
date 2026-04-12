// @ts-check

const path = require("path");
const { findTerminalCommandManifest } = require("../contracts/command-surface");

// Keep auto-approval on an explicit action allowlist instead of trusting the
// whole command manifest. The manifest is the command truth surface, but not
// every valid terminal command should silently bypass approval.
const AUTO_APPROVAL_ACTIONS = new Set([
  "diary.append",
  "note.auto",
  "note.maybe",
  "note.sync",
  "project.radar",
  "reminder.create",
  "review.monthly",
  "review.nightly",
  "review.weekly",
  "timeline.build",
  "timeline.categories",
  "timeline.dev",
  "timeline.event",
  "timeline.proposals",
  "timeline.read",
  "timeline.screenshot",
  "timeline.serve",
  "timeline.write",
]);

const SHELL_EXECUTABLES = new Set(["sh", "bash", "zsh"]);
const NODE_EXECUTABLES = new Set(["node", "node.exe"]);
const TERMINAL_BIN_EXECUTABLES = new Set([
  "codeksei",
  "codeksei.cmd",
  "codeksei.js",
  "cyberboss",
  "cyberboss.cmd",
  "cyberboss.js",
]);

function buildApprovalPromptText(approval) {
  const reasonText = normalizeText(approval?.reason);
  const commandText = normalizeText(approval?.command);
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

function buildApprovalPromptSignature(approval) {
  const reasonText = normalizeText(approval?.reason);
  const commandText = normalizeText(approval?.command);
  const commandTokens = Array.isArray(approval?.commandTokens)
    ? approval.commandTokens.map((token) => normalizeCommandArgument(token)).filter(Boolean)
    : [];
  return JSON.stringify({
    reason: reasonText,
    command: commandText,
    commandTokens,
  });
}

function matchesCommandPrefix(commandTokens, allowlist) {
  const normalizedCommandTokens = Array.isArray(commandTokens)
    ? commandTokens.map((part) => normalizeCommandArgument(part)).filter(Boolean)
    : [];
  if (!normalizedCommandTokens.length || !Array.isArray(allowlist) || !allowlist.length) {
    return false;
  }
  return allowlist.some((prefix) => {
    if (!Array.isArray(prefix) || !prefix.length || prefix.length > normalizedCommandTokens.length) {
      return false;
    }
    return prefix.every((part, index) => normalizeCommandArgument(part) === normalizedCommandTokens[index]);
  });
}

function matchesBuiltInCommandPrefix(commandTokens) {
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
  return Boolean(manifest?.action) && AUTO_APPROVAL_ACTIONS.has(manifest.action);
}

function normalizeCommandTokensForMatching(commandTokens) {
  const normalized = Array.isArray(commandTokens)
    ? commandTokens.map((part) => normalizeCommandArgument(part)).filter(Boolean)
    : [];
  if (normalized.length >= 3 && isShellWrapper(normalized[0], normalized[1])) {
    return splitCommandLine(normalized.slice(2).join(" "));
  }
  return normalized;
}

function resolveBuiltInTerminalManifest(commandTokens) {
  if (!Array.isArray(commandTokens) || !commandTokens.length) {
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

function resolveManifestFromNpmRun(commandTokens) {
  if (!Array.isArray(commandTokens) || commandTokens[0] !== "npm") {
    return null;
  }
  const runIndex = commandTokens.indexOf("run");
  if (runIndex < 0) {
    return null;
  }
  return findManifestForPackageScript(commandTokens[runIndex + 1]);
}

function findManifestForPackageScript(scriptName) {
  const normalizedScriptName = normalizeCommandArgument(scriptName).toLowerCase();
  if (!normalizedScriptName.includes(":")) {
    return null;
  }
  const parts = normalizedScriptName.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return findTerminalCommandManifest(parts[0], parts[1]);
}

function findManifestForTerminalCommand(commandTokens) {
  if (!Array.isArray(commandTokens) || !commandTokens.length) {
    return null;
  }
  const command = normalizeCommandArgument(commandTokens[0]).toLowerCase();
  const subcommand = normalizeCommandArgument(commandTokens[1]).toLowerCase();
  if (!command) {
    return null;
  }
  return findTerminalCommandManifest(command, subcommand);
}

function looksLikeCodekseiBinPath(binPath) {
  const normalized = normalizeCommandArgument(binPath).replace(/\\/g, "/").toLowerCase();
  return normalized === "./bin/cyberboss.js"
    || normalized.endsWith("/bin/cyberboss.js")
    || normalized === "./bin/codeksei.js"
    || normalized.endsWith("/bin/codeksei.js");
}

function isShellWrapper(command, flag) {
  const executable = path.basename(normalizeCommandArgument(command)).toLowerCase();
  return SHELL_EXECUTABLES.has(executable) && flag === "-lc";
}

function matchesBuiltInShellScript(scriptPath) {
  const basename = path.basename(normalizeCommandArgument(scriptPath)).toLowerCase();
  return basename === "timeline-screenshot.sh";
}

function splitCommandLine(input) {
  const tokens = [];
  let current = "";
  let quote = null;
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
    if (/\s/.test(char)) {
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

function normalizeCommandArgument(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  buildApprovalPromptSignature,
  buildApprovalPromptText,
  matchesBuiltInCommandPrefix,
  matchesCommandPrefix,
  normalizeCommandArgument,
  normalizeText,
  splitCommandLine,
};
