const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const WINDOWS_CMD_SUFFIX_RE = /\.(cmd|bat)$/i;
const WINDOWS_EXE_SUFFIX_RE = /\.(exe|com)$/i;
const WINDOWS_COMMAND_SUFFIXES = [".cmd", ".exe", ".bat", ".com"];

function normalizeCommandText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "";
  }
  if (
    (normalized.startsWith("\"") && normalized.endsWith("\""))
    || (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function resolveExistingWindowsCommandCandidate(command, { existsSyncImpl = fs.existsSync } = {}) {
  const normalized = normalizeCommandText(command);
  if (!normalized) {
    return "";
  }
  if (existsSyncImpl(normalized)) {
    return normalized;
  }
  const ext = path.extname(normalized).toLowerCase();
  if (ext) {
    return "";
  }
  for (const suffix of WINDOWS_COMMAND_SUFFIXES) {
    const candidate = `${normalized}${suffix}`;
    if (existsSyncImpl(candidate)) {
      return candidate;
    }
  }
  return "";
}

function resolveSpawnCommand(command, {
  platform = process.platform,
  execFileSyncImpl = execFileSync,
  existsSyncImpl = fs.existsSync,
} = {}) {
  const normalized = normalizeCommandText(command);
  if (!normalized || platform !== "win32") {
    return normalized;
  }

  if (path.isAbsolute(normalized) || normalized.includes("\\") || normalized.includes("/")) {
    return resolveExistingWindowsCommandCandidate(normalized, { existsSyncImpl }) || normalized;
  }

  try {
    const output = execFileSyncImpl("where.exe", [normalized], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const candidates = output
      .split(/\r?\n/)
      .map((line) => normalizeCommandText(line))
      .filter(Boolean);
    const preferred = candidates.find(isPreferredWindowsCmdShim)
      || candidates.find((candidate) => WINDOWS_EXE_SUFFIX_RE.test(candidate) && !isWindowsAppsPath(candidate))
      || candidates.find((candidate) => WINDOWS_CMD_SUFFIX_RE.test(candidate))
      || candidates.find((candidate) => WINDOWS_EXE_SUFFIX_RE.test(candidate))
      || candidates[0];
    return preferred || normalized;
  } catch {
    return normalized;
  }
}

function isPreferredWindowsCmdShim(candidate) {
  const normalized = normalizeCommandText(candidate).toLowerCase();
  return WINDOWS_CMD_SUFFIX_RE.test(normalized) && normalized.includes("\\appdata\\roaming\\npm\\");
}

function isWindowsAppsPath(candidate) {
  return normalizeCommandText(candidate).toLowerCase().includes("\\windowsapps\\");
}

function quoteWindowsCmdArg(value) {
  const text = String(value ?? "");
  if (!text.length) {
    return "\"\"";
  }
  if (!/[\s"]/u.test(text)) {
    return text;
  }
  const escaped = text.replace(/(\\*)"/g, "$1$1\\\"");
  return `"${escaped.replace(/(\\+)$/g, "$1$1")}"`;
}

function buildSpawnInvocation(command, args = [], options = {}) {
  const platform = options.platform || process.platform;
  const resolvedCommand = resolveSpawnCommand(command, {
    platform,
    execFileSyncImpl: options.execFileSyncImpl || execFileSync,
    existsSyncImpl: options.existsSyncImpl || fs.existsSync,
  });
  if (platform === "win32" && WINDOWS_CMD_SUFFIX_RE.test(resolvedCommand)) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", [resolvedCommand, ...args].map(quoteWindowsCmdArg).join(" ")],
    };
  }
  return {
    command: resolvedCommand || normalizeCommandText(command),
    args,
  };
}

function resolveCodexTargetTriple({ platform = process.platform, arch = process.arch } = {}) {
  if (platform !== "win32") {
    return "";
  }
  if (arch === "x64") {
    return "x86_64-pc-windows-msvc";
  }
  if (arch === "arm64") {
    return "aarch64-pc-windows-msvc";
  }
  return "";
}

function resolveCodexPlatformPackageName({ platform = process.platform, arch = process.arch } = {}) {
  if (platform !== "win32") {
    return "";
  }
  if (arch === "x64") {
    return "codex-win32-x64";
  }
  if (arch === "arm64") {
    return "codex-win32-arm64";
  }
  return "";
}

function resolveBundledCodexBinary(command, {
  platform = process.platform,
  arch = process.arch,
  execFileSyncImpl = execFileSync,
  existsSyncImpl = fs.existsSync,
} = {}) {
  if (platform !== "win32") {
    return "";
  }
  const resolvedCommand = resolveSpawnCommand(command, {
    platform,
    execFileSyncImpl,
    existsSyncImpl,
  });
  const normalizedResolved = normalizeCommandText(resolvedCommand).toLowerCase();
  if (
    !normalizedResolved
    || (!normalizedResolved.endsWith("\\codex.cmd")
      && !normalizedResolved.endsWith("\\codex")
      && normalizedResolved !== "codex")
  ) {
    return "";
  }

  const npmRoot = normalizedResolved.includes("\\appdata\\roaming\\npm\\")
    ? path.dirname(resolvedCommand)
    : "";
  const targetTriple = resolveCodexTargetTriple({ platform, arch });
  const platformPackage = resolveCodexPlatformPackageName({ platform, arch });
  if (!npmRoot || !targetTriple || !platformPackage) {
    return "";
  }

  const candidate = path.join(
    npmRoot,
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    platformPackage,
    "vendor",
    targetTriple,
    "codex",
    "codex.exe"
  );
  return existsSyncImpl(candidate) ? candidate : "";
}

module.exports = {
  buildSpawnInvocation,
  normalizeCommandText,
  quoteWindowsCmdArg,
  resolveBundledCodexBinary,
  resolveSpawnCommand,
};
