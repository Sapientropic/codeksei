import { createLegacyWeixinChannelAdapter } from "./legacy";
import { runV2LoginFlow } from "./login-v2";
import { sendWeixinMediaFile } from "./media-send";
import { createWeixinDeliveryFacade, packChunksForWeixinDelivery, sendV2TextChunk } from "./delivery";
import type { ChannelAdapterDescriptor } from "../../../core/app-service-contract";
import type { NormalizedIncomingMessage } from "../../../core/runtime-types";
import type { SendWeixinMediaFileArgs, SendWeixinMediaFileResult } from "./media-types";
import { createWeixinUpdateState, type GetUpdatesResponse, type WeixinAccount, type WeixinConfig } from "./updates";
import {
  describeWeixinAdapterVariant,
  getWeixinRouteRule,
  normalizeWeixinAdapterVariantKey,
} from "./route-matrix";


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
  describe(): ChannelAdapterDescriptor;
  login(): Promise<void>;
  printAccounts(): void;
  resolveAccount(): WeixinAccount;
  getKnownContextTokens(): Record<string, string>;
  loadSyncBuffer(): string;
  saveSyncBuffer(buffer: string): void;
  rememberContextToken(userId: unknown, contextToken: unknown): string;
  getUpdates(args?: GetUpdatesArgs): Promise<GetUpdatesResponse>;
  normalizeIncomingMessage(message: unknown): NormalizedIncomingMessage | null;
  sendText(args: SendTextChunksArgs): Promise<void>;
  sendTyping(args: SendTypingArgs): Promise<void>;
  sendFile(args: SendFileArgs): Promise<SendWeixinMediaFileResult>;
}

export function createWeixinChannelAdapter(config: WeixinConfig): WeixinChannelAdapter {
  const variant = normalizeWeixinAdapterVariantKey(config.weixinAdapterVariant);
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
        variant: describeWeixinAdapterVariant(variant),
        kind: "channel",
        provider: "weixin",
        operations: {
          pollUpdates: true,
          login: true,
          resolveAccount: true,
          visibleTextDelivery: true,
          visibleTypingDelivery: true,
          visibleFileDelivery: true,
        },
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
    normalizeIncomingMessage(message: unknown): NormalizedIncomingMessage | null {
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
      const sendFileRoute = getWeixinRouteRule("sendFile", variant);
      const sendArgs = {
        filePath,
        to: userId,
        contextToken: resolvedToken,
        baseUrl: account.baseUrl,
        token: account.token,
        cdnBaseUrl: normalizeWeixinConfigText(config.weixinCdnBaseUrl),
        apiVariant: sendFileRoute.stack,
        clientVersion: normalizeWeixinConfigText(config.weixinProtocolClientVersion),
      };
      const routeTag = normalizeWeixinConfigText(account.routeTag);
      return sendWeixinMediaFile(routeTag ? { ...sendArgs, routeTag } : sendArgs);
    },
  };
}

function normalizeWeixinConfigText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  packChunksForWeixinDelivery,
  sendV2TextChunk,
};
