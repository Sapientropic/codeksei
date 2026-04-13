import type { NormalizedIncomingMessage, UnknownRecord } from "../../../core/runtime-types";
import { listWeixinAccounts, resolveSelectedAccount } from "./account-store";
import { loadPersistedContextTokens, persistContextToken } from "./context-token-store";
import { getUpdatesV2 } from "./api-v2";
import { createInboundFilter } from "./message-utils-v2";
import { loadSyncBuffer, saveSyncBuffer } from "./sync-buffer-store";

const LONG_POLL_TIMEOUT_MS = 35_000;

export interface WeixinConfig extends Record<string, unknown> {
  stateDir: string;
  accountsDir?: string;
  syncBufferDir?: string;
  weixinBaseUrl?: string;
  weixinRouteTag?: string;
  weixinProtocolClientVersion?: string;
  weixinAdapterVariant?: string;
}

export interface WeixinAccount {
  accountId: string;
  baseUrl: string;
  token: string;
  routeTag?: string;
  userId?: string;
  savedAt?: string;
}

export interface GetUpdatesResponse extends UnknownRecord {
  get_updates_buf?: unknown;
  msgs?: unknown[];
}

interface GetUpdatesArgs {
  syncBuffer?: string;
  timeoutMs?: number;
}

export function createWeixinUpdateState(config: WeixinConfig) {
  let selectedAccount: WeixinAccount | null = null;
  let contextTokenCache: Record<string, string> | null = null;
  const inboundFilter = createInboundFilter();

  function ensureAccount(): WeixinAccount {
    if (!selectedAccount) {
      selectedAccount = resolveSelectedAccount(config);
      contextTokenCache = loadPersistedContextTokens(config, selectedAccount.accountId);
    }
    return selectedAccount;
  }

  function ensureContextTokenCache(): Record<string, string> {
    if (!contextTokenCache) {
      const account = ensureAccount();
      contextTokenCache = loadPersistedContextTokens(config, account.accountId);
    }
    return contextTokenCache;
  }

  function rememberContextToken(userId: unknown, contextToken: unknown): string {
    const account = ensureAccount();
    const normalizedUserId = normalizeText(userId);
    const normalizedToken = normalizeText(contextToken);
    if (!normalizedUserId || !normalizedToken) {
      return "";
    }
    contextTokenCache = persistContextToken(config, account.accountId, normalizedUserId, normalizedToken);
    return normalizedToken;
  }

  function resolveContextToken(userId: unknown, explicitToken = ""): string {
    const normalizedExplicitToken = normalizeText(explicitToken);
    if (normalizedExplicitToken) {
      return normalizedExplicitToken;
    }
    const normalizedUserId = normalizeText(userId);
    if (!normalizedUserId) {
      return "";
    }
    return ensureContextTokenCache()[normalizedUserId] || "";
  }

  async function getUpdates({
    syncBuffer = "",
    timeoutMs = LONG_POLL_TIMEOUT_MS,
  }: GetUpdatesArgs = {}): Promise<GetUpdatesResponse> {
    const account = ensureAccount();
    const getUpdatesArgs = {
      baseUrl: account.baseUrl,
      token: account.token,
      getUpdatesBuf: syncBuffer,
      timeoutMs,
      clientVersion: normalizeText(config.weixinProtocolClientVersion),
    };
    const routeTag = normalizeText(account.routeTag);
    const response = await getUpdatesV2(routeTag ? { ...getUpdatesArgs, routeTag } : getUpdatesArgs) as GetUpdatesResponse;
    if (typeof response?.get_updates_buf === "string" && response.get_updates_buf.trim()) {
      saveSyncBuffer(config, account.accountId, response.get_updates_buf.trim());
    }
    const messages = Array.isArray(response?.msgs) ? response.msgs : [];
    for (const message of messages) {
      const userId = isRecord(message) ? normalizeText(message.from_user_id) : "";
      const contextToken = isRecord(message) ? normalizeText(message.context_token) : "";
      if (userId && contextToken) {
        rememberContextToken(userId, contextToken);
      }
    }
    return response;
  }

  function printAccounts(): void {
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
  }

  function normalizeIncomingMessage(message: unknown): NormalizedIncomingMessage | null {
    const account = ensureAccount();
    return inboundFilter.normalize(message, config, account.accountId);
  }

  function readSyncBuffer(): string {
    const account = ensureAccount();
    return loadSyncBuffer(config, account.accountId);
  }

  function writeSyncBuffer(buffer: string): void {
    const account = ensureAccount();
    saveSyncBuffer(config, account.accountId, buffer);
  }

  function getKnownContextTokens(): Record<string, string> {
    return { ...ensureContextTokenCache() };
  }

  return {
    ensureAccount,
    getKnownContextTokens,
    getUpdates,
    loadSyncBuffer: readSyncBuffer,
    normalizeIncomingMessage,
    printAccounts,
    rememberContextToken,
    resolveContextToken,
    saveSyncBuffer: writeSyncBuffer,
  };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
