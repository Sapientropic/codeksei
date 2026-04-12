import * as fs from "node:fs";
import * as brandingModule from "../core/branding";
import * as sharedBridgeHeartbeatModule from "./shared-bridge-heartbeat";
import * as codexSpawnModule from "../core/codex-spawn";
import {
  ensureLogDir,
  isPidAlive,
  readPidFile,
  readProcessCommandLine,
  resolveReadyAppServerPid,
  resolveSharedProcessContext,
  type SharedProcessContext,
  sleep,
  spawnDetachedCommand,
  stopManagedProcess,
  waitForReadyz,
  writePidFile,
} from "./shared-process";

const { readPrefixedEnv } = brandingModule as {
  readPrefixedEnv: (env: NodeJS.ProcessEnv, key: string) => string;
};
const {
  classifySharedBridgeHeartbeat,
  readSharedBridgeHeartbeat,
} = sharedBridgeHeartbeatModule as {
  classifySharedBridgeHeartbeat: (
    record: unknown,
    options?: { expectedPid?: number; maxAgeMs?: number },
  ) => { status: string; healthy: boolean; updatedAt: string };
  readSharedBridgeHeartbeat: (filePath: string) => Record<string, unknown> | null;
};
const { resolveBundledCodexBinary } = codexSpawnModule as {
  resolveBundledCodexBinary: (command?: string) => string;
};

interface SharedBridgeHealth {
  pid: number;
  alive: boolean;
  heartbeat: Record<string, unknown> | null;
  classification: {
    status: string;
    healthy: boolean;
    updatedAt: string;
  };
  healthy: boolean;
}

function readSharedBridgeHealth(context: SharedProcessContext = resolveSharedProcessContext()): SharedBridgeHealth {
  const pid = readPidFile(context.bridgePidFile);
  const alive = pid ? isPidAlive(pid) : false;
  const heartbeat = readSharedBridgeHeartbeat(context.bridgeHeartbeatFile);
  const classification = classifySharedBridgeHeartbeat(heartbeat, {
    expectedPid: alive ? pid : 0,
    maxAgeMs: context.bridgeHeartbeatMaxAgeMs,
  });
  return {
    pid,
    alive,
    heartbeat,
    classification,
    healthy: Boolean(pid && alive && classification.healthy),
  };
}

async function waitForSharedBridgeHealthy(
  {
    context = resolveSharedProcessContext(),
    attempts = 30,
    delayMs = 1000,
  }: { context?: SharedProcessContext; attempts?: unknown; delayMs?: unknown } = {},
): Promise<SharedBridgeHealth | null> {
  const normalizedAttempts = Number.isFinite(Number(attempts)) ? Number(attempts) : 30;
  const normalizedDelayMs = Number.isFinite(Number(delayMs)) ? Number(delayMs) : 1000;
  for (let index = 0; index < normalizedAttempts; index += 1) {
    const health = readSharedBridgeHealth(context);
    if (health.healthy) {
      return health;
    }
    await sleep(normalizedDelayMs);
  }
  return null;
}

function startSharedBridge(): number {
  const context = resolveSharedProcessContext();
  const pid = spawnDetachedCommand(process.execPath, ["./dist/src/index.js", "start", "--checkin"], {
    logFile: context.bridgeLogFile,
    cwd: context.rootDir,
    env: {
      CODEKSEI_CODEX_ENDPOINT: context.listenUrl,
    },
  });
  writePidFile(context.bridgePidFile, pid);
  return pid;
}

function startSharedSupervisor({ intervalMinutes = 5 }: { intervalMinutes?: unknown } = {}): number {
  const context = resolveSharedProcessContext();
  const normalizedIntervalMinutes = Number.isFinite(Number(intervalMinutes))
    ? Number(intervalMinutes)
    : 5;
  const args = ["./dist/src/shared/shared-supervisor.js", `--interval-minutes=${normalizedIntervalMinutes}`];
  const pid = spawnDetachedCommand(process.execPath, args, {
    logFile: context.supervisorLogFile,
    cwd: context.rootDir,
  });
  writePidFile(context.supervisorPidFile, pid);
  return pid;
}

async function ensureSharedAppServer(): Promise<{ pid: number; status: string }> {
  const context = resolveSharedProcessContext();
  ensureLogDir(context);
  const readyPid = await resolveReadyAppServerPid(context);
  if (readyPid) {
    return { pid: readyPid, status: "already_running" };
  }

  const env: Record<string, string> = {
    CODEKSEI_STATE_DIR: context.stateDir,
    TIMELINE_FOR_AGENT_STATE_DIR: context.stateDir,
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
  // through the bundled codex.cmd shim, because later shell_command children
  // can inherit that console environment instead of spawning a fresh visible
  // one. Keep the direct codex.exe path as an explicit opt-in/out switch.
  const detachedCommand = context.sharedUseBundledCodexBinary
    ? (resolveBundledCodexBinary(command) || command)
    : command;
  const appServerArgs = ["app-server", "--listen", context.listenUrl];
  if (context.sharedDisablePlugins) {
    appServerArgs.push("--disable", "plugins");
  }
  if (context.sharedDisableShellSnapshot) {
    appServerArgs.push("--disable", "shell_snapshot");
  }

  const pid = spawnDetachedCommand(detachedCommand, appServerArgs, {
    logFile: context.appServerLogFile,
    env,
  });
  writePidFile(context.appServerPidFile, pid);

  const ready = await waitForReadyz({ context });
  if (!ready) {
    throw new Error(`failed to start shared app-server; check ${context.appServerLogFile}`);
  }

  const adoptedPid = await resolveReadyAppServerPid(context);
  return {
    pid: adoptedPid || pid,
    status: adoptedPid && adoptedPid !== pid ? "started_adopted" : "started",
  };
}

async function ensureManagedAppServer(
  { restartUnhealthy = false }: { restartUnhealthy?: unknown } = {},
): Promise<{ pid: number; status: string }> {
  const context = resolveSharedProcessContext();
  const readyPid = await resolveReadyAppServerPid(context);
  if (readyPid) {
    return { pid: readyPid, status: "already_running" };
  }

  let recovered = false;
  if (Boolean(restartUnhealthy) && readPidFile(context.appServerPidFile)) {
    const stopped = await stopManagedProcess(context.appServerPidFile, {
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

function ensureBridgeNotRunning(): number {
  const context = resolveSharedProcessContext();
  const pidFromFile = readPidFile(context.bridgePidFile);
  if (pidFromFile && isPidAlive(pidFromFile)) {
    return pidFromFile;
  }
  if (pidFromFile) {
    fs.rmSync(context.bridgePidFile, { force: true });
  }
  return 0;
}

async function ensureManagedBridge(
  { restartUnhealthy = false }: { restartUnhealthy?: unknown } = {},
): Promise<{ pid: number; status: string; health: SharedBridgeHealth }> {
  const context = resolveSharedProcessContext();
  ensureLogDir(context);
  const health = readSharedBridgeHealth(context);
  if (health.healthy) {
    return { pid: health.pid, status: "already_running", health };
  }

  if (health.pid && health.alive) {
    const warmed = await waitForSharedBridgeHealthy({ context, attempts: 5, delayMs: 1000 });
    if (warmed) {
      return { pid: warmed.pid, status: "already_running", health: warmed };
    }
  }

  let recovered = false;
  if (Boolean(restartUnhealthy) && health.pid) {
    const stopped = await stopManagedProcess(context.bridgePidFile, {
      expectedSubstrings: ["start", "checkin"],
      label: "shared codeksei bridge",
    });
    if (stopped.status === "unexpected_command") {
      throw new Error(`refusing to stop shared codeksei bridge pid=${stopped.pid}: unexpected command line`);
    }
    recovered = stopped.status === "terminated";
  } else if (health.pid && !health.alive) {
    fs.rmSync(context.bridgePidFile, { force: true });
  }

  const pid = startSharedBridge();
  const readyHealth = await waitForSharedBridgeHealthy({ context });
  if (!readyHealth) {
    throw new Error(`failed to start shared codeksei bridge; check ${context.bridgeLogFile}`);
  }
  return {
    pid: readyHealth.pid || pid,
    status: recovered ? "restarted" : "started",
    health: readyHealth,
  };
}

async function ensureManagedSupervisor(
  { intervalMinutes = 5 }: { intervalMinutes?: unknown } = {},
): Promise<{ pid: number; status: string }> {
  const context = resolveSharedProcessContext();
  ensureLogDir(context);
  const pid = readPidFile(context.supervisorPidFile);
  if (pid && isPidAlive(pid)) {
    const commandLine = readProcessCommandLine(pid);
    if (!String(commandLine).toLowerCase().includes("shared-supervisor.js")) {
      throw new Error(`refusing to adopt shared supervisor pid=${pid}: unexpected command line`);
    }
    return { pid, status: "already_running" };
  }
  if (pid) {
    fs.rmSync(context.supervisorPidFile, { force: true });
  }

  const startedPid = startSharedSupervisor({ intervalMinutes });
  await sleep(300);
  return {
    pid: readPidFile(context.supervisorPidFile) || startedPid,
    status: "started",
  };
}

export {
  ensureBridgeNotRunning,
  ensureManagedAppServer,
  ensureManagedBridge,
  ensureManagedSupervisor,
  ensureSharedAppServer,
  readSharedBridgeHealth,
  startSharedBridge,
  startSharedSupervisor,
  waitForSharedBridgeHealthy,
};
