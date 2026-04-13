import { ensureCodekseiHomeEnv } from "../contracts/app-env";
import { resolvePackageRoot } from "../contracts/path-utils";
import { normalizeText } from "../contracts/text-normalization";
import { createWeixinChannelAdapter } from "../adapters/channel/weixin";
import { resolveSelectedAccount } from "../adapters/channel/weixin/account-store";
import { loadPersistedContextTokens } from "../adapters/channel/weixin/context-token-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import { readConfig } from "../core/config";
import { loadEnvStack } from "../core/env-loader";
import { assertBridgeMode } from "../core/host-mode";
import { writeStderrLine, writeStdoutLine } from "../core/terminal-output";
import { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } from "../workspace/default-targets";
import {
  ensureLogDir,
  ensureManagedAppServer,
  ensureManagedBridge,
  readJsonFile,
  readPidFile,
  readSharedBridgeHealth,
  resolveReadyAppServerPid,
  resolveSharedProcessContext,
  type SharedProcessContext,
  writeJsonFile,
} from "./shared-common";
import type {
  SharedHealthSnapshot,
  SharedWatchdogAlert,
  SharedWatchdogNotification,
  SharedWatchdogState,
} from "./shared-types";

const ALERT_COOLDOWN_MS = 10 * 60_000;

function loadWatchdogConfig(): Record<string, unknown> {
  loadEnvStack();
  ensureCodekseiHomeEnv({ fallbackRoot: resolvePackageRoot(__dirname) });
  return readConfig();
}

async function runWatchdogOnce({ shouldPrintSummary = true }: { shouldPrintSummary?: boolean } = {}): Promise<SharedWatchdogState> {
  const sharedContext = resolveSharedProcessContext();
  const config = loadWatchdogConfig();
  ensureLogDir(sharedContext);
  const previousState = (readJsonFile(sharedContext.watchdogStateFile) || null) as SharedWatchdogState | null;
  const before = await collectHealth(sharedContext);
  const actions: string[] = [];
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

  const after = await collectHealth(sharedContext);
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
    lastAlertAt: normalizeText(previousState?.lastAlertAt),
    lastAlertSignature: normalizeText(previousState?.lastAlertSignature),
    lastNotification: previousState?.lastNotification || null,
  };

  const alert = buildAlert({ result, actions, errorMessage, after, config, sharedContext });
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

  writeJsonFile(sharedContext.watchdogStateFile, nextState);
  if (shouldPrintSummary) {
    printSummary(nextState);
  }

  return nextState;
}

async function main() {
  assertBridgeMode(process.env, "npm run shared:watchdog");
  const state = await runWatchdogOnce({ shouldPrintSummary: true });
  if (state.result === "failed") {
    process.exit(1);
  }
}

async function collectHealth(sharedContext: SharedProcessContext): Promise<SharedHealthSnapshot> {
  const appServerReadyPid = await resolveReadyAppServerPid(sharedContext);
  const bridge = readSharedBridgeHealth(sharedContext);
  return {
    appServer: {
      ready: Boolean(appServerReadyPid),
      readyPid: appServerReadyPid,
      pidFromFile: readPidFile(sharedContext.appServerPidFile),
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

function buildAlert({
  result,
  actions,
  errorMessage,
  after,
  config,
  sharedContext,
}: {
  result: string;
  actions: string[];
  errorMessage: string;
  after: SharedHealthSnapshot;
  config: Record<string, unknown>;
  sharedContext: SharedProcessContext;
}): SharedWatchdogAlert | null {
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
        `日志: ${sharedContext.appServerLogFile} | ${sharedContext.bridgeLogFile}`,
      ].filter(Boolean).join("\n"),
    };
  }

  return null;
}

function shouldSendAlert(previousState: SharedWatchdogState | null, signature: unknown): boolean {
  const normalizedSignature = normalizeText(signature);
  if (!normalizedSignature) {
    return false;
  }
  const previousSignature = normalizeText(previousState?.lastAlertSignature);
  const previousAlertAtMs = Date.parse(normalizeText(previousState?.lastAlertAt));
  if (normalizedSignature !== previousSignature) {
    return true;
  }
  if (!Number.isFinite(previousAlertAtMs)) {
    return true;
  }
  return Date.now() - previousAlertAtMs >= ALERT_COOLDOWN_MS;
}

async function sendVisibleAlert(
  config: Record<string, unknown>,
  text: string,
): Promise<Omit<SharedWatchdogNotification, "kind" | "sentAt">> {
  try {
    const runtimeConfig = config as ReturnType<typeof readConfig>;
    const account = resolveSelectedAccount(runtimeConfig);
    const sessionStore = new SessionStore({ filePath: runtimeConfig.sessionsFile });
    const senderId = resolvePreferredSenderId({
      config: runtimeConfig,
      accountId: account.accountId,
      sessionStore,
    });
    const workspaceRoot = resolvePreferredWorkspaceRoot({
      config: runtimeConfig,
      accountId: account.accountId,
      senderId,
      sessionStore,
    });
    const contextToken = loadPersistedContextTokens(runtimeConfig, account.accountId)?.[senderId] || "";
    if (!senderId || !contextToken) {
      return {
        sent: false,
        reason: "missing_sender_or_context_token",
        senderId,
        workspaceRoot,
      };
    }

    const channelAdapter = createWeixinChannelAdapter(runtimeConfig);
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

function printSummary(state: SharedWatchdogState) {
  writeStdoutLine(`result=${state.result}`);
  writeStdoutLine(`readyz=${state.after?.appServer?.ready ? "ok" : "down"}`);
  writeStdoutLine(`shared_app_server_pid=${state.after?.appServer?.readyPid || "missing"}`);
  writeStdoutLine(`shared_codeksei_pid=${state.after?.bridge?.pid || "missing"}`);
  writeStdoutLine(`shared_bridge_heartbeat=${state.after?.bridge?.heartbeatStatus || "missing"}`);
  writeStdoutLine(`shared_bridge_heartbeat_at=${state.after?.bridge?.heartbeatUpdatedAt || "missing"}`);
  if (Array.isArray(state.actions) && state.actions.length) {
    writeStdoutLine(`actions=${state.actions.join(" | ")}`);
  }
  if (normalizeText(state.error)) {
    writeStdoutLine(`error=${state.error}`);
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.stack || String(error);
  }
  return String(error || "unknown error");
}

if (require.main === module) {
  main().catch((error: unknown) => {
    writeStderrLine(formatErrorMessage(error));
    process.exit(1);
  });
}

export {
  main,
  runWatchdogOnce,
};
