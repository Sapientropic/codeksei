// @ts-check

const { normalizeText } = require("./approval-command-policy");

function resolveLongPollTimeoutMs({
  systemMessageDispatcher = null,
  activeAccountId = "",
  timelineScreenshotQueue = null,
  reminderQueue = null,
  defaultLongPollTimeoutMs = 35_000,
  minLongPollTimeoutMs = 2_000,
  now = () => Date.now(),
}) {
  if (systemMessageDispatcher?.hasPending()) {
    return minLongPollTimeoutMs;
  }
  if (activeAccountId && timelineScreenshotQueue?.hasPendingForAccount(activeAccountId)) {
    return minLongPollTimeoutMs;
  }

  const nextDueAtMs = reminderQueue?.peekNextDueAtMs?.() || 0;
  if (!nextDueAtMs) {
    return defaultLongPollTimeoutMs;
  }

  const remainingMs = nextDueAtMs - now();
  if (remainingMs <= minLongPollTimeoutMs) {
    return minLongPollTimeoutMs;
  }
  return Math.max(minLongPollTimeoutMs, Math.min(defaultLongPollTimeoutMs, remainingMs));
}

async function runAppPollLoop({
  account,
  runtimeState,
  shutdown,
  channelAdapter,
  flushDueReminders,
  flushPendingSystemMessages,
  flushPendingTimelineScreenshots,
  resolveLongPollTimeoutMs,
  handleIncomingMessage,
  updateBridgeHeartbeat,
  retryDelayMs,
  backoffDelayMs,
  maxConsecutiveFailures,
  sleep = defaultSleep,
}) {
  let consecutiveFailures = 0;
  while (!shutdown.stopped) {
    try {
      updateBridgeHeartbeat({
        pid: process.pid,
        status: "running",
        accountId: account.accountId,
        workspaceRoot: runtimeState.workspaceRoot,
        codexEndpoint: runtimeState.endpoint,
        lastPollStartedAt: new Date().toISOString(),
      });
      await flushDueReminders(account);
      await flushPendingSystemMessages();
      await flushPendingTimelineScreenshots(account);
      const response = await channelAdapter.getUpdates({
        syncBuffer: channelAdapter.loadSyncBuffer(),
        timeoutMs: resolveLongPollTimeoutMs(),
      });
      assertWeixinUpdateResponse(response);
      consecutiveFailures = 0;
      updateBridgeHeartbeat({
        pid: process.pid,
        status: "running",
        accountId: account.accountId,
        workspaceRoot: runtimeState.workspaceRoot,
        codexEndpoint: runtimeState.endpoint,
        lastPollSucceededAt: new Date().toISOString(),
        consecutiveFailures: 0,
        lastError: "",
      });
      const messages = Array.isArray(response?.msgs) ? response.msgs : [];
      for (const message of messages) {
        if (shutdown.stopped) {
          break;
        }
        await handleIncomingMessage(message);
      }
      await flushDueReminders(account);
      await flushPendingSystemMessages();
      await flushPendingTimelineScreenshots(account);
    } catch (error) {
      if (shutdown.stopped) {
        break;
      }

      if (isSessionExpiredError(error)) {
        throw new Error("微信会话已失效，请重新执行 `npm run login`");
      }

      consecutiveFailures += 1;
      const errorMessage = formatErrorMessage(error);
      updateBridgeHeartbeat({
        pid: process.pid,
        status: "degraded",
        accountId: account.accountId,
        workspaceRoot: runtimeState.workspaceRoot,
        codexEndpoint: runtimeState.endpoint,
        lastPollFailedAt: new Date().toISOString(),
        consecutiveFailures,
        lastError: errorMessage,
      });
      console.error(`[codeksei] poll failed: ${errorMessage}`);
      await sleep(consecutiveFailures >= maxConsecutiveFailures ? backoffDelayMs : retryDelayMs);
    }
  }
}

function assertWeixinUpdateResponse(response) {
  const ret = normalizeErrorCode(response?.ret);
  const errcode = normalizeErrorCode(response?.errcode);
  if ((ret !== 0 && ret !== null) || (errcode !== 0 && errcode !== null)) {
    const error = new Error(
      `weixin getUpdates ret=${ret ?? ""} errcode=${errcode ?? ""} errmsg=${normalizeText(response?.errmsg) || ""}`
    );
    error.ret = ret;
    error.errcode = errcode;
    throw error;
  }
}

function isSessionExpiredError(error) {
  const ret = normalizeErrorCode(error?.ret);
  const errcode = normalizeErrorCode(error?.errcode);
  return ret === -14
    || errcode === -14
    || String(error?.message || "").includes("session expired")
    || String(error?.message || "").includes("会话已失效");
}

function formatErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error || "unknown error");
  if (isSessionExpiredError(error)) {
    return "微信会话已失效，请重新执行 `npm run login`";
  }
  return raw;
}

function normalizeErrorCode(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  assertWeixinUpdateResponse,
  formatErrorMessage,
  isSessionExpiredError,
  resolveLongPollTimeoutMs,
  runAppPollLoop,
};
