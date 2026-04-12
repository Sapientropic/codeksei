const http = require("http");
const {
  listenUrl,
  appServerPidFile,
  bridgePidFile,
  supervisorPidFile,
  watchdogStateFile,
  readPidFile,
  isPidAlive,
  readSharedBridgeHealth,
  resolveReadyAppServerPid,
  readJsonFile,
} = require("./shared-common");

async function main() {
  const ready = await checkReadyz();
  const readyAppServerPid = ready ? await resolveReadyAppServerPid() : 0;
  const bridgeHealth = readSharedBridgeHealth();
  const watchdogState = readJsonFile(watchdogStateFile) || {};
  console.log(`listen=${listenUrl}`);
  printPidState("shared_supervisor_pid", supervisorPidFile);
  printPidState("shared_app_server_pid", appServerPidFile, readyAppServerPid);
  printPidState("shared_codeksei_pid", bridgePidFile);
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
  return new Promise((resolve: any) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: new URL(listenUrl).port,
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

module.exports = {
  checkReadyz,
  main,
};

if (require.main === module) {
  main().catch((error: any) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

export {};
