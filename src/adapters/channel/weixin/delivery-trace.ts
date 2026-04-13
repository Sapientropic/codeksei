import * as crypto from "node:crypto";
import { logError, logInfo } from "../../../core/logging";

const SEND_RETRY_DELAYS_MS = [900, 1800];
const AMBIGUOUS_SEND_RETRY_DELAYS_MS = [1200];

export interface TraceContext extends Record<string, unknown> {
  enabled?: boolean;
  traceId?: string;
  origin?: string;
  variant?: string;
  threadId?: string;
  turnId?: string;
  mode?: string;
  trigger?: string;
  chunkIndex?: number;
  chunkTotal?: number;
  preserveBlock?: boolean;
  attempt?: number;
  retryable?: boolean;
  clientId?: string;
  chars?: number;
  textHash?: string;
  error?: string;
}

export async function sendTextChunkWithRetry<T>(
  send: () => Promise<T>,
  { trace = null }: { trace?: TraceContext | null } = {},
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; ; attempt += 1) {
    const attemptNumber = attempt + 1;
    try {
      logWeixinSendTrace("attempt", {
        ...buildWeixinTraceContext(trace),
        attempt: attemptNumber,
      });
      const result = await send();
      logWeixinSendTrace("success", {
        ...buildWeixinTraceContext(trace),
        attempt: attemptNumber,
      });
      return result;
    } catch (error) {
      lastError = error;
      const retryDelays = getSendRetryDelaysMs(error);
      const retryable = attempt < retryDelays.length;
      logWeixinSendTrace("error", {
        ...buildWeixinTraceContext(trace),
        attempt: attemptNumber,
        retryable,
        error: formatUnknownError(error),
      });
      if (!retryable) {
        throw error;
      }
      const retryDelay = retryDelays[attempt];
      if (retryDelay === undefined) {
        throw error;
      }
      await sleep(retryDelay);
    }
  }
  throw lastError || new Error("sendText chunk failed");
}

export function getSendRetryDelaysMs(error: unknown): number[] {
  const message = formatUnknownError(error);
  // `ret=-2` is ambiguous: the first attempt may already have landed, or it may
  // have died before the user ever saw it. Retrying with the same client_id once
  // keeps the call idempotent enough to avoid visible truncation without turning
  // one flaky send into a burst of duplicate bubbles.
  if (message.includes("ret=-2")) {
    return AMBIGUOUS_SEND_RETRY_DELAYS_MS;
  }
  if (message.includes("AbortError")
    || message.includes("aborted")
    || message.includes("fetch failed")
    || message.includes("ECONNRESET")
    || message.includes("ETIMEDOUT")
    || /http 5\d\d/.test(message)) {
    return SEND_RETRY_DELAYS_MS;
  }
  return [];
}

export function buildWeixinTraceContext(trace: unknown, defaults: TraceContext = {}): TraceContext {
  const normalizedTrace = normalizeTraceContext(trace);
  return {
    ...defaults,
    ...normalizedTrace,
    enabled: Boolean(normalizedTrace.enabled ?? defaults.enabled),
    traceId: normalizeTraceText(normalizedTrace.traceId)
      || normalizeTraceText(defaults.traceId)
      || `wx-${crypto.randomUUID().slice(0, 8)}`,
  };
}

export function normalizeTraceContext(trace: unknown): TraceContext {
  if (!isRecord(trace)) {
    return {};
  }
  return { ...trace };
}

export function normalizeTraceText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function logWeixinSendTrace(stage: string, trace: TraceContext): void {
  if (!Boolean(trace?.enabled)) {
    return;
  }
  const parts = [
    `[codeksei] weixin send trace stage=${stage}`,
    `pid=${process.pid}`,
    `trace=${trace.traceId || "(none)"}`,
    `origin=${trace.origin || "adapter.sendText"}`,
    `variant=${trace.variant || "(unknown)"}`,
    trace.threadId ? `thread=${trace.threadId}` : "",
    `turn=${trace.turnId || "(pending)"}`,
    trace.mode ? `mode=${trace.mode}` : "",
    trace.trigger ? `trigger=${trace.trigger}` : "",
    `chunk=${trace.chunkIndex || 1}/${trace.chunkTotal || 1}`,
    `preserveBlock=${trace.preserveBlock ? "1" : "0"}`,
    `attempt=${trace.attempt || 1}`,
    trace.retryable === undefined ? "" : `retryable=${trace.retryable ? "1" : "0"}`,
    `clientId=${trace.clientId || "(none)"}`,
    `chars=${trace.chars || 0}`,
    `hash=${trace.textHash || hashTraceText("")}`,
  ].filter(Boolean);
  if (trace.error) {
    parts.push(`error=${JSON.stringify(String(trace.error || ""))}`);
    logError(parts.join(" "));
    return;
  }
  logInfo(parts.join(" "));
}

export function hashTraceText(text: unknown): string {
  return crypto.createHash("sha1").update(String(text || ""), "utf8").digest("hex").slice(0, 12);
}

export function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
