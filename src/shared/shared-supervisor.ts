import * as brandingModule from "../core/branding";
import { runWatchdogOnce } from "./shared-watchdog";
import {
  ensureLogDir,
  isPidAlive,
  readPidFile,
  readProcessCommandLine,
  removePidFileIfMatches,
  resolveSharedProcessContext,
  writePidFile,
} from "./shared-common";

const { readPrefixedEnv } = brandingModule as {
  readPrefixedEnv: (env: NodeJS.ProcessEnv, key: string) => string;
};

const DEFAULT_INTERVAL_MINUTES = 5;

let shuttingDown = false;
let lastLoggedSignature = "";

function parseIntervalMinutes(argv: any) {
  for (const rawArg of argv) {
    if (!rawArg.startsWith("--interval-minutes=")) {
      continue;
    }
    const value = Number.parseInt(rawArg.slice("--interval-minutes=".length), 10);
    if (Number.isInteger(value) && value >= 1) {
      return value;
    }
  }

  const fromEnv = Number.parseInt(
    String(readPrefixedEnv(process.env, "SHARED_WATCHDOG_INTERVAL_MINUTES") || ""),
    10
  );
  if (Number.isInteger(fromEnv) && fromEnv >= 1) {
    return fromEnv;
  }
  return DEFAULT_INTERVAL_MINUTES;
}

function formatErrorMessage(error: any) {
  if (error instanceof Error) {
    return error.message || error.stack || String(error);
  }
  return String(error || "unknown error");
}

function sleep(ms: any) {
  return new Promise((resolve: any) => setTimeout(resolve, ms));
}

function buildStateSignature(state: any) {
  const actions = Array.isArray(state?.actions) ? state.actions.join("|") : "";
  const error = typeof state?.error === "string" ? state.error.trim() : "";
  const readyz = state?.after?.appServer?.ready ? "ok" : "down";
  const heartbeat = state?.after?.bridge?.heartbeatStatus || "missing";
  return [state?.result || "unknown", readyz, heartbeat, actions, error].join("|");
}

function logLine(message: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object";
}

function ensureSingleInstance() {
  const sharedContext = resolveSharedProcessContext();
  const existingPid = readPidFile(sharedContext.supervisorPidFile);
  if (!existingPid || existingPid === process.pid || !isPidAlive(existingPid)) {
    return 0;
  }

  const commandLine = readProcessCommandLine(existingPid);
  if (String(commandLine).toLowerCase().includes("shared-supervisor.js")) {
    return existingPid;
  }
  throw new Error(`refusing to reuse shared supervisor pid=${existingPid}: unexpected command line`);
}

function installSignalHandlers() {
  const sharedContext = resolveSharedProcessContext();
  const shutdown = (signal: any) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logLine(`signal=${signal} shutting_down=true`);
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(signal, () => shutdown(signal));
  }

  process.on("exit", () => {
    removePidFileIfMatches(sharedContext.supervisorPidFile, process.pid);
  });
}

async function main() {
  const sharedContext = resolveSharedProcessContext();
  ensureLogDir(sharedContext);
  const existingPid = ensureSingleInstance();
  if (existingPid) {
    logLine(`already_running pid=${existingPid}`);
    return;
  }

  const intervalMinutes = parseIntervalMinutes(process.argv.slice(2));
  const intervalMs = intervalMinutes * 60_000;
  writePidFile(sharedContext.supervisorPidFile, process.pid);
  installSignalHandlers();

  // Keep one long-lived background process per desktop session so healthy
  // periods do not require Task Scheduler to spawn a fresh watchdog script
  // every few minutes. Recovery still uses the same watchdog logic, but the
  // idle path is now a sleeping supervisor rather than repeated task launches.
  logLine(`started pid=${process.pid} interval_minutes=${intervalMinutes}`);

  while (!shuttingDown) {
    try {
      const state = await runWatchdogOnce({ shouldPrintSummary: false });
      const signature = buildStateSignature(state);
      if (signature !== lastLoggedSignature || state.result !== "healthy") {
        const actions = Array.isArray(state.actions) && state.actions.length
          ? ` actions=${state.actions.join(" | ")}`
          : "";
        const error = state.error ? ` error=${state.error}` : "";
        const after = isRecord(state.after) ? state.after : null;
        const appServerState = after && isRecord(after.appServer) ? after.appServer : null;
        const bridgeState = after && isRecord(after.bridge) ? after.bridge : null;
        logLine(
          `result=${state.result} readyz=${appServerState?.ready ? "ok" : "down"} `
          + `bridge=${String(bridgeState?.heartbeatStatus || "missing")}${actions}${error}`
        );
        lastLoggedSignature = signature;
      }
    } catch (error) {
      logLine(`loop_error=${formatErrorMessage(error)}`);
    }

    if (!shuttingDown) {
      await sleep(intervalMs);
    }
  }

  removePidFileIfMatches(sharedContext.supervisorPidFile, process.pid);
  logLine(`stopped pid=${process.pid}`);
}

if (require.main === module) {
  main().catch((error: any) => {
    logLine(`fatal=${formatErrorMessage(error)}`);
    process.exit(1);
  });
}

export { main };
