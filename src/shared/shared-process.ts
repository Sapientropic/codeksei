import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import * as brandingModule from "../core/branding";
import * as envLoaderModule from "../core/env-loader";
import {
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
  writeTextFileAtomically,
} from "../state/json-state";
import * as sharedBridgeHeartbeatModule from "./shared-bridge-heartbeat";
import * as codexSpawnModule from "../core/codex-spawn";
import { resolvePackageRoot } from "../core/path-utils";

const {
  ensureStateDirectory,
  readPrefixedBoolEnv,
  readPrefixedEnv,
  resolveStateDir,
} = brandingModule as {
  ensureStateDirectory: (args: { env: NodeJS.ProcessEnv }) => void;
  readPrefixedBoolEnv: (env: NodeJS.ProcessEnv, key: string, fallback?: boolean) => boolean;
  readPrefixedEnv: (env: NodeJS.ProcessEnv, key: string) => string;
  resolveStateDir: (args: { env: NodeJS.ProcessEnv }) => string;
};
const { loadEnvStack } = envLoaderModule as {
  loadEnvStack: (args: { cwd: string; env: NodeJS.ProcessEnv }) => void;
};
const {
  DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS,
} = sharedBridgeHeartbeatModule as {
  DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS: number;
};
const { buildSpawnInvocation } = codexSpawnModule as {
  buildSpawnInvocation: (command: string, args: string[]) => { command: string; args: string[] };
};

const rootDir = resolvePackageRoot(__dirname);
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
const BRIDGE_HEARTBEAT_MAX_AGE_MS = Number.parseInt(
  String(readPrefixedEnv(process.env, "SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS") || ""),
  10,
) || DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS;
const SHARED_USE_BUNDLED_CODEX_BINARY = readPrefixedBoolEnv(
  process.env,
  "SHARED_USE_BUNDLED_CODEX_BINARY",
  true,
);
const SHARED_DISABLE_PLUGINS = readPrefixedBoolEnv(
  process.env,
  "SHARED_DISABLE_PLUGINS",
  false,
);
const SHARED_DISABLE_SHELL_SNAPSHOT = readPrefixedBoolEnv(
  process.env,
  "SHARED_DISABLE_SHELL_SNAPSHOT",
  false,
);

function loadSharedEnv() {
  loadEnvStack({ cwd: rootDir, env: process.env });
  ensureStateDirectory({ env: process.env });
}

function ensureLogDir() {
  fs.mkdirSync(logDir, { recursive: true });
}

function isPidAlive(pid: unknown): boolean {
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

function readPidFile(filePath: unknown): number {
  try {
    const raw = fs.readFileSync(String(filePath || ""), "utf8").trim();
    return raw ? Number.parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function writePidFile(filePath: string, pid: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeTextFileAtomically(filePath, `${pid}\n`, { encoding: "utf8" });
}

function removePidFileIfMatches(filePath: string, pid: unknown): void {
  const current = readPidFile(filePath);
  if (current && current === Number(pid)) {
    fs.rmSync(filePath, { force: true });
  }
}

function readJsonFile(filePath: string): unknown {
  return readManagedJsonStateFile({
    filePath,
    fallback: null,
    label: "shared state",
  });
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeManagedJsonStateFile(filePath, payload);
}

function findListeningPidByPort(targetPort: unknown): number {
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
        if (String(state).toUpperCase() !== "LISTENING") {
          continue;
        }
        if (!String(localAddress).endsWith(`:${normalizedPort}`)) {
          continue;
        }
        const pid = Number.parseInt(String(pidText || ""), 10);
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

function checkReadyz(): Promise<boolean> {
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
        resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300));
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function resolveReadyAppServerPid(): Promise<number> {
  if (!(await checkReadyz())) {
    return 0;
  }

  const pidFromFile = readPidFile(appServerPidFile);
  // On Windows a detached shell launch can leave the pid file pointing at the
  // wrapper cmd.exe instead of the real listener. Prefer the actual listening
  // pid whenever readyz is healthy, then backfill the pid file.
  const listenerPid = findListeningPidByPort(port);
  if (listenerPid) {
    if (listenerPid !== pidFromFile) {
      writePidFile(appServerPidFile, listenerPid);
    }
    return listenerPid;
  }

  return pidFromFile && isPidAlive(pidFromFile) ? pidFromFile : 0;
}

async function waitForReadyz({ attempts = 10, delayMs = 300 }: { attempts?: unknown; delayMs?: unknown } = {}): Promise<boolean> {
  const normalizedAttempts = numberOrDefault(attempts, 10);
  const normalizedDelayMs = numberOrDefault(delayMs, 300);
  for (let index = 0; index < normalizedAttempts; index += 1) {
    if (await checkReadyz()) {
      return true;
    }
    await sleep(normalizedDelayMs);
  }
  return false;
}

function openLogFile(filePath: string): number {
  return fs.openSync(filePath, "a");
}

interface SpawnDetachedCommandDependencies {
  buildSpawnInvocation: (command: string, args: string[]) => { command: string; args: string[] };
  closeFd: (fd: number) => void;
  openLogFile: (filePath: string) => number;
  spawn: (
    command: string,
    args: string[],
    options: { stdio: [string, number, number] } & Record<string, unknown>,
  ) => { pid?: number; unref: () => void };
}

const DEFAULT_SPAWN_DETACHED_DEPS: SpawnDetachedCommandDependencies = {
  buildSpawnInvocation,
  closeFd: (fd) => fs.closeSync(fd),
  openLogFile,
  spawn: (command, args, options) => spawn(command, args, options as never),
};

function safeCloseFd(fd: number, closeFd: (fd: number) => void) {
  if (!Number.isInteger(fd) || fd < 0) {
    return;
  }
  try {
    closeFd(fd);
  } catch {}
}

function spawnDetachedCommand(
  command: string,
  args: string[],
  {
    logFile,
    cwd = rootDir,
    env = {},
  }: { logFile?: string; cwd?: string; env?: Record<string, string> } = {},
  {
    buildSpawnInvocation: buildSpawnInvocationImpl = buildSpawnInvocation,
    closeFd = DEFAULT_SPAWN_DETACHED_DEPS.closeFd,
    openLogFile: openLogFileImpl = openLogFile,
    spawn: spawnImpl = DEFAULT_SPAWN_DETACHED_DEPS.spawn,
  }: Partial<SpawnDetachedCommandDependencies> = {},
): number {
  if (!logFile) {
    throw new Error("spawnDetachedCommand requires logFile");
  }
  let stdoutFd = -1;
  let stderrFd = -1;

  try {
    stdoutFd = openLogFileImpl(logFile);
    stderrFd = openLogFileImpl(logFile);
    const spawnSpec = buildSpawnInvocationImpl(command, args);
    const child = spawnImpl(spawnSpec.command, spawnSpec.args, {
      cwd,
      env: { ...process.env, ...env },
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      shell: false,
      windowsHide: true,
    });
    child.unref();
    return Number(child.pid || 0);
  } finally {
    // The detached child inherits duplicated handles during spawn. The parent
    // must always close its own copies immediately so repeated supervisor
    // restarts do not leak log fds in the long-lived desktop session.
    safeCloseFd(stdoutFd, closeFd);
    safeCloseFd(stderrFd, closeFd);
  }
}

function readProcessCommandLine(pid: unknown): string {
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

function commandLineMatchesAll(commandLine: unknown, expectedSubstrings: unknown[] = []): boolean {
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

async function stopManagedProcess(
  filePath: string,
  {
    expectedSubstrings = [],
    label = "managed process",
  }: { expectedSubstrings?: unknown[]; label?: string } = {},
): Promise<{ pid: number; status: string; commandLine: string }> {
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

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms: unknown): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, numberOrDefault(ms, 0)));
}

function numberOrDefault(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export {
  BRIDGE_HEARTBEAT_MAX_AGE_MS,
  SHARED_DISABLE_PLUGINS,
  SHARED_DISABLE_SHELL_SNAPSHOT,
  SHARED_USE_BUNDLED_CODEX_BINARY,
  accountsDir,
  appServerLogFile,
  appServerPidFile,
  bridgeHeartbeatFile,
  bridgeLogFile,
  bridgePidFile,
  buildSpawnInvocation,
  ensureLogDir,
  isPidAlive,
  listenUrl,
  logDir,
  port,
  readJsonFile,
  readPidFile,
  readProcessCommandLine,
  removePidFileIfMatches,
  resolveReadyAppServerPid,
  rootDir,
  sessionFile,
  sleep,
  spawnDetachedCommand,
  stateDir,
  stopManagedProcess,
  supervisorLogFile,
  supervisorPidFile,
  waitForReadyz,
  watchdogStateFile,
  writeJsonFile,
  writePidFile,
};
