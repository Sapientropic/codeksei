import { readPrefixedEnv } from "../core/branding";
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
  const appServerPidLabel = appServer.pid ? ` pid=${appServer.pid}` : "";
  console.log(`shared app-server ${appServer.status}${appServerPidLabel} listen=${sharedContext.listenUrl}`);

  const bridge = await ensureManagedBridge({ restartUnhealthy: true });
  console.log(`shared codeksei ${bridge.status} pid=${bridge.pid}`);

  const supervisor = await ensureManagedSupervisor({ intervalMinutes: parseIntervalMinutes() });
  console.log(`shared supervisor ${supervisor.status} pid=${supervisor.pid}`);
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

export { main };
