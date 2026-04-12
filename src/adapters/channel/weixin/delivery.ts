import * as crypto from "node:crypto";
import {
  getConfigV2,
  sendTextV2,
  sendTypingV2,
  type GetConfigV2Response,
  type SendTextV2Args,
  type SendTypingV2Args,
  type WeixinApiResponse,
} from "./api-v2";

const MAX_WEIXIN_CHUNK = 3800;
const SEND_MESSAGE_CHUNK_INTERVAL_MS = 350;
const WEIXIN_SEND_CHUNK_LIMIT = 80;
const WEIXIN_MAX_DELIVERY_MESSAGES = 10;
const SEND_RETRY_DELAYS_MS = [900, 1800];
const AMBIGUOUS_SEND_RETRY_DELAYS_MS = [1200];

interface TraceContext extends Record<string, unknown> {
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

interface DeliveryConfig extends Record<string, unknown> {
  weixinDeliveryTrace?: boolean;
  weixinProtocolClientVersion?: string;
}

interface DeliveryAccount {
  baseUrl: string;
  token: string;
  routeTag?: string;
}

interface SendTextChunksArgs {
  userId: string;
  text: string;
  contextToken?: string;
  preserveBlock?: boolean;
  trace?: TraceContext | null;
}

interface SendTypingArgs {
  userId: string;
  status?: number;
  contextToken?: string;
}

interface SendV2TextChunkArgs {
  sendTextImpl?: (args: SendTextV2Args) => Promise<WeixinApiResponse>;
  baseUrl: string;
  token: string;
  routeTag?: string;
  clientVersion?: string;
  toUserId: string;
  text: string;
  contextToken: string;
  clientId?: string;
  trace?: TraceContext | null;
}

export function createWeixinDeliveryFacade({
  config,
  ensureAccount,
  resolveContextToken,
}: {
  config: DeliveryConfig;
  ensureAccount: () => DeliveryAccount;
  resolveContextToken: (userId: unknown, explicitToken?: string) => string;
}) {
  function sendTextChunks({
    userId,
    text,
    contextToken = "",
    preserveBlock = false,
    trace = null,
  }: SendTextChunksArgs): Promise<void> {
    const account = ensureAccount();
    const resolvedToken = resolveContextToken(userId, contextToken);
    if (!resolvedToken) {
      throw new Error(`缺少 context_token，无法回复用户 ${userId}`);
    }
    const content = String(text || "");
    if (!content.trim()) {
      return Promise.resolve();
    }
    const normalizedContent = normalizePlainTextForWeixin(content) || "已完成。";
    const chunkCandidates = preserveBlock
      ? chunkReplyText(normalizedContent, MAX_WEIXIN_CHUNK)
      : chunkReplyTextForWeixin(normalizedContent, WEIXIN_SEND_CHUNK_LIMIT);
    const sendChunks = packChunksForWeixinDelivery(
      chunkCandidates.length ? chunkCandidates : [normalizedContent],
      WEIXIN_MAX_DELIVERY_MESSAGES,
      MAX_WEIXIN_CHUNK,
    );
    const traceContext = buildWeixinTraceContext(trace, {
      enabled: Boolean(config.weixinDeliveryTrace),
      origin: "adapter.sendText",
      variant: "v2",
      preserveBlock,
      chunkTotal: sendChunks.length,
    });
    return sendChunks.reduce<Promise<void>>((promise, chunk, index) => promise
      .then(() => {
        const compactChunk = normalizePlainTextForWeixin(chunk) || "已完成。";
        const clientId = `cb-${crypto.randomUUID()}`;
        return sendV2TextChunk({
          baseUrl: account.baseUrl,
          token: account.token,
          routeTag: account.routeTag,
          clientVersion: normalizeText(config.weixinProtocolClientVersion),
          toUserId: userId,
          text: compactChunk,
          contextToken: resolvedToken,
          clientId,
          trace: {
            ...traceContext,
            chunkIndex: index + 1,
            chars: compactChunk.length,
            textHash: hashTraceText(compactChunk),
            clientId,
          },
        }).then(() => undefined);
      })
      .then(() => {
        if (index < sendChunks.length - 1) {
          return sleep(SEND_MESSAGE_CHUNK_INTERVAL_MS);
        }
        return undefined;
      }), Promise.resolve());
  }

  async function sendTyping({
    userId,
    status = 1,
    contextToken = "",
  }: SendTypingArgs): Promise<void> {
    const account = ensureAccount();
    const resolvedToken = resolveContextToken(userId, contextToken);
    if (!resolvedToken) {
      return;
    }
    const configResponse = await getConfigV2({
      baseUrl: account.baseUrl,
      token: account.token,
      routeTag: account.routeTag,
      clientVersion: normalizeText(config.weixinProtocolClientVersion),
      ilinkUserId: userId,
      contextToken: resolvedToken,
    }).catch((): GetConfigV2Response | null => null);
    const typingTicket = normalizeText(isRecord(configResponse) ? configResponse.typing_ticket : "");
    if (!typingTicket) {
      return;
    }
    await sendTypingV2({
      baseUrl: account.baseUrl,
      token: account.token,
      routeTag: account.routeTag,
      clientVersion: normalizeText(config.weixinProtocolClientVersion),
      body: {
        ilink_user_id: userId,
        typing_ticket: typingTicket,
        status,
      },
    });
  }

  return {
    sendText: sendTextChunks,
    sendTyping,
  };
}

export function packChunksForWeixinDelivery(
  chunks: unknown,
  maxMessages = 10,
  maxChunkChars = 3800,
): string[] {
  const normalizedChunks = Array.isArray(chunks)
    ? chunks.map((chunk) => normalizePlainTextForWeixin(chunk)).filter(Boolean)
    : [];
  if (!normalizedChunks.length) {
    return normalizedChunks;
  }
  const packed: string[] = [];
  for (const chunk of normalizedChunks) {
    if (chunk.length <= maxChunkChars) {
      packed.push(chunk);
      continue;
    }
    packed.push(...chunkReplyText(chunk, maxChunkChars));
  }

  // `maxMessages` stays as an extreme safety budget, but readability wins over
  // bubble minimization. Preserve semantic chunk boundaries instead of merging
  // them back together just to hit a smaller message count.
  void maxMessages;
  return packed;
}

export function sendV2TextChunk({
  sendTextImpl = sendTextV2,
  baseUrl,
  token,
  routeTag = "",
  clientVersion = "",
  toUserId,
  text,
  contextToken,
  clientId = "",
  trace = null,
}: SendV2TextChunkArgs): Promise<WeixinApiResponse> {
  const stableClientId = normalizeText(clientId) || `cb-${crypto.randomUUID()}`;
  return sendTextChunkWithRetry(
    () => sendTextImpl({
      baseUrl,
      token,
      routeTag,
      clientVersion,
      toUserId,
      text,
      contextToken,
      clientId: stableClientId,
    }),
    {
      trace: buildWeixinTraceContext(trace, {
        variant: "v2",
        clientId: stableClientId,
        chars: String(text || "").length,
        textHash: hashTraceText(text),
      }),
    },
  );
}

function normalizePlainTextForWeixin(text: unknown): string {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  return trimOuterBlankLines(normalized.replace(/\n\s*\n(?:\s*\n)+/g, "\n\n"));
}

function compactPlainTextForLegacySingleLine(text: unknown): string {
  return trimOuterBlankLines(normalizePlainTextForWeixin(text).replace(/\n\s*\n+/g, "\n"));
}

function chunkReplyText(text: unknown, limit = 3500): string[] {
  const normalized = trimOuterBlankLines(String(text || "").replace(/\r\n/g, "\n"));
  if (!normalized.trim()) {
    return [];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    const splitIndex = Math.max(
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf(" "),
    );
    const cut = splitIndex > limit * 0.4 ? splitIndex + (candidate[splitIndex] === "\n" ? 0 : 1) : limit;
    const chunk = trimOuterBlankLines(remaining.slice(0, cut));
    if (chunk.trim()) {
      chunks.push(chunk);
    }
    remaining = trimOuterBlankLines(remaining.slice(cut));
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.filter(Boolean);
}

function chunkReplyTextForWeixin(text: unknown, limit = 80): string[] {
  const normalized = trimOuterBlankLines(String(text || "").replace(/\r\n/g, "\n"));
  if (!normalized.trim()) {
    return [];
  }

  const boundaries = collectStreamingBoundaries(normalized);
  if (!boundaries.length) {
    return chunkReplyText(normalized, limit);
  }

  const units: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    if (boundary <= start) {
      continue;
    }
    const unit = trimOuterBlankLines(normalized.slice(start, boundary));
    if (unit) {
      units.push(unit);
    }
    start = boundary;
  }

  const tail = trimOuterBlankLines(normalized.slice(start));
  if (tail) {
    units.push(tail);
  }

  if (!units.length) {
    return chunkReplyText(normalized, limit);
  }

  const chunks: string[] = [];
  for (const unit of units) {
    if (unit.length <= limit) {
      chunks.push(unit);
      continue;
    }
    chunks.push(...chunkReplyText(unit, limit));
  }
  return chunks.filter(Boolean);
}

function collectStreamingBoundaries(text: string): number[] {
  const boundaries = new Set<number>();

  const regex = /\n\s*\n+/g;
  let match = regex.exec(text);
  while (match) {
    boundaries.add(match.index + match[0].length);
    match = regex.exec(text);
  }

  const listRegex = /\n(?:(?:[-*])\s+|(?:\d+\.)\s+)/g;
  match = listRegex.exec(text);
  while (match) {
    boundaries.add(match.index + 1);
    match = listRegex.exec(text);
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!/[。！？!?]/.test(char)) {
      continue;
    }

    let end = index + 1;
    while (end < text.length && /["'”’）)\]」』】]/.test(text[end])) {
      end += 1;
    }
    while (end < text.length && /[\t \n]/.test(text[end])) {
      end += 1;
    }
    boundaries.add(end);
  }

  return Array.from(boundaries).sort((left, right) => left - right);
}

async function sendTextChunkWithRetry<T>(
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
      await sleep(retryDelays[attempt]);
    }
  }
  throw lastError || new Error("sendText chunk failed");
}

function getSendRetryDelaysMs(error: unknown): number[] {
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

function buildWeixinTraceContext(trace: unknown, defaults: TraceContext = {}): TraceContext {
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

function normalizeTraceContext(trace: unknown): TraceContext {
  if (!isRecord(trace)) {
    return {};
  }
  return { ...trace };
}

function normalizeTraceText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function logWeixinSendTrace(stage: string, trace: TraceContext): void {
  if (!Boolean(trace?.enabled)) {
    return;
  }
  const parts = [
    `[codeksei] weixin send trace stage=${stage}`,
    `pid=${process.pid}`,
    `trace=${trace.traceId || "(none)"}`,
    `origin=${trace.origin || "adapter.sendText"}`,
    `variant=${trace.variant || "v2"}`,
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
    console.error(parts.join(" "));
    return;
  }
  console.log(parts.join(" "));
}

function hashTraceText(text: unknown): string {
  return crypto.createHash("sha1").update(String(text || ""), "utf8").digest("hex").slice(0, 12);
}

function trimOuterBlankLines(text: unknown): string {
  return String(text || "")
    .replace(/^\s*\n+/g, "")
    .replace(/\n+\s*$/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

void compactPlainTextForLegacySingleLine;
