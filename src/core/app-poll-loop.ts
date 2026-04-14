import { normalizeTrimmedText } from "./approval-command-policy";
import type { ChannelAccount, ChannelAdapterLike } from "./app-service-contract";
import { logError } from "./logging";


interface LongPollSystemMessageDispatcher {
  hasPending(): boolean;
}

interface LongPollTimelineScreenshotQueue {
  hasPendingForAccount?(accountId: string): boolean;
}

interface LongPollReminderQueue {
  peekNextDueAtMs?(): number;
}

interface ResolveLongPollTimeoutMsArgs {
  systemMessageDispatcher?: LongPollSystemMessageDispatcher | null;
  activeAccountId?: string;
  timelineScreenshotQueue?: LongPollTimelineScreenshotQueue | null;
  reminderQueue?: LongPollReminderQueue | null;
  defaultLongPollTimeoutMs?: number;
  minLongPollTimeoutMs?: number;
  now?: () => number;
}

interface RuntimeStateSnapshot {
  endpoint: string;
  workspaceRoot: string;
}

interface ShutdownState {
  stopped: boolean;
}

interface WeixinUpdateResponse extends Record<string, unknown> {
  ret?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
  msgs?: unknown[];
}

interface RunAppPollLoopArgs {
  account: Pick<ChannelAccount, "accountId">;
  runtimeState: RuntimeStateSnapshot;
  shutdown: ShutdownState;
  channelAdapter: Pick<ChannelAdapterLike, "getUpdates" | "loadSyncBuffer">;
  flushDueReminders: (account: Pick<ChannelAccount, "accountId">) => Promise<void>;
  flushPendingSystemMessages: () => Promise<void>;
  flushPendingTimelineScreenshots: (account: Pick<ChannelAccount, "accountId">) => Promise<void>;
  resolveLongPollTimeoutMs: () => number;
  handleIncomingMessage: (message: unknown) => Promise<void>;
  updateBridgeHeartbeat: (patch: Record<string, unknown>) => void;
  retryDelayMs: number;
  backoffDelayMs: number;
  maxConsecutiveFailures: number;
  sleep?: (ms: number) => Promise<void>;
}

export function resolveLongPollTimeoutMs({
  systemMessageDispatcher = null,
  activeAccountId = "",
  timelineScreenshotQueue = null,
  reminderQueue = null,
  defaultLongPollTimeoutMs = 35_000,
  minLongPollTimeoutMs = 2_000,
  now = () => Date.now(),
}: ResolveLongPollTimeoutMsArgs): number {
  if (systemMessageDispatcher?.hasPending()) {
    return minLongPollTimeoutMs;
  }
  if (activeAccountId && timelineScreenshotQueue?.hasPendingForAccount?.(activeAccountId)) {
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

export async function runAppPollLoop({
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
}: RunAppPollLoopArgs): Promise<void> {
  let consecutiveFailures = 0;
  while (!shutdown.stopped) {
    try {
      updateBridgeHeartbeat({
        pid: process.pid,
        status: "running",
        accountId: account.accountId,
        workspaceRoot: runtimeState.workspaceRoot,
        runtimeEndpoint: runtimeState.endpoint,
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
        runtimeEndpoint: runtimeState.endpoint,
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
        runtimeEndpoint: runtimeState.endpoint,
        lastPollFailedAt: new Date().toISOString(),
        consecutiveFailures,
        lastError: errorMessage,
      });
      logError(`[codeksei] poll failed: ${errorMessage}`);
      await sleep(consecutiveFailures >= maxConsecutiveFailures ? backoffDelayMs : retryDelayMs);
    }
  }
}

function assertWeixinUpdateResponse(response: WeixinUpdateResponse): asserts response is WeixinUpdateResponse {
  const ret = normalizeErrorCode(response?.ret);
  const errcode = normalizeErrorCode(response?.errcode);
  if ((ret !== 0 && ret !== null) || (errcode !== 0 && errcode !== null)) {
    const error = new Error(
      `weixin getUpdates ret=${ret ?? ""} errcode=${errcode ?? ""} errmsg=${normalizeTrimmedText(response?.errmsg) || ""}`
    ) as Error & { ret?: number | null; errcode?: number | null };
    error.ret = ret;
    error.errcode = errcode;
    throw error;
  }
}

function isSessionExpiredError(error: unknown): boolean {
  const candidate = isRecord(error)
    ? error as Record<string, unknown>
    : null;
  const ret = normalizeErrorCode(candidate?.ret);
  const errcode = normalizeErrorCode(candidate?.errcode);
  const message = extractErrorMessage(error);
  return ret === -14
    || errcode === -14
    || message.includes("session expired")
    || message.includes("会话已失效");
}

export function formatErrorMessage(error: unknown): string {
  const raw = extractErrorMessage(error);
  if (isSessionExpiredError(error)) {
    return "微信会话已失效，请重新执行 `npm run login`";
  }
  return raw;
}

function normalizeErrorCode(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return String(error || "unknown error");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export {
  assertWeixinUpdateResponse,
  isSessionExpiredError,
};
