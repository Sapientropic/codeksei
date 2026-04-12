const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const {
  APP_NAME,
  PACKAGE_NAME,
  ensureStateDirectory,
  readPrefixedBoolEnv,
  readPrefixedEnv,
  resolveStateDir,
} = require("../src/core/branding");
const { loadEnvStack } = require("../src/core/env-loader");
const {
  readManagedJsonStateFile,
  writeTextFileAtomically,
  writeManagedJsonStateFile,
} = require("../src/core/json-state");
const { loadWeixinAccount } = require("../src/adapters/channel/weixin/account-store");
const { SessionStore } = require("../src/adapters/runtime/codex/session-store");
const {
  DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS,
  classifySharedBridgeHeartbeat,
  readSharedBridgeHeartbeat,
} = require("../src/core/shared-bridge-heartbeat");

const rootDir = path.resolve(__dirname, "..");
loadSharedEnv();
const port = String(readPrefixedEnv(process.env, "SHARED_PORT") || "8765");
const listenUrl = `ws://127.0.0.1:${port}`;
const stateDir = resolveStateDir({ env: process.env });
const logDir = path.join(stateDir, "logs");
const appServerPidFile = path.join(logDir, "shared-app-server.pid");
const bridgePidFile = path.join(logDir, "shared-wechat.pid");
const supervisorPidFile = path.join(logDir, "shared-supervisor.pid");
const appServerLogFile = path.join(logDir, "shared-app-server.log");
const bridgeLogFile = path.join(logDir, "shared-wechat.log");
const supervisorLogFile = path.join(logDir, "shared-supervisor.log");
const bridgeHeartbeatFile = path.join(logDir, "shared-wechat-heartbeat.json");
const watchdogStateFile = path.join(logDir, "shared-watchdog-state.json");
const accountsDir = path.join(stateDir, "accounts");
const sessionFile = readPrefixedEnv(process.env, "SESSIONS_FILE") || path.join(stateDir, "sessions.json");
const WINDOWS_CMD_SUFFIX_RE = /\.(cmd|bat)$/i;
const WINDOWS_EXE_SUFFIX_RE = /\.(exe|com)$/i;
const BRIDGE_HEARTBEAT_MAX_AGE_MS = Number.parseInt(
  String(readPrefixedEnv(process.env, "SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS") || ""),
  10
) || DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS;
const SHARED_USE_BUNDLED_CODEX_BINARY = readPrefixedBoolEnv(
  process.env,
  "SHARED_USE_BUNDLED_CODEX_BINARY",
  true
);
const SHARED_DISABLE_PLUGINS = readPrefixedBoolEnv(
  process.env,
  "SHARED_DISABLE_PLUGINS",
  false
);
const SHARED_DISABLE_SHELL_SNAPSHOT = readPrefixedBoolEnv(
  process.env,
  "SHARED_DISABLE_SHELL_SNAPSHOT",
  false
);

function loadSharedEnv() {
  loadEnvStack({ cwd: rootDir, env: process.env });
  ensureStateDirectory({ env: process.env });
}

function ensureLogDir() {
  fs.mkdirSync(logDir, { recursive: true });
}

function isPidAlive(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return false;
  }
  try {
    process.kill(numeric, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    return raw ? Number.parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function writePidFile(filePath, pid) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeTextFileAtomically(filePath, `${pid}\n`, { encoding: "utf8" });
}

function removePidFileIfMatches(filePath, pid) {
  const current = readPidFile(filePath);
  if (current && current === pid) {
    fs.rmSync(filePath, { force: true });
  }
}

function readJsonFile(filePath) {
  return readManagedJsonStateFile({
    filePath,
    fallback: null,
    label: "shared state",
  });
}

function writeJsonFile(filePath, payload) {
  writeManagedJsonStateFile(filePath, payload);
}

function findListeningPidByPort(targetPort) {
  const normalizedPort = Number(targetPort);
  if (!Number.isInteger(normalizedPort) || normalizedPort <= 0) {
    return 0;
  }
  try {
    if (process.platform === "win32") {
      const output = execFileSync("netstat", ["-ano", "-p", "tcp"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !line.startsWith("TCP")) {
          continue;
        }
        const parts = line.split(/\s+/);
        if (parts.length < 5) {
          continue;
        }
        const [, localAddress, , state, pidText] = parts;
        if (state.toUpperCase() !== "LISTENING") {
          continue;
        }
        if (!localAddress.endsWith(`:${normalizedPort}`)) {
          continue;
        }
        const pid = Number.parseInt(pidText, 10);
        return isPidAlive(pid) ? pid : 0;
      }
      return 0;
    }

    const output = execFileSync("lsof", [`-nPiTCP:${normalizedPort}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pid = Number.parseInt(output.trim().split(/\r?\n/)[0] || "", 10);
    return isPidAlive(pid) ? pid : 0;
  } catch {
    return 0;
  }
}

function checkReadyz() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: Number(port),
        path: "/readyz",
        timeout: 500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function resolveReadyAppServerPid() {
  if (!(await checkReadyz())) {
    return 0;
  }

  const pidFromFile = readPidFile(appServerPidFile);
  // On Windows a detached shell launch can leave the pid file pointing at the
  // wrapper cmd.exe instead of the real codex.exe listener. Prefer the actual
  // listening pid whenever readyz is healthy, then backfill the pid file.
  const listenerPid = findListeningPidByPort(port);
  if (listenerPid) {
    if (listenerPid !== pidFromFile) {
      writePidFile(appServerPidFile, listenerPid);
    }
    return listenerPid;
  }

  return pidFromFile && isPidAlive(pidFromFile) ? pidFromFile : 0;
}

async function waitForReadyz({ attempts = 10, delayMs = 300 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    if (await checkReadyz()) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

function openLogFile(filePath) {
  return fs.openSync(filePath, "a");
}

function resolveSpawnCommand(command) {
  const normalized = normalizeText(command);
  if (!normalized || process.platform !== "win32") {
    return normalized || command;
  }
  if (path.isAbsolute(normalized) && fs.existsSync(normalized)) {
    return normalized;
  }
  try {
    const output = execFileSync("where.exe", [normalized], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const candidates = output
      .split(/\r?\n/)
      .map((line) => line.trim())
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
  const normalized = String(candidate || "").trim().toLowerCase();
  return WINDOWS_CMD_SUFFIX_RE.test(normalized) && normalized.includes("\\appdata\\roaming\\npm\\");
}

function isWindowsAppsPath(candidate) {
  return String(candidate || "").trim().toLowerCase().includes("\\windowsapps\\");
}

function resolveCodexTargetTriple() {
  if (process.platform !== "win32") {
    return "";
  }
  if (process.arch === "x64") {
    return "x86_64-pc-windows-msvc";
  }
  if (process.arch === "arm64") {
    return "aarch64-pc-windows-msvc";
  }
  return "";
}

function resolveCodexPlatformPackageName() {
  if (process.platform !== "win32") {
    return "";
  }
  if (process.arch === "x64") {
    return "codex-win32-x64";
  }
  if (process.arch === "arm64") {
    return "codex-win32-arm64";
  }
  return "";
}

function resolveBundledCodexBinary(command) {
  if (process.platform !== "win32") {
    return "";
  }
  const resolvedCommand = resolveSpawnCommand(command);
  const normalizedResolved = normalizeText(resolvedCommand).toLowerCase();
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
  const targetTriple = resolveCodexTargetTriple();
  const platformPackage = resolveCodexPlatformPackageName();
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
  return fs.existsSync(candidate) ? candidate : "";
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

function buildSpawnInvocation(command, args = []) {
  const resolvedCommand = resolveSpawnCommand(command);
  if (process.platform === "win32" && WINDOWS_CMD_SUFFIX_RE.test(resolvedCommand)) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", [resolvedCommand, ...args].map(quoteWindowsCmdArg).join(" ")],
    };
  }
  return {
    command: resolvedCommand,
    args,
  };
}

function spawnDetachedCommand(command, args, { logFile, cwd = rootDir, env = {} } = {}) {
  const stdoutFd = openLogFile(logFile);
  const stderrFd = openLogFile(logFile);
  const spawnSpec = buildSpawnInvocation(command, args);
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    shell: false,
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

function readProcessCommandLine(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return "";
  }
  try {
    if (process.platform === "win32") {
      return execFileSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${numeric}" | Select-Object -ExpandProperty CommandLine`,
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trim();
    }
    return execFileSync("ps", ["-p", String(numeric), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function commandLineMatchesAll(commandLine, expectedSubstrings = []) {
  const normalizedCommandLine = normalizeText(commandLine).toLowerCase();
  const normalizedPatterns = expectedSubstrings
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean);
  if (!normalizedPatterns.length) {
    return true;
  }
  if (!normalizedCommandLine) {
    return false;
  }
  return normalizedPatterns.every((pattern) => normalizedCommandLine.includes(pattern));
}

async function stopManagedProcess(filePath, { expectedSubstrings = [], label = "managed process" } = {}) {
  const pid = readPidFile(filePath);
  if (!pid) {
    return { pid: 0, status: "missing", commandLine: "" };
  }
  if (!isPidAlive(pid)) {
    fs.rmSync(filePath, { force: true });
    return { pid, status: "stale", commandLine: "" };
  }

  const commandLine = readProcessCommandLine(pid);
  // Only terminate processes we can positively attribute to this shared stack.
  // PID reuse on a long-lived desktop session is real, so a naked "kill pidfile"
  // would eventually hit an unrelated process.
  if (!commandLineMatchesAll(commandLine, expectedSubstrings)) {
    return { pid, status: "unexpected_command", commandLine };
  }

  try {
    process.kill(pid);
  } catch {}

  for (let index = 0; index < 10; index += 1) {
    if (!isPidAlive(pid)) {
      fs.rmSync(filePath, { force: true });
      return { pid, status: "terminated", commandLine };
    }
    await sleep(200);
  }

  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {}

  for (let index = 0; index < 10; index += 1) {
    if (!isPidAlive(pid)) {
      fs.rmSync(filePath, { force: true });
      return { pid, status: "terminated", commandLine };
    }
    await sleep(200);
  }

  throw new Error(`failed to stop ${label} pid=${pid}`);
}

function readSharedBridgeHealth() {
  const pid = readPidFile(bridgePidFile);
  const alive = pid ? isPidAlive(pid) : false;
  const heartbeat = readSharedBridgeHeartbeat(bridgeHeartbeatFile);
  const classification = classifySharedBridgeHeartbeat(heartbeat, {
    expectedPid: alive ? pid : 0,
    maxAgeMs: BRIDGE_HEARTBEAT_MAX_AGE_MS,
  });
  return {
    pid,
    alive,
    heartbeat,
    classification,
    healthy: Boolean(pid && alive && classification.healthy),
  };
}

async function waitForSharedBridgeHealthy({ attempts = 30, delayMs = 1000 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    const health = readSharedBridgeHealth();
    if (health.healthy) {
      return health;
    }
    await sleep(delayMs);
  }
  return null;
}

function startSharedBridge() {
  const pid = spawnDetachedCommand(process.execPath, ["./bin/codeksei.js", "start", "--checkin"], {
    logFile: bridgeLogFile,
    cwd: rootDir,
    env: {
      CODEKSEI_CODEX_ENDPOINT: listenUrl,
      CYBERBOSS_CODEX_ENDPOINT: listenUrl,
    },
  });
  writePidFile(bridgePidFile, pid);
  return pid;
}

function startSharedSupervisor({ intervalMinutes = 5 } = {}) {
  const args = ["./scripts/shared-supervisor.js", `--interval-minutes=${intervalMinutes}`];
  const pid = spawnDetachedCommand(process.execPath, args, {
    logFile: supervisorLogFile,
    cwd: rootDir,
  });
  writePidFile(supervisorPidFile, pid);
  return pid;
}

async function ensureSharedAppServer() {
  ensureLogDir();
  const readyPid = await resolveReadyAppServerPid();
  if (readyPid) {
    return { pid: readyPid, status: "already_running" };
  }

  const env = {
    CODEKSEI_STATE_DIR: stateDir,
    CYBERBOSS_STATE_DIR: stateDir,
    TIMELINE_FOR_AGENT_STATE_DIR: stateDir,
  };
  if (!process.env.TIMELINE_FOR_AGENT_CHROME_PATH) {
    env.TIMELINE_FOR_AGENT_CHROME_PATH =
      readPrefixedEnv(process.env, "SCREENSHOT_CHROME_PATH")
      || (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "");
  }

  const command = readPrefixedEnv(process.env, "CODEX_COMMAND") || "codex";
  // Some Windows setups behave better when the shared app-server is launched
  // through the npm codex.cmd shim, because later shell_command children can
  // inherit that console environment instead of spawning a fresh visible one.
  // Keep the direct codex.exe path as an opt-in/opt-out switch so we can A/B
  // detached startup behavior without rewriting the shared lifecycle.
  const detachedCommand = SHARED_USE_BUNDLED_CODEX_BINARY
    ? (resolveBundledCodexBinary(command) || command)
    : command;
  const appServerArgs = ["app-server", "--listen", listenUrl];
  // The shared WeChat bridge does not rely on Desktop-only curated plugins, so
  // allow callers to disable plugin loading for this detached runtime. That
  // avoids noisy startup sync/cache warnings without changing the user's global
  // Codex Desktop plugin setup.
  if (SHARED_DISABLE_PLUGINS) {
    appServerArgs.push("--disable", "plugins");
  }
  // PowerShell shell snapshots are not supported upstream today. Disabling the
  // feature for the shared runtime only suppresses the startup warning; normal
  // shell command execution still works.
  if (SHARED_DISABLE_SHELL_SNAPSHOT) {
    appServerArgs.push("--disable", "shell_snapshot");
  }

  const pid = spawnDetachedCommand(detachedCommand, appServerArgs, {
    logFile: appServerLogFile,
    env,
  });
  writePidFile(appServerPidFile, pid);

  const ready = await waitForReadyz();
  if (!ready) {
    throw new Error(`failed to start shared app-server; check ${appServerLogFile}`);
  }

  const adoptedPid = await resolveReadyAppServerPid();
  return {
    pid: adoptedPid || pid,
    status: adoptedPid && adoptedPid !== pid ? "started_adopted" : "started",
  };
}

async function ensureManagedAppServer({ restartUnhealthy = false } = {}) {
  const readyPid = await resolveReadyAppServerPid();
  if (readyPid) {
    return { pid: readyPid, status: "already_running" };
  }

  let recovered = false;
  if (restartUnhealthy && readPidFile(appServerPidFile)) {
    const stopped = await stopManagedProcess(appServerPidFile, {
      expectedSubstrings: ["codex", "app-server"],
      label: "shared app-server",
    });
    if (stopped.status === "unexpected_command") {
      throw new Error(`refusing to stop shared app-server pid=${stopped.pid}: unexpected command line`);
    }
    recovered = stopped.status === "terminated";
  }

  const started = await ensureSharedAppServer();
  return {
    ...started,
    status: recovered ? "restarted" : started.status,
  };
}

function ensureBridgeNotRunning() {
  const pidFromFile = readPidFile(bridgePidFile);
  if (pidFromFile && isPidAlive(pidFromFile)) {
    return pidFromFile;
  }
  if (pidFromFile) {
    fs.rmSync(bridgePidFile, { force: true });
  }
  return 0;
}

async function ensureManagedBridge({ restartUnhealthy = false } = {}) {
  ensureLogDir();
  const health = readSharedBridgeHealth();
  if (health.healthy) {
    return { pid: health.pid, status: "already_running", health };
  }

  if (health.pid && health.alive) {
    const warmed = await waitForSharedBridgeHealthy({ attempts: 5, delayMs: 1000 });
    if (warmed) {
      return { pid: warmed.pid, status: "already_running", health: warmed };
    }
  }

  let recovered = false;
  if (restartUnhealthy && health.pid) {
    const stopped = await stopManagedProcess(bridgePidFile, {
      expectedSubstrings: ["start", "checkin"],
      label: "shared codeksei bridge",
    });
    if (stopped.status === "unexpected_command") {
      throw new Error(`refusing to stop shared codeksei bridge pid=${stopped.pid}: unexpected command line`);
    }
    recovered = stopped.status === "terminated";
  } else if (health.pid && !health.alive) {
    fs.rmSync(bridgePidFile, { force: true });
  }

  const pid = startSharedBridge();
  const readyHealth = await waitForSharedBridgeHealthy();
  if (!readyHealth) {
    throw new Error(`failed to start shared codeksei bridge; check ${bridgeLogFile}`);
  }
  return {
    pid: readyHealth.pid || pid,
    status: recovered ? "restarted" : "started",
    health: readyHealth,
  };
}

async function ensureManagedSupervisor({ intervalMinutes = 5 } = {}) {
  ensureLogDir();
  const pid = readPidFile(supervisorPidFile);
  if (pid && isPidAlive(pid)) {
    const commandLine = readProcessCommandLine(pid);
    if (!commandLineMatchesAll(commandLine, ["shared-supervisor.js"])) {
      throw new Error(`refusing to adopt shared supervisor pid=${pid}: unexpected command line`);
    }
    return { pid, status: "already_running" };
  }
  if (pid) {
    fs.rmSync(supervisorPidFile, { force: true });
  }

  const startedPid = startSharedSupervisor({ intervalMinutes });
  await sleep(300);
  return {
    pid: readPidFile(supervisorPidFile) || startedPid,
    status: "started",
  };
}

function resolveCurrentAccountId() {
  if (!fs.existsSync(accountsDir)) {
    return "";
  }
  const accountsConfig = {
    accountsDir,
    weixinBaseUrl: "",
    weixinRouteTag: "",
  };
  const entries = fs.readdirSync(accountsDir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".context-tokens.json"))
    .map((name) => loadWeixinAccount(accountsConfig, name.slice(0, -5)))
    .map((account) => account ? {
      accountId: normalizeText(account.accountId),
      savedAt: parseTimestamp(account.savedAt),
    } : null)
    .filter(Boolean)
    .filter((entry) => entry.accountId);
  entries.sort((left, right) => right.savedAt - left.savedAt);
  return entries[0]?.accountId || "";
}

function resolveBoundThread(workspaceRoot) {
  if (!fs.existsSync(sessionFile)) {
    throw new Error(`session file not found: ${sessionFile}`);
  }
  const sessionStore = new SessionStore({ filePath: sessionFile });
  const currentAccountId = resolveCurrentAccountId();
  const bindings = sessionStore.listBindings()
    .filter((binding) => !currentAccountId || normalizeText(binding?.accountId) === currentAccountId)
    .sort((left, right) => parseTimestamp(right?.updatedAt) - parseTimestamp(left?.updatedAt));

  const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
  const exact = bindings.find((binding) => getThreadId(binding, normalizedWorkspaceRoot));
  if (exact) {
    return {
      threadId: getThreadId(exact, normalizedWorkspaceRoot),
      workspaceRoot: normalizedWorkspaceRoot,
    };
  }

  const active = bindings.find((binding) => {
    const activeWorkspaceRoot = normalizeText(binding?.activeWorkspaceRoot);
    return activeWorkspaceRoot && getThreadId(binding, activeWorkspaceRoot);
  });
  if (active) {
    const activeWorkspaceRoot = normalizeText(active.activeWorkspaceRoot);
    return {
      threadId: getThreadId(active, activeWorkspaceRoot),
      workspaceRoot: activeWorkspaceRoot,
    };
  }

  throw new Error(`no bound WeChat thread found for workspace: ${workspaceRoot}`);
}

function getThreadId(binding, workspaceRoot) {
  if (!workspaceRoot) {
    return "";
  }
  const map = binding && typeof binding.threadIdByWorkspaceRoot === "object"
    ? binding.threadIdByWorkspaceRoot
    : {};
  return normalizeText(map[workspaceRoot]);
}

function parseTimestamp(value) {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  rootDir,
  port,
  listenUrl,
  stateDir,
  logDir,
  appServerPidFile,
  bridgePidFile,
  supervisorPidFile,
  appServerLogFile,
  bridgeLogFile,
  supervisorLogFile,
  bridgeHeartbeatFile,
  watchdogStateFile,
  BRIDGE_HEARTBEAT_MAX_AGE_MS,
  ensureLogDir,
  isPidAlive,
  readPidFile,
  writePidFile,
  readJsonFile,
  writeJsonFile,
  removePidFileIfMatches,
  buildSpawnInvocation,
  spawnDetachedCommand,
  readProcessCommandLine,
  stopManagedProcess,
  readSharedBridgeHealth,
  waitForSharedBridgeHealthy,
  startSharedBridge,
  startSharedSupervisor,
  resolveReadyAppServerPid,
  ensureSharedAppServer,
  ensureManagedAppServer,
  ensureBridgeNotRunning,
  ensureManagedBridge,
  ensureManagedSupervisor,
  resolveBoundThread,
};
