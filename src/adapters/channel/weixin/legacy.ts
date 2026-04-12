const crypto = require("crypto");
const { listWeixinAccounts } = require("./account-store");
const { resolveSelectedAccount } = require("./account-store");
const { loadPersistedContextTokens, persistContextToken } = require("./context-token-store");
const { runLegacyLoginFlow } = require("./login-legacy");
const { getConfig, getUpdates, sendMessage, sendTyping } = require("./api");
const { sendWeixinMediaFile } = require("./media-send");
const { normalizeWeixinIncomingMessage } = require("./message-utils");
const { loadSyncBuffer, saveSyncBuffer } = require("./sync-buffer-store");
import type { SendWeixinMediaFileArgs, SendWeixinMediaFileResult } from "./media-types";

const LONG_POLL_TIMEOUT_MS = 35_000;
const SEND_MESSAGE_CHUNK_INTERVAL_MS = 350;
const WEIXIN_SEND_CHUNK_LIMIT = 80;
const MAX_WEIXIN_CHUNK = 3800;
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

interface LegacyWeixinConfig extends Record<string, unknown> {
  stateDir?: string;
  weixinBaseUrl?: string;
  accountsDir?: string;
  syncBufferDir?: string;
  weixinCdnBaseUrl?: string;
  weixinDeliveryTrace?: boolean;
}

interface LegacyWeixinAccount {
  accountId: string;
  token: string;
  baseUrl: string;
  routeTag?: string;
  userId?: string;
  savedAt?: string;
}

interface LegacyGetUpdatesArgs {
  syncBuffer?: string;
  timeoutMs?: number;
}

interface LegacyGetUpdatesResponse extends Record<string, unknown> {
  get_updates_buf?: unknown;
  msgs?: Array<Record<string, unknown>>;
}

interface LegacySendTextArgs {
  userId: string;
  text: string;
  contextToken?: string;
  preserveBlock?: boolean;
  trace?: TraceContext | null;
}

interface LegacySendTypingArgs {
  userId: string;
  status?: number;
  contextToken?: string;
}

interface LegacySendFileArgs {
  userId: string;
  filePath: string;
  contextToken?: string;
}

interface SendLegacyTextChunkArgs {
  sendMessageImpl?: (args: Record<string, unknown>) => Promise<unknown>;
  baseUrl: string;
  token: string;
  toUserId: string;
  text: string;
  contextToken: string;
  clientId?: string;
  trace?: TraceContext | null;
}

type RetrySendCallback<T> = () => Promise<T>;

const sendWeixinMediaFileImpl = sendWeixinMediaFile as (
  args: SendWeixinMediaFileArgs,
) => Promise<SendWeixinMediaFileResult>;

function createLegacyWeixinChannelAdapter(config: LegacyWeixinConfig) {
  let selectedAccount: LegacyWeixinAccount | null = null;
  let contextTokenCache: Record<string, string> | null = null;

  function ensureAccount(): LegacyWeixinAccount {
    if (!selectedAccount) {
      selectedAccount = resolveSelectedAccount(config) as LegacyWeixinAccount;
      contextTokenCache = loadPersistedContextTokens(config, selectedAccount.accountId);
    }
    return selectedAccount;
  }

  function ensureContextTokenCache(): Record<string, string> {
    if (!contextTokenCache) {
      const account = ensureAccount();
      contextTokenCache = loadPersistedContextTokens(config, account.accountId);
    }
    return contextTokenCache || {};
  }

  function rememberContextToken(userId: unknown, contextToken: unknown): string {
    const account = ensureAccount();
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    const normalizedToken = typeof contextToken === "string" ? contextToken.trim() : "";
    if (!normalizedUserId || !normalizedToken) {
      return "";
    }
    contextTokenCache = persistContextToken(config, account.accountId, normalizedUserId, normalizedToken);
    return normalizedToken;
  }

  function resolveContextToken(userId: unknown, explicitToken: string = ""): string {
    const normalizedExplicitToken = typeof explicitToken === "string" ? explicitToken.trim() : "";
    if (normalizedExplicitToken) {
      return normalizedExplicitToken;
    }
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) {
      return "";
    }
    return (ensureContextTokenCache() || {})[normalizedUserId] || "";
  }

  return {
    describe() {
      return {
        id: "weixin",
        variant: "legacy",
        kind: "channel",
        stateDir: config.stateDir,
        baseUrl: config.weixinBaseUrl,
        accountsDir: config.accountsDir,
        syncBufferDir: config.syncBufferDir,
      };
    },
    async login() {
      await runLegacyLoginFlow(config);
    },
    printAccounts() {
      const accounts = listWeixinAccounts(config) as LegacyWeixinAccount[];
      if (!accounts.length) {
        console.log("当前没有已保存的微信账号。先执行 `npm run login`。");
        return;
      }
      console.log("已保存账号：");
      for (const account of accounts) {
        console.log(`- ${account.accountId}`);
        console.log(`  userId: ${account.userId || "(unknown)"}`);
        console.log(`  baseUrl: ${account.baseUrl || config.weixinBaseUrl}`);
        if (account.routeTag) {
          console.log(`  routeTag: ${account.routeTag}`);
        }
        console.log(`  savedAt: ${account.savedAt || "(unknown)"}`);
      }
    },
    resolveAccount() {
      return ensureAccount();
    },
    getKnownContextTokens() {
      return { ...ensureContextTokenCache() };
    },
    loadSyncBuffer() {
      const account = ensureAccount();
      return loadSyncBuffer(config, account.accountId);
    },
    saveSyncBuffer(buffer: string) {
      const account = ensureAccount();
      saveSyncBuffer(config, account.accountId, buffer);
    },
    rememberContextToken,
    async getUpdates({ syncBuffer = "", timeoutMs = LONG_POLL_TIMEOUT_MS }: LegacyGetUpdatesArgs = {}): Promise<LegacyGetUpdatesResponse> {
      const account = ensureAccount();
      const response = await getUpdates({
        baseUrl: account.baseUrl,
        token: account.token,
        get_updates_buf: syncBuffer,
        timeoutMs,
      }) as LegacyGetUpdatesResponse;
      if (typeof response?.get_updates_buf === "string" && response.get_updates_buf.trim()) {
        this.saveSyncBuffer(response.get_updates_buf.trim());
      }
      const messages = Array.isArray(response?.msgs) ? response.msgs : [];
      for (const message of messages) {
        const userId = typeof message?.from_user_id === "string" ? message.from_user_id.trim() : "";
        const contextToken = typeof message?.context_token === "string" ? message.context_token.trim() : "";
        if (userId && contextToken) {
          rememberContextToken(userId, contextToken);
        }
      }
      return response;
    },
    normalizeIncomingMessage(message: unknown) {
      const account = ensureAccount();
      return normalizeWeixinIncomingMessage(message, config, account.accountId);
    },
    async sendText({ userId, text, contextToken = "", preserveBlock = false, trace = null }: LegacySendTextArgs): Promise<void> {
      const account = ensureAccount();
      const resolvedToken = resolveContextToken(userId, contextToken);
      if (!resolvedToken) {
        throw new Error(`缺少 context_token，无法回复用户 ${userId}`);
      }
      const content = String(text || "");
      const normalizedContent = normalizePlainTextForWeixin(content) || "已完成。";
      const chunkCandidates = preserveBlock
        ? chunkReplyText(normalizedContent, MAX_WEIXIN_CHUNK)
        : chunkReplyTextForWeixin(normalizedContent, WEIXIN_SEND_CHUNK_LIMIT);
      const sendChunks = packChunksForWeixinDelivery(
        chunkCandidates.length ? chunkCandidates : [normalizedContent],
        WEIXIN_MAX_DELIVERY_MESSAGES,
        MAX_WEIXIN_CHUNK
      );
      const traceContext = buildWeixinTraceContext(trace, {
        enabled: config.weixinDeliveryTrace,
        origin: "adapter.sendText",
        variant: "legacy",
        preserveBlock,
        chunkTotal: sendChunks.length,
      });
      for (let index = 0; index < sendChunks.length; index += 1) {
        const compactChunk = normalizePlainTextForWeixin(sendChunks[index]) || "已完成。";
        const clientId = crypto.randomUUID();
        await sendLegacyTextChunk({
          baseUrl: account.baseUrl,
          token: account.token,
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
        });
        if (index < sendChunks.length - 1) {
          await sleep(SEND_MESSAGE_CHUNK_INTERVAL_MS);
        }
      }
    },
    async sendTyping({ userId, status = 1, contextToken = "" }: LegacySendTypingArgs): Promise<void> {
      const account = ensureAccount();
      const resolvedToken = resolveContextToken(userId, contextToken);
      if (!resolvedToken) {
        return;
      }
      const configResponse = await getConfig({
        baseUrl: account.baseUrl,
        token: account.token,
        ilinkUserId: userId,
        contextToken: resolvedToken,
      }).catch(() => null);
      const typingTicket = typeof configResponse?.typing_ticket === "string"
        ? configResponse.typing_ticket.trim()
        : "";
      if (!typingTicket) {
        return;
      }
      await sendTyping({
        baseUrl: account.baseUrl,
        token: account.token,
        body: {
          ilink_user_id: userId,
          typing_ticket: typingTicket,
          status,
        },
      });
    },
    async sendFile({ userId, filePath, contextToken = "" }: LegacySendFileArgs): Promise<SendWeixinMediaFileResult> {
      const account = ensureAccount();
      const resolvedToken = resolveContextToken(userId, contextToken);
      if (!resolvedToken) {
        throw new Error(`缺少 context_token，无法发送文件给用户 ${userId}`);
      }
      return sendWeixinMediaFileImpl({
        filePath,
        to: userId,
        contextToken: resolvedToken,
        baseUrl: account.baseUrl,
        token: account.token,
        cdnBaseUrl: typeof config.weixinCdnBaseUrl === "string" ? config.weixinCdnBaseUrl : "",
      });
    },
  };
}

function splitUtf8(text: string, maxRunes: number): string[] {
  const runes = Array.from(String(text || ""));
  if (!runes.length || runes.length <= maxRunes) {
    return [String(text || "")];
  }
  const chunks = [];
  while (runes.length) {
    chunks.push(runes.splice(0, maxRunes).join(""));
  }
  return chunks;
}

function normalizePlainTextForWeixin(text: unknown): string {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  return trimOuterBlankLines(normalized.replace(/\n\s*\n(?:\s*\n)+/g, "\n\n"));
}

function compactPlainTextForLegacySingleLine(text: unknown): string {
  return trimOuterBlankLines(normalizePlainTextForWeixin(text).replace(/\n\s*\n+/g, "\n"));
}

function chunkReplyText(text: unknown, limit: number = 3500): string[] {
  const normalized = trimOuterBlankLines(String(text || "").replace(/\r\n/g, "\n"));
  if (!normalized.trim()) {
    return [];
  }

  const chunks = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    const splitIndex = Math.max(
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf(" ")
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

function chunkReplyTextForWeixin(text: unknown, limit: number = 80): string[] {
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

function packChunksForWeixinDelivery(chunks: string[], maxMessages: number = 10, maxChunkChars: number = 3800): string[] {
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

  void maxMessages;
  return packed;
}

function collectStreamingBoundaries(text: string): number[] {
  const boundaries: Set<number> = new Set();

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
  send: RetrySendCallback<T>,
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
        error: formatErrorMessage(error),
      });
      if (!retryable) {
        throw error;
      }
      await sleep(retryDelays[attempt]);
    }
  }
  throw lastError || new Error("sendText chunk failed");
}

function sendLegacyTextChunk({
  sendMessageImpl = sendMessage,
  baseUrl,
  token,
  toUserId,
  text,
  contextToken,
  clientId = "",
  trace = null,
}: SendLegacyTextChunkArgs): Promise<unknown> {
  const stableClientId = String(clientId || "").trim() || crypto.randomUUID();
  return sendTextChunkWithRetry(
    () => sendMessageImpl({
      baseUrl,
      token,
      body: {
        msg: {
          client_id: stableClientId,
          from_user_id: "",
          to_user_id: toUserId,
          message_type: 2,
          message_state: 2,
          item_list: [
            {
              type: 1,
              text_item: { text: String(text || "") },
            },
          ],
          context_token: contextToken,
        },
      },
    }),
    {
      trace: buildWeixinTraceContext(trace, {
        variant: "legacy",
        clientId: stableClientId,
        chars: String(text || "").length,
        textHash: hashTraceText(text),
      }),
    }
  );
}

function getSendRetryDelaysMs(error: unknown): number[] {
  const message = formatErrorMessage(error);
  // Legacy sendmessage sees the same `ret=-2` ambiguity as v2. Retry it once
  // with the same client_id so we bias toward complete delivery without
  // turning one flaky send into a burst of duplicate assistant bubbles.
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
  if (!trace || typeof trace !== "object") {
    return {};
  }
  return { ...(trace as Record<string, unknown>) };
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
    `variant=${trace.variant || "legacy"}`,
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

module.exports = {
  createLegacyWeixinChannelAdapter,
  packChunksForWeixinDelivery,
  sendLegacyTextChunk,
};

export {};
