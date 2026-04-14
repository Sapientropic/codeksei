import { normalizeText } from "../contracts/text-normalization";
import * as http from "node:http";
import { resolveHostMode } from "../core/host-mode";
import { writeStderrLine, writeStdoutLine } from "../core/terminal-output";
import {
  isPidAlive,
  readJsonFile,
  readPidFile,
  readSharedBridgeHealth,
  resolveReadyAppServerPid,
  resolveSharedProcessContext,
} from "./shared-common";
import type {
  SharedStatusSnapshot,
  SharedWatchdogState,
} from "./shared-types";

async function main() {
  const hostMode = resolveHostMode(process.env);
  if (hostMode.mode !== "bridge") {
    writeStdoutLine(`profile=${hostMode.profile}`);
    writeStdoutLine(`mode=${hostMode.mode}`);
    writeStdoutLine(`runtime=${hostMode.runtime}`);
    writeStdoutLine(`channel_provider=${hostMode.channelProvider}`);
    writeStdoutLine(`channel=${hostMode.channel}`);
    writeStdoutLine(`supported=${hostMode.supported ? "yes" : "no"}`);
    writeStdoutLine(`shared_bridge=managed_by_host`);
    writeStdoutLine(`supports_hosted_skill_install=${hostMode.capabilities.supportsHostedSkillInstall ? "yes" : "no"}`);
    writeStdoutLine(`supports_live_hosted_smoke=${hostMode.capabilities.supportsLiveHostedSmoke ? "yes" : "no"}`);
    writeStdoutLine(`supports_semantic_review_hybrid=${hostMode.capabilities.supportsSemanticReviewHybrid ? "yes" : "no"}`);
    if (hostMode.reason) {
      writeStdoutLine(`reason=${hostMode.reason}`);
    }
    return;
  }
  const snapshot = await collectSharedStatusSnapshot();
  writeStdoutLine(`listen=${snapshot.listenUrl}`);
  printPidState("shared_supervisor_pid", snapshot.supervisorPid);
  printPidState("shared_app_server_pid", snapshot.appServerPid);
  printPidState("shared_codeksei_pid", snapshot.bridgePid);
  writeStdoutLine(`shared_bridge_heartbeat=${snapshot.bridgeHealth.classification.status}`);
  writeStdoutLine(`shared_bridge_heartbeat_at=${snapshot.bridgeHealth.classification.updatedAt || "missing"}`);
  writeStdoutLine(`shared_watchdog_last_run=${normalizeText(snapshot.watchdogState?.lastRunAt) || "missing"}`);
  writeStdoutLine(`shared_watchdog_last_result=${normalizeText(snapshot.watchdogState?.result) || "missing"}`);
  writeStdoutLine(`readyz=${snapshot.ready ? "ok" : "down"}`);
}

async function collectSharedStatusSnapshot(): Promise<SharedStatusSnapshot> {
  const sharedContext = resolveSharedProcessContext();
  const ready = await checkReadyz();
  const readyAppServerPid = ready ? await resolveReadyAppServerPid(sharedContext) : 0;
  const watchdogState = (readJsonFile(sharedContext.watchdogStateFile) || null) as SharedWatchdogState | null;
  return {
    listenUrl: sharedContext.listenUrl,
    ready,
    readyAppServerPid,
    supervisorPid: readPidFile(sharedContext.supervisorPidFile),
    appServerPid: readPidFile(sharedContext.appServerPidFile) || readyAppServerPid,
    bridgePid: readPidFile(sharedContext.bridgePidFile),
    bridgeHealth: readSharedBridgeHealth(sharedContext),
    watchdogState,
  };
}

function printPidState(label: string, pid: number) {
  if (!pid) {
    writeStdoutLine(`${label}=missing`);
    return;
  }
  if (!isPidAlive(pid)) {
    writeStdoutLine(`${label}=stale`);
    return;
  }
  writeStdoutLine(`${label}=${pid}`);
}

function checkReadyz(): Promise<boolean> {
  const sharedContext = resolveSharedProcessContext();
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: new URL(sharedContext.listenUrl).port,
        path: "/readyz",
        timeout: 600,
      },
      (res) => {
        res.resume();
        const statusCode = res.statusCode || 0;
        resolve(statusCode >= 200 && statusCode < 300);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    writeStderrLine(error instanceof Error ? error.message || error.stack || String(error) : String(error));
    process.exit(1);
  });
}

export {
  collectSharedStatusSnapshot,
  checkReadyz,
  main,
};
