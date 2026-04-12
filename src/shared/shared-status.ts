import * as http from "node:http";
import {
  isPidAlive,
  readJsonFile,
  readPidFile,
  readSharedBridgeHealth,
  resolveReadyAppServerPid,
  resolveSharedProcessContext,
} from "./shared-common";

async function main() {
  const sharedContext = resolveSharedProcessContext();
  const ready = await checkReadyz();
  const readyAppServerPid = ready ? await resolveReadyAppServerPid(sharedContext) : 0;
  const bridgeHealth = readSharedBridgeHealth(sharedContext);
  const watchdogState = (readJsonFile(sharedContext.watchdogStateFile) || {}) as Record<string, unknown>;
  console.log(`listen=${sharedContext.listenUrl}`);
  printPidState("shared_supervisor_pid", sharedContext.supervisorPidFile);
  printPidState("shared_app_server_pid", sharedContext.appServerPidFile, readyAppServerPid);
  printPidState("shared_codeksei_pid", sharedContext.bridgePidFile);
  console.log(`shared_bridge_heartbeat=${bridgeHealth.classification.status}`);
  console.log(`shared_bridge_heartbeat_at=${bridgeHealth.classification.updatedAt || "missing"}`);
  console.log(`shared_watchdog_last_run=${normalizeText(watchdogState.lastRunAt) || "missing"}`);
  console.log(`shared_watchdog_last_result=${normalizeText(watchdogState.result) || "missing"}`);
  console.log(`readyz=${ready ? "ok" : "down"}`);
}

function printPidState(label: any, filePath: any, fallbackPid: number = 0) {
  const pid = readPidFile(filePath) || fallbackPid;
  if (!pid) {
    console.log(`${label}=missing`);
    return;
  }
  if (!isPidAlive(pid)) {
    console.log(`${label}=stale`);
    return;
  }
  console.log(`${label}=${pid}`);
}

function checkReadyz() {
  const sharedContext = resolveSharedProcessContext();
  return new Promise((resolve: any) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: new URL(sharedContext.listenUrl).port,
        path: "/readyz",
        timeout: 600,
      },
      (res: any) => {
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

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

export {
  checkReadyz,
  main,
};
