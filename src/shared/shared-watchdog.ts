import * as brandingModule from "../core/branding";
import * as envLoaderModule from "../core/env-loader";
import * as pathUtilsModule from "../core/path-utils";
import { createWeixinChannelAdapter } from "../adapters/channel/weixin";
import * as accountStoreModule from "../adapters/channel/weixin/account-store";
import * as contextTokenStoreModule from "../adapters/channel/weixin/context-token-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import * as configModule from "../core/config";
import * as defaultTargetsModule from "../workspace/default-targets";
import {
  appServerLogFile,
  appServerPidFile,
  bridgeLogFile,
  bridgePidFile,
  ensureLogDir,
  ensureManagedAppServer,
  ensureManagedBridge,
  readJsonFile,
  readPidFile,
  readSharedBridgeHealth,
  resolveReadyAppServerPid,
  watchdogStateFile,
  writeJsonFile,
} from "./shared-common";

const {
  ensureCodekseiHomeEnv,
  ensureStateDirectory,
} = brandingModule as {
  ensureCodekseiHomeEnv: (args: { fallbackRoot: string }) => void;
  ensureStateDirectory: () => void;
};
const { loadEnvStack } = envLoaderModule as {
  loadEnvStack: () => void;
};
const { resolvePackageRoot } = pathUtilsModule as {
  resolvePackageRoot: (baseDir: string) => string;
};
const { resolveSelectedAccount } = accountStoreModule as {
  resolveSelectedAccount: (config: Record<string, unknown>) => { accountId: string };
};
const { loadPersistedContextTokens } = contextTokenStoreModule as {
  loadPersistedContextTokens: (config: Record<string, unknown>, accountId: string) => Record<string, string>;
};
const { readConfig } = configModule as {
  readConfig: () => Record<string, unknown>;
};
const {
  resolvePreferredSenderId,
  resolvePreferredWorkspaceRoot,
} = defaultTargetsModule as unknown as {
  resolvePreferredSenderId: (args: Record<string, unknown>) => string;
  resolvePreferredWorkspaceRoot: (args: Record<string, unknown>) => string;
};

const ALERT_COOLDOWN_MS = 10 * 60_000;

function ensureDefaultStateDirectory() {
  ensureStateDirectory();
}

function loadEnv() {
  loadEnvStack();
  ensureDefaultStateDirectory();
}

function ensureRuntimeEnv() {
  ensureCodekseiHomeEnv({ fallbackRoot: resolvePackageRoot(__dirname) });
}

loadEnv();
ensureRuntimeEnv();

async function runWatchdogOnce({ shouldPrintSummary = true }: any = {}) {
  const config = readConfig();
  ensureLogDir();
  const previousState = (readJsonFile(watchdogStateFile) || {}) as Record<string, unknown>;
  const before = await collectHealth();
  const actions = [];
  let result = "healthy";
  let errorMessage = "";

  try {
    const appServer = await ensureManagedAppServer({ restartUnhealthy: true });
    if (appServer.status !== "already_running") {
      actions.push(`shared app-server ${appServer.status} pid=${appServer.pid}`);
    }

    const bridge = await ensureManagedBridge({ restartUnhealthy: true });
    if (bridge.status !== "already_running") {
      actions.push(`shared codeksei ${bridge.status} pid=${bridge.pid}`);
    }
  } catch (error) {
    result = "failed";
    errorMessage = formatErrorMessage(error);
  }

  const after = await collectHealth();
  if (result !== "failed") {
    result = actions.length ? "recovered" : "healthy";
  }

  const nextState = {
    lastRunAt: new Date().toISOString(),
    result,
    actions,
    error: errorMessage,
    before,
    after,
    lastAlertAt: normalizeText(previousState.lastAlertAt),
    lastAlertSignature: normalizeText(previousState.lastAlertSignature),
    lastNotification: previousState.lastNotification || null,
  };

  const alert = buildAlert({ result, actions, errorMessage, after, config });
  if (alert && shouldSendAlert(previousState, alert.signature)) {
    const notification = await sendVisibleAlert(config, alert.text);
    nextState.lastAlertAt = new Date().toISOString();
    nextState.lastAlertSignature = alert.signature;
    nextState.lastNotification = {
      kind: alert.kind,
      sent: notification.sent,
      reason: normalizeText(notification.reason),
      senderId: normalizeText(notification.senderId),
      workspaceRoot: normalizeText(notification.workspaceRoot),
      sentAt: new Date().toISOString(),
    };
  }

  writeJsonFile(watchdogStateFile, nextState);
  if (shouldPrintSummary) {
    printSummary(nextState);
  }

  return nextState;
}

async function main() {
  const state = await runWatchdogOnce({ shouldPrintSummary: true });
  if (state.result === "failed") {
    process.exit(1);
  }
}

async function collectHealth() {
  const appServerReadyPid = await resolveReadyAppServerPid();
  const bridge = readSharedBridgeHealth();
  return {
    appServer: {
      ready: Boolean(appServerReadyPid),
      readyPid: appServerReadyPid,
      pidFromFile: readPidFile(appServerPidFile),
    },
    bridge: {
      pid: bridge.pid,
      alive: bridge.alive,
      healthy: bridge.healthy,
      heartbeatStatus: bridge.classification.status,
      heartbeatUpdatedAt: normalizeText(bridge.classification.updatedAt),
      lastError: normalizeText(bridge.heartbeat?.lastError),
      consecutiveFailures: Number(bridge.heartbeat?.consecutiveFailures || 0),
    },
  };
}

function buildAlert({ result, actions, errorMessage, after, config }: any) {
  if (result === "recovered") {
    return {
      kind: "recovered",
      signature: `recovered:${actions.join("|")}`,
      text: [
        "后台守护刚自动恢复了共享链路。",
        `动作: ${actions.join("；")}`,
        `workspace: ${normalizeText(config.workspaceRoot) || "(unknown)"}`,
        `readyz: ${after.appServer.ready ? "ok" : "down"}`,
        "现在可以继续直接发微信消息。",
      ].join("\n"),
    };
  }

  if (result === "failed") {
    return {
      kind: "failed",
      signature: [
        "failed",
        errorMessage,
        after.appServer.ready ? "ready" : "down",
        after.bridge.heartbeatStatus,
        String(after.bridge.consecutiveFailures),
      ].join("|"),
      text: [
        "后台守护刚发现共享链路异常，但这轮自动恢复没有完全成功。",
        `readyz: ${after.appServer.ready ? "ok" : "down"}`,
        `bridge: ${after.bridge.heartbeatStatus}`,
        after.bridge.lastError ? `bridge error: ${after.bridge.lastError}` : "",
        errorMessage ? `watchdog error: ${errorMessage}` : "",
        `workspace: ${normalizeText(config.workspaceRoot) || "(unknown)"}`,
        `日志: ${appServerLogFile} | ${bridgeLogFile}`,
      ].filter(Boolean).join("\n"),
    };
  }

  return null;
}

function shouldSendAlert(previousState: any, signature: any) {
  const normalizedSignature = normalizeText(signature);
  if (!normalizedSignature) {
    return false;
  }
  const previousSignature = normalizeText(previousState.lastAlertSignature);
  const previousAlertAtMs = Date.parse(normalizeText(previousState.lastAlertAt));
  if (normalizedSignature !== previousSignature) {
    return true;
  }
  if (!Number.isFinite(previousAlertAtMs)) {
    return true;
  }
  return Date.now() - previousAlertAtMs >= ALERT_COOLDOWN_MS;
}

async function sendVisibleAlert(config: any, text: any) {
  try {
    const account = resolveSelectedAccount(config);
    const sessionStore = new SessionStore({ filePath: config.sessionsFile });
    const senderId = resolvePreferredSenderId({
      config,
      accountId: account.accountId,
      sessionStore,
    });
    const workspaceRoot = resolvePreferredWorkspaceRoot({
      config,
      accountId: account.accountId,
      senderId,
      sessionStore,
    });
    const contextToken = loadPersistedContextTokens(config, account.accountId)?.[senderId] || "";
    if (!senderId || !contextToken) {
      return {
        sent: false,
        reason: "missing_sender_or_context_token",
        senderId,
        workspaceRoot,
      };
    }

    const channelAdapter = createWeixinChannelAdapter(config);
    await channelAdapter.sendText({
      userId: senderId,
      contextToken,
      preserveBlock: true,
      text,
    });
    return {
      sent: true,
      reason: "",
      senderId,
      workspaceRoot,
    };
  } catch (error) {
    return {
      sent: false,
      reason: formatErrorMessage(error),
      senderId: "",
      workspaceRoot: "",
    };
  }
}

function printSummary(state: any) {
  console.log(`result=${state.result}`);
  console.log(`readyz=${state.after?.appServer?.ready ? "ok" : "down"}`);
  console.log(`shared_app_server_pid=${state.after?.appServer?.readyPid || "missing"}`);
  console.log(`shared_codeksei_pid=${state.after?.bridge?.pid || "missing"}`);
  console.log(`shared_bridge_heartbeat=${state.after?.bridge?.heartbeatStatus || "missing"}`);
  console.log(`shared_bridge_heartbeat_at=${state.after?.bridge?.heartbeatUpdatedAt || "missing"}`);
  if (Array.isArray(state.actions) && state.actions.length) {
    console.log(`actions=${state.actions.join(" | ")}`);
  }
  if (normalizeText(state.error)) {
    console.log(`error=${state.error}`);
  }
}

function formatErrorMessage(error: any) {
  if (error instanceof Error) {
    return error.message || error.stack || String(error);
  }
  return String(error || "unknown error");
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(formatErrorMessage(error));
    process.exit(1);
  });
}

export {
  main,
  runWatchdogOnce,
};
