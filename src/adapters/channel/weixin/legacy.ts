import * as crypto from "node:crypto";

import { getConfig, getUpdates, sendMessage, sendTyping } from "./api";
import {
  buildWeixinTraceContext,
  hashTraceText,
  sendTextChunkWithRetry,
  type TraceContext,
} from "./delivery-trace";
import {
  chunkReplyText,
  chunkReplyTextForWeixin,
  normalizePlainTextForWeixin,
  packChunksForWeixinDelivery,
} from "./delivery-text";
import { listWeixinAccounts, resolveSelectedAccount } from "./account-store";
import { loadPersistedContextTokens, persistContextToken } from "./context-token-store";
import { runLegacyLoginFlow } from "./login-legacy";
import { sendWeixinMediaFile } from "./media-send";
import { normalizeWeixinIncomingMessage } from "./message-utils";
import { loadSyncBuffer, saveSyncBuffer } from "./sync-buffer-store";
import type { SendWeixinMediaFileArgs, SendWeixinMediaFileResult } from "./media-types";

const LONG_POLL_TIMEOUT_MS = 35_000;
const SEND_MESSAGE_CHUNK_INTERVAL_MS = 350;
const WEIXIN_SEND_CHUNK_LIMIT = 80;
const MAX_WEIXIN_CHUNK = 3800;
const WEIXIN_MAX_DELIVERY_MESSAGES = 10;

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
  sendMessageImpl?: typeof sendMessage;
  baseUrl: string;
  token: string;
  toUserId: string;
  text: string;
  contextToken: string;
  clientId?: string;
  trace?: TraceContext | null;
}

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
      const traceDefaults: TraceContext = {
        origin: "adapter.sendText",
        variant: "legacy",
        preserveBlock,
        chunkTotal: sendChunks.length,
      };
      if (typeof config.weixinDeliveryTrace === "boolean") {
        traceDefaults.enabled = config.weixinDeliveryTrace;
      }
      const traceContext = buildWeixinTraceContext(trace, traceDefaults);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export {
  createLegacyWeixinChannelAdapter,
  packChunksForWeixinDelivery,
  sendLegacyTextChunk,
};
