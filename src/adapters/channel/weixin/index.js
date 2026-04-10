const crypto = require("crypto");
const { listWeixinAccounts, resolveSelectedAccount } = require("./account-store");
const { loadPersistedContextTokens, persistContextToken } = require("./context-token-store");
const { runV2LoginFlow } = require("./login-v2");
const {
  getConfigV2,
  getUpdatesV2,
  sendTextV2,
  sendTypingV2,
} = require("./api-v2");
const { createLegacyWeixinChannelAdapter } = require("./legacy");
const { createInboundFilter } = require("./message-utils-v2");
const { sendWeixinMediaFile } = require("./media-send");
const { loadSyncBuffer, saveSyncBuffer } = require("./sync-buffer-store");

const LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_WEIXIN_CHUNK = 3800;
const SEND_MESSAGE_CHUNK_INTERVAL_MS = 350;
const WEIXIN_SEND_CHUNK_LIMIT = 80;
const WEIXIN_MAX_DELIVERY_MESSAGES = 10;
const SEND_RETRY_DELAYS_MS = [900, 1800];

function createWeixinChannelAdapter(config) {
  const variant = normalizeAdapterVariant(config.weixinAdapterVariant);
  if (variant === "legacy") {
    return createLegacyWeixinChannelAdapter(config);
  }

  let selectedAccount = null;
  let contextTokenCache = null;
  const inboundFilter = createInboundFilter();

  function ensureAccount() {
    if (!selectedAccount) {
      selectedAccount = resolveSelectedAccount(config);
      contextTokenCache = loadPersistedContextTokens(config, selectedAccount.accountId);
    }
    return selectedAccount;
  }

  function ensureContextTokenCache() {
    if (!contextTokenCache) {
      const account = ensureAccount();
      contextTokenCache = loadPersistedContextTokens(config, account.accountId);
    }
    return contextTokenCache;
  }

  function rememberContextToken(userId, contextToken) {
    const account = ensureAccount();
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    const normalizedToken = typeof contextToken === "string" ? contextToken.trim() : "";
    if (!normalizedUserId || !normalizedToken) {
      return "";
    }
    contextTokenCache = persistContextToken(config, account.accountId, normalizedUserId, normalizedToken);
    return normalizedToken;
  }

  function resolveContextToken(userId, explicitToken = "") {
    const normalizedExplicitToken = typeof explicitToken === "string" ? explicitToken.trim() : "";
    if (normalizedExplicitToken) {
      return normalizedExplicitToken;
    }
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) {
      return "";
    }
    return ensureContextTokenCache()[normalizedUserId] || "";
  }

  function sendTextChunks({ userId, text, contextToken = "", preserveBlock = false }) {
    const account = ensureAccount();
    const resolvedToken = resolveContextToken(userId, contextToken);
    if (!resolvedToken) {
      throw new Error(`缺少 context_token，无法回复用户 ${userId}`);
    }
    const content = String(text || "");
    if (!content.trim()) {
      return Promise.resolve();
    }
    const sendChunks = preserveBlock
      ? splitUtf8(compactPlainTextForWeixin(content) || "已完成。", MAX_WEIXIN_CHUNK)
      : packChunksForWeixinDelivery(
        chunkReplyTextForWeixin(content, WEIXIN_SEND_CHUNK_LIMIT).length
          ? chunkReplyTextForWeixin(content, WEIXIN_SEND_CHUNK_LIMIT)
          : ["已完成。"],
        WEIXIN_MAX_DELIVERY_MESSAGES,
        MAX_WEIXIN_CHUNK
      );
    return sendChunks.reduce((promise, chunk, index) => promise
      .then(() => {
        const compactChunk = compactPlainTextForWeixin(chunk) || "已完成。";
        return sendV2TextChunk({
          baseUrl: account.baseUrl,
          token: account.token,
          routeTag: account.routeTag,
          clientVersion: config.weixinProtocolClientVersion,
          toUserId: userId,
          text: compactChunk,
          contextToken: resolvedToken,
        });
      })
      .then(() => {
        if (index < sendChunks.length - 1) {
          return sleep(SEND_MESSAGE_CHUNK_INTERVAL_MS);
        }
        return null;
      }), Promise.resolve());
  }

  return {
    describe() {
      return {
        id: "weixin",
        variant: "v2",
        kind: "channel",
        stateDir: config.stateDir,
        baseUrl: config.weixinBaseUrl,
        accountsDir: config.accountsDir,
        syncBufferDir: config.syncBufferDir,
        protocolClientVersion: config.weixinProtocolClientVersion,
        routeTag: config.weixinRouteTag,
      };
    },
    async login() {
      await runV2LoginFlow(config);
    },
    printAccounts() {
      const accounts = listWeixinAccounts(config);
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
    saveSyncBuffer(buffer) {
      const account = ensureAccount();
      saveSyncBuffer(config, account.accountId, buffer);
    },
    rememberContextToken,
    async getUpdates({ syncBuffer = "", timeoutMs = LONG_POLL_TIMEOUT_MS } = {}) {
      const account = ensureAccount();
      const response = await getUpdatesV2({
        baseUrl: account.baseUrl,
        token: account.token,
        getUpdatesBuf: syncBuffer,
        timeoutMs,
        routeTag: account.routeTag,
        clientVersion: config.weixinProtocolClientVersion,
      });
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
    normalizeIncomingMessage(message) {
      const account = ensureAccount();
      return inboundFilter.normalize(message, config, account.accountId);
    },
    async sendText({ userId, text, contextToken = "", preserveBlock = false }) {
      await sendTextChunks({ userId, text, contextToken, preserveBlock });
    },
    async sendTyping({ userId, status = 1, contextToken = "" }) {
      const account = ensureAccount();
      const resolvedToken = resolveContextToken(userId, contextToken);
      if (!resolvedToken) {
        return;
      }
      const configResponse = await getConfigV2({
        baseUrl: account.baseUrl,
        token: account.token,
        routeTag: account.routeTag,
        clientVersion: config.weixinProtocolClientVersion,
        ilinkUserId: userId,
        contextToken: resolvedToken,
      }).catch(() => null);
      const typingTicket = typeof configResponse?.typing_ticket === "string"
        ? configResponse.typing_ticket.trim()
        : "";
      if (!typingTicket) {
        return;
      }
      await sendTypingV2({
        baseUrl: account.baseUrl,
        token: account.token,
        routeTag: account.routeTag,
        clientVersion: config.weixinProtocolClientVersion,
        body: {
          ilink_user_id: userId,
          typing_ticket: typingTicket,
          status,
        },
      });
    },
    async sendFile({ userId, filePath, contextToken = "" }) {
      const account = ensureAccount();
      const resolvedToken = resolveContextToken(userId, contextToken);
      if (!resolvedToken) {
        throw new Error(`缺少 context_token，无法发送文件给用户 ${userId}`);
      }
      // Text polling/sending lives on the v2 stack, but attachments intentionally
      // stay on the legacy media API. The original repo never moved sendFile onto
      // v2, and live timeline screenshot failures ("getUploadUrl returned no
      // upload_param") only appeared after we forced media onto the v2 headers.
      // Keep this split explicit so future "cleanup" work does not silently route
      // screenshots/files back onto the broken stack.
      return sendWeixinMediaFile({
        filePath,
        to: userId,
        contextToken: resolvedToken,
        baseUrl: account.baseUrl,
        token: account.token,
        cdnBaseUrl: config.weixinCdnBaseUrl,
        apiVariant: "legacy",
        routeTag: account.routeTag,
        clientVersion: config.weixinProtocolClientVersion,
      });
    },
  };
}

function normalizeAdapterVariant(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "legacy" ? "legacy" : "v2";
}

function splitUtf8(text, maxRunes) {
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

function compactPlainTextForWeixin(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  return trimOuterBlankLines(normalized.replace(/\n\s*\n+/g, "\n"));
}

function chunkReplyText(text, limit = 3500) {
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

function chunkReplyTextForWeixin(text, limit = 80) {
  const normalized = trimOuterBlankLines(String(text || "").replace(/\r\n/g, "\n"));
  if (!normalized.trim()) {
    return [];
  }

  const boundaries = collectStreamingBoundaries(normalized);
  if (!boundaries.length) {
    return chunkReplyText(normalized, limit);
  }

  const units = [];
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

  const chunks = [];
  for (const unit of units) {
    if (unit.length <= limit) {
      chunks.push(unit);
      continue;
    }
    chunks.push(...chunkReplyText(unit, limit));
  }
  return chunks.filter(Boolean);
}

function packChunksForWeixinDelivery(chunks, maxMessages = 10, maxChunkChars = 3800) {
  const normalizedChunks = Array.isArray(chunks)
    ? chunks.map((chunk) => compactPlainTextForWeixin(chunk)).filter(Boolean)
    : [];
  if (!normalizedChunks.length || normalizedChunks.length <= maxMessages) {
    return normalizedChunks;
  }

  const packed = normalizedChunks.slice(0, Math.max(0, maxMessages - 1));
  const tailChunks = normalizedChunks.slice(Math.max(0, maxMessages - 1));
  if (!tailChunks.length) {
    return packed;
  }

  const tailText = compactPlainTextForWeixin(tailChunks.join("\n")) || "已完成。";
  if (tailText.length <= maxChunkChars) {
    packed.push(tailText);
    return packed;
  }

  const tailHardChunks = splitUtf8(tailText, maxChunkChars);
  if (tailHardChunks.length === 1) {
    packed.push(tailHardChunks[0]);
    return packed;
  }

  const preserveCount = Math.max(0, maxMessages - tailHardChunks.length);
  const preserved = normalizedChunks.slice(0, preserveCount);
  const rebundledTail = normalizedChunks.slice(preserveCount);
  const groupedTail = [];
  let current = "";
  for (const chunk of rebundledTail) {
    const joined = current ? `${current}\n${chunk}` : chunk;
    if (current && joined.length > maxChunkChars) {
      groupedTail.push(current);
      current = chunk;
      continue;
    }
    current = joined;
  }
  if (current) {
    groupedTail.push(current);
  }

  const normalizedGroupedTail = groupedTail.map((item) => compactPlainTextForWeixin(item) || "已完成。");
  if (preserved.length + normalizedGroupedTail.length <= maxMessages) {
    return preserved.concat(normalizedGroupedTail);
  }

  // Never silently drop the tail of a long reply. If grouping by semantic
  // chunk boundaries still overflows the per-message budget, fall back to hard
  // UTF-8 splits of the already-joined tail so the full answer is still sent.
  return preserved.concat(tailHardChunks.slice(0, Math.max(1, maxMessages - preserved.length)));
}

function collectStreamingBoundaries(text) {
  const boundaries = new Set();

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

async function sendTextChunkWithRetry(send) {
  let lastError = null;
  for (let attempt = 0; attempt <= SEND_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      lastError = error;
      if (!isRetryableSendError(error) || attempt >= SEND_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await sleep(SEND_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError || new Error("sendText chunk failed");
}

function sendV2TextChunk({
  sendTextImpl = sendTextV2,
  baseUrl,
  token,
  routeTag = "",
  clientVersion = "",
  toUserId,
  text,
  contextToken,
  clientId = "",
}) {
  const stableClientId = String(clientId || "").trim() || `cb-${crypto.randomUUID()}`;
  return sendTextChunkWithRetry(() => sendTextImpl({
    baseUrl,
    token,
    routeTag,
    clientVersion,
    toUserId,
    text,
    contextToken,
    clientId: stableClientId,
  }));
}

function isRetryableSendError(error) {
  const message = String(error?.message || error || "");
  return message.includes("ret=-2")
    || message.includes("AbortError")
    || message.includes("aborted")
    || message.includes("fetch failed")
    || message.includes("ECONNRESET")
    || message.includes("ETIMEDOUT")
    || /http 5\d\d/.test(message);
}

function trimOuterBlankLines(text) {
  return String(text || "")
    .replace(/^\s*\n+/g, "")
    .replace(/\n+\s*$/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createWeixinChannelAdapter,
  sendV2TextChunk,
};
