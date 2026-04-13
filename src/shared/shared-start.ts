import { readPrefixedEnv } from "../contracts/app-env";
import { formatErrorMessage } from "../core/error-handling";
import { operatorMessages } from "../core/message-catalog";
import { writeStderrLine, writeStdoutLine } from "../core/terminal-output";
import {
  ensureManagedAppServer,
  ensureManagedBridge,
  ensureManagedSupervisor,
  resolveSharedProcessContext,
} from "./shared-common";


function parseIntervalMinutes() {
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--interval-minutes=")) {
      continue;
    }
    const value = Number.parseInt(rawArg.slice("--interval-minutes=".length), 10);
    if (Number.isInteger(value) && value >= 1) {
      return value;
    }
  }
  const value = Number.parseInt(
    String(readPrefixedEnv(process.env, "SHARED_WATCHDOG_INTERVAL_MINUTES") || "5"),
    10
  );
  return Number.isInteger(value) && value >= 1 ? value : 5;
}

async function main() {
  const sharedContext = resolveSharedProcessContext();
  const appServer = await ensureManagedAppServer({ restartUnhealthy: true });
  writeStdoutLine(operatorMessages.sharedStartAppServer(appServer.status, appServer.pid, sharedContext.listenUrl));

  const bridge = await ensureManagedBridge({ restartUnhealthy: true });
  writeStdoutLine(operatorMessages.sharedStartBridge(bridge.status, bridge.pid));

  const supervisor = await ensureManagedSupervisor({ intervalMinutes: parseIntervalMinutes() });
  writeStdoutLine(operatorMessages.sharedStartSupervisor(supervisor.status, supervisor.pid));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    writeStderrLine(formatErrorMessage(error));
    process.exit(1);
  });
}

export { main };
