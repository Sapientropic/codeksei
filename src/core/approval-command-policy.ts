// @ts-check

const path = require("path");
const {
  findTerminalCommandManifest,
  findTerminalManifestByScriptName,
} = require("../contracts/command-surface");

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

function buildApprovalPromptText(approval: any) {
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

function buildApprovalPromptSignature(approval: any) {
  const reasonText = normalizeText(approval?.reason);
  const commandText = normalizeText(approval?.command);
  const commandTokens = Array.isArray(approval?.commandTokens)
    ? approval.commandTokens.map((token: any) => normalizeCommandArgument(token)).filter(Boolean)
    : [];
  return JSON.stringify({
    reason: reasonText,
    command: commandText,
    commandTokens,
  });
}

function matchesCommandPrefix(commandTokens: any, allowlist: any) {
  const normalizedCommandTokens = Array.isArray(commandTokens)
    ? commandTokens.map((part: any) => normalizeCommandArgument(part)).filter(Boolean)
    : [];
  if (!normalizedCommandTokens.length || !Array.isArray(allowlist) || !allowlist.length) {
    return false;
  }
  return allowlist.some((prefix: any) => {
    if (!Array.isArray(prefix) || !prefix.length || prefix.length > normalizedCommandTokens.length) {
      return false;
    }
    return prefix.every((part: any, index: any) => normalizeCommandArgument(part) === normalizedCommandTokens[index]);
  });
}

function matchesBuiltInCommandPrefix(commandTokens: any) {
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
  return Boolean(manifest?.approval?.autoApprove);
}

function normalizeCommandTokensForMatching(commandTokens: any) {
  const normalized = Array.isArray(commandTokens)
    ? commandTokens.map((part: any) => normalizeCommandArgument(part)).filter(Boolean)
    : [];
  if (normalized.length >= 3 && isShellWrapper(normalized[0], normalized[1])) {
    return splitCommandLine(normalized.slice(2).join(" "));
  }
  return normalized;
}

function resolveBuiltInTerminalManifest(commandTokens: any) {
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

function resolveManifestFromNpmRun(commandTokens: any) {
  if (!Array.isArray(commandTokens) || commandTokens[0] !== "npm") {
    return null;
  }
  const runIndex = commandTokens.indexOf("run");
  if (runIndex < 0) {
    return null;
  }
  return findManifestForPackageScript(commandTokens[runIndex + 1]);
}

function findManifestForPackageScript(scriptName: any) {
  return findTerminalManifestByScriptName(scriptName);
}

function findManifestForTerminalCommand(commandTokens: any) {
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

function looksLikeCodekseiBinPath(binPath: any) {
  const normalized = normalizeCommandArgument(binPath).replace(/\\/g, "/").toLowerCase();
  return normalized === "./dist/src/index.js"
    || normalized.endsWith("/dist/src/index.js")
    || normalized === "dist/src/index.js";
}

function isShellWrapper(command: any, flag: any) {
  const executable = path.basename(normalizeCommandArgument(command)).toLowerCase();
  return SHELL_EXECUTABLES.has(executable) && flag === "-lc";
}

function matchesBuiltInShellScript(scriptPath: any) {
  const basename = path.basename(normalizeCommandArgument(scriptPath)).toLowerCase();
  return basename === "timeline-screenshot.sh";
}

function splitCommandLine(input: any) {
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

function normalizeCommandArgument(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: any) {
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

export {};
