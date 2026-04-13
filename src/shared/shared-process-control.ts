import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import { buildSpawnInvocation } from "../core/codex-spawn";
import {
  resolveSharedProcessContext,
  type SharedProcessContext,
} from "./shared-process-context";
import {
  isPidAlive,
  readPidFile,
  writePidFile,
} from "./shared-process-state";
import type { ManagedStopResult } from "./shared-types";

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
        const localAddress = parts[1];
        const state = parts[3];
        const pidText = parts[4];
        if (!localAddress || !state || !pidText) {
          continue;
        }
        if (String(state).toUpperCase() !== "LISTENING") {
          continue;
        }
        if (!String(localAddress).endsWith(`:${normalizedPort}`)) {
          continue;
        }
        const pid = Number.parseInt(String(pidText), 10);
        return isPidAlive(pid) ? pid : 0;
      }
      return 0;
    }

    const output = execFileSync("lsof", [`-nPiTCP:${normalizedPort}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const firstLine = output.trim().split(/\r?\n/)[0] || "";
    const pid = Number.parseInt(firstLine, 10);
    return isPidAlive(pid) ? pid : 0;
  } catch {
    return 0;
  }
}

function checkReadyz(context: SharedProcessContext = resolveSharedProcessContext()): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: Number(context.port),
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

async function resolveReadyAppServerPid(context: SharedProcessContext = resolveSharedProcessContext()): Promise<number> {
  if (!(await checkReadyz(context))) {
    return 0;
  }

  const pidFromFile = readPidFile(context.appServerPidFile);
  // On Windows a detached shell launch can leave the pid file pointing at the
  // wrapper cmd.exe instead of the real listener. Prefer the actual listening
  // pid whenever readyz is healthy, then backfill the pid file.
  const listenerPid = findListeningPidByPort(context.port);
  if (listenerPid) {
    if (listenerPid !== pidFromFile) {
      writePidFile(context.appServerPidFile, listenerPid);
    }
    return listenerPid;
  }

  return pidFromFile && isPidAlive(pidFromFile) ? pidFromFile : 0;
}

async function waitForReadyz({
  context = resolveSharedProcessContext(),
  attempts = 10,
  delayMs = 300,
}: {
  context?: SharedProcessContext;
  attempts?: unknown;
  delayMs?: unknown;
} = {}): Promise<boolean> {
  const normalizedAttempts = numberOrDefault(attempts, 10);
  const normalizedDelayMs = numberOrDefault(delayMs, 300);
  for (let index = 0; index < normalizedAttempts; index += 1) {
    if (await checkReadyz(context)) {
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
  ) => { pid: number | undefined; unref: () => void };
}

const DEFAULT_SPAWN_DETACHED_DEPS: SpawnDetachedCommandDependencies = {
  buildSpawnInvocation,
  closeFd: (fd) => fs.closeSync(fd),
  openLogFile,
  spawn: (command, args, options) => {
    const child = spawn(command, args, options as never);
    return {
      pid: child.pid,
      unref: () => child.unref(),
    };
  },
};

function safeCloseFd(fd: number, closeFd: (fd: number) => void): void {
  if (!Number.isInteger(fd) || fd < 0) {
    return;
  }
  try {
    closeFd(fd);
  } catch {
    // best effort
  }
}

function spawnDetachedCommand(
  command: string,
  args: string[],
  {
    logFile,
    cwd,
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
  const resolvedCwd = cwd || resolveSharedProcessContext().rootDir;

  try {
    stdoutFd = openLogFileImpl(logFile);
    stderrFd = openLogFileImpl(logFile);
    const spawnSpec = buildSpawnInvocationImpl(command, args);
    const child = spawnImpl(spawnSpec.command, spawnSpec.args, {
      cwd: resolvedCwd,
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
): Promise<ManagedStopResult> {
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
  } catch {
    // best effort
  }

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
  } catch {
    // best effort
  }

  for (let index = 0; index < 10; index += 1) {
    if (!isPidAlive(pid)) {
      fs.rmSync(filePath, { force: true });
      return { pid, status: "terminated", commandLine };
    }
    await sleep(200);
  }

  throw new Error(`failed to stop ${label} pid=${pid}`);
}

function sleep(ms: unknown): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, numberOrDefault(ms, 0)));
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrDefault(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export {
  buildSpawnInvocation,
  checkReadyz,
  readProcessCommandLine,
  resolveReadyAppServerPid,
  sleep,
  spawnDetachedCommand,
  stopManagedProcess,
  waitForReadyz,
};

export type {
  ManagedStopResult,
  SharedProcessContext,
};
