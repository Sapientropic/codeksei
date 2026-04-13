import { normalizeText } from "../../../core/text-normalization";
import * as crypto from "node:crypto";
import {
  getConfigV2,
  sendTextV2,
  sendTypingV2,
  type GetConfigV2Args,
  type GetConfigV2Response,
  type SendTextV2Args,
  type SendTypingV2Args,
  type WeixinApiResponse,
} from "./api-v2";
import {
  buildWeixinTraceContext,
  hashTraceText,
  isRecord,
  sendTextChunkWithRetry,
  type TraceContext,
} from "./delivery-trace";
import {
  chunkReplyText,
  chunkReplyTextForWeixin,
  normalizePlainTextForWeixin,
  packChunksForWeixinDelivery,
} from "./delivery-text";

const MAX_WEIXIN_CHUNK = 3800;
const SEND_MESSAGE_CHUNK_INTERVAL_MS = 350;
const WEIXIN_SEND_CHUNK_LIMIT = 80;
const WEIXIN_MAX_DELIVERY_MESSAGES = 10;

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
        const chunkArgs: SendV2TextChunkArgs = {
          baseUrl: account.baseUrl,
          token: account.token,
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
        };
        const routeTag = normalizeText(account.routeTag);
        if (routeTag) {
          chunkArgs.routeTag = routeTag;
        }
        return sendV2TextChunk(chunkArgs).then(() => undefined);
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
    const configArgs: GetConfigV2Args = {
      baseUrl: account.baseUrl,
      token: account.token,
      clientVersion: normalizeText(config.weixinProtocolClientVersion),
      ilinkUserId: userId,
      contextToken: resolvedToken,
    };
    const routeTag = normalizeText(account.routeTag);
    if (routeTag) {
      configArgs.routeTag = routeTag;
    }
    const configResponse = await getConfigV2(configArgs).catch((): GetConfigV2Response | null => null);
    const typingTicket = normalizeText(isRecord(configResponse) ? configResponse.typing_ticket : "");
    if (!typingTicket) {
      return;
    }
    const typingArgs: SendTypingV2Args = {
      baseUrl: account.baseUrl,
      token: account.token,
      clientVersion: normalizeText(config.weixinProtocolClientVersion),
      body: {
        ilink_user_id: userId,
        typing_ticket: typingTicket,
        status,
      },
    };
    if (routeTag) {
      typingArgs.routeTag = routeTag;
    }
    await sendTypingV2(typingArgs);
  }

  return {
    sendText: sendTextChunks,
    sendTyping,
  };
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

export {
  packChunksForWeixinDelivery,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

