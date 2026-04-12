import * as legacyModule from "./legacy";
import * as loginV2Module from "./login-v2";
import * as mediaSendModule from "./media-send";
import { createWeixinDeliveryFacade, packChunksForWeixinDelivery, sendV2TextChunk } from "./delivery";
import { createWeixinUpdateState, type GetUpdatesResponse, type WeixinAccount, type WeixinConfig } from "./updates";

const { createLegacyWeixinChannelAdapter } = legacyModule as {
  createLegacyWeixinChannelAdapter: (config: WeixinConfig) => WeixinChannelAdapter;
};
const { runV2LoginFlow } = loginV2Module as {
  runV2LoginFlow: (config: WeixinConfig) => Promise<unknown>;
};
const { sendWeixinMediaFile } = mediaSendModule as {
  sendWeixinMediaFile: (args: Record<string, unknown>) => Promise<unknown>;
};

interface SendTextChunksArgs {
  userId: string;
  text: string;
  contextToken?: string;
  preserveBlock?: boolean;
  trace?: Record<string, unknown> | null;
}

interface SendTypingArgs {
  userId: string;
  status?: number;
  contextToken?: string;
}

interface SendFileArgs {
  userId: string;
  filePath: string;
  contextToken?: string;
}

interface GetUpdatesArgs {
  syncBuffer?: string;
  timeoutMs?: number;
}

interface WeixinChannelAdapter {
  describe(): Record<string, unknown>;
  login(): Promise<void>;
  printAccounts(): void;
  resolveAccount(): WeixinAccount;
  getKnownContextTokens(): Record<string, string>;
  loadSyncBuffer(): string;
  saveSyncBuffer(buffer: string): void;
  rememberContextToken(userId: unknown, contextToken: unknown): string;
  getUpdates(args?: GetUpdatesArgs): Promise<GetUpdatesResponse>;
  normalizeIncomingMessage(message: unknown): unknown;
  sendText(args: SendTextChunksArgs): Promise<void>;
  sendTyping(args: SendTypingArgs): Promise<void>;
  sendFile(args: SendFileArgs): Promise<unknown>;
}

export function createWeixinChannelAdapter(config: WeixinConfig): WeixinChannelAdapter {
  const variant = normalizeAdapterVariant(config.weixinAdapterVariant);
  if (variant === "legacy") {
    return createLegacyWeixinChannelAdapter(config);
  }

  const updates = createWeixinUpdateState(config);
  const delivery = createWeixinDeliveryFacade({
    config,
    ensureAccount: updates.ensureAccount,
    resolveContextToken: updates.resolveContextToken,
  });

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
      updates.printAccounts();
    },
    resolveAccount() {
      return updates.ensureAccount();
    },
    getKnownContextTokens() {
      return updates.getKnownContextTokens();
    },
    loadSyncBuffer() {
      return updates.loadSyncBuffer();
    },
    saveSyncBuffer(buffer: string) {
      updates.saveSyncBuffer(buffer);
    },
    rememberContextToken(userId: unknown, contextToken: unknown) {
      return updates.rememberContextToken(userId, contextToken);
    },
    async getUpdates(args: GetUpdatesArgs = {}) {
      return updates.getUpdates(args);
    },
    normalizeIncomingMessage(message: unknown) {
      return updates.normalizeIncomingMessage(message);
    },
    async sendText(args: SendTextChunksArgs) {
      await delivery.sendText(args);
    },
    async sendTyping(args: SendTypingArgs) {
      await delivery.sendTyping(args);
    },
    async sendFile({ userId, filePath, contextToken = "" }: SendFileArgs) {
      const account = updates.ensureAccount();
      const resolvedToken = updates.resolveContextToken(userId, contextToken);
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
        clientVersion: normalizeText(config.weixinProtocolClientVersion),
      });
    },
  };
}

function normalizeAdapterVariant(value: unknown): "legacy" | "v2" {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "legacy" ? "legacy" : "v2";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  packChunksForWeixinDelivery,
  sendV2TextChunk,
};
