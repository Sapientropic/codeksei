import * as crypto from "node:crypto";
import * as protocolModule from "./protocol";
import * as brandingModule from "../../../core/branding";

const { buildJsonHeaders } = protocolModule as {
  buildJsonHeaders: (args: {
    body: string;
    token?: string;
    routeTag?: string;
    clientVersion?: string;
  }) => Record<string, string>;
};
const { PRIMARY_CHANNEL_VERSION } = brandingModule as {
  PRIMARY_CHANNEL_VERSION: string;
};

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY_BYTES = 64 << 20;
const CHANNEL_VERSION = PRIMARY_CHANNEL_VERSION;

interface WeixinBaseInfo {
  channel_version: string;
}

export interface WeixinApiResponse extends Record<string, unknown> {
  ret?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
}

export interface GetUpdatesV2Args extends Record<string, unknown> {
  baseUrl: string;
  token: string;
  getUpdatesBuf?: string;
  timeoutMs?: number;
  routeTag?: string;
  clientVersion?: string;
}

export interface GetUpdatesV2Response extends WeixinApiResponse {
  msgs: unknown[];
  get_updates_buf: string;
}

export interface SendMessageV2Args extends Record<string, unknown> {
  baseUrl: string;
  token: string;
  body: Record<string, unknown>;
  routeTag?: string;
  clientVersion?: string;
  timeoutMs?: number;
}

export interface SendTextV2Args extends Record<string, unknown> {
  baseUrl: string;
  token: string;
  toUserId: string;
  text: string;
  contextToken: string;
  clientId?: string;
  routeTag?: string;
  clientVersion?: string;
}

export interface GetConfigV2Args extends Record<string, unknown> {
  baseUrl: string;
  token: string;
  ilinkUserId: string;
  contextToken: string;
  routeTag?: string;
  clientVersion?: string;
  timeoutMs?: number;
}

export interface GetConfigV2Response extends WeixinApiResponse {
  typing_ticket?: unknown;
}

export interface SendTypingV2Args extends Record<string, unknown> {
  baseUrl: string;
  token: string;
  body: Record<string, unknown>;
  routeTag?: string;
  clientVersion?: string;
  timeoutMs?: number;
}

export interface GetUploadUrlV2Args extends Record<string, unknown> {
  baseUrl: string;
  token: string;
  routeTag?: string;
  clientVersion?: string;
  timeoutMs?: number;
}

export interface GetUploadUrlV2Response extends WeixinApiResponse {
  upload_param?: unknown;
}

interface ApiPostArgs {
  baseUrl: string;
  endpoint: string;
  token: string;
  body: string;
  timeoutMs?: number;
  label: string;
  routeTag?: string;
  clientVersion?: string;
}

function buildBaseInfo(): WeixinBaseInfo {
  return { channel_version: CHANNEL_VERSION };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

async function apiPost({
  baseUrl,
  endpoint,
  token,
  body,
  timeoutMs = 0,
  label,
  routeTag = "",
  clientVersion = "",
}: ApiPostArgs): Promise<string> {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl)).toString();
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? timeoutMs : DEFAULT_API_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout + 5_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildJsonHeaders({ body, token, routeTag, clientVersion }),
      body,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BODY_BYTES) {
      throw new Error(`${label} response body exceeds ${MAX_RESPONSE_BODY_BYTES} bytes`);
    }
    if (!response.ok) {
      throw new Error(`${label} http ${response.status}: ${truncateForLog(raw, 512)}`);
    }
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson<T extends Record<string, unknown>>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${truncateForLog(raw, 256)}`);
  }
}

function assertApiSuccess<T extends WeixinApiResponse>(parsed: T, label: string): T {
  const ret = normalizeErrorCode(parsed?.ret);
  const errcode = normalizeErrorCode(parsed?.errcode);
  if ((hasErrorCode(parsed?.ret) && ret !== 0) || (hasErrorCode(parsed?.errcode) && errcode !== 0)) {
    throw new Error(`${label} ret=${ret ?? ""} errcode=${errcode ?? ""} errmsg=${parsed?.errmsg ?? ""}`);
  }
  return parsed;
}

function truncateForLog(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : String(value || "");
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function getUpdatesV2({
  baseUrl,
  token,
  getUpdatesBuf = "",
  timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS,
  routeTag = "",
  clientVersion = "",
}: GetUpdatesV2Args): Promise<GetUpdatesV2Response> {
  const payload = JSON.stringify({
    get_updates_buf: getUpdatesBuf,
    base_info: buildBaseInfo(),
  });
  try {
    const raw = await apiPost({
      baseUrl,
      endpoint: "ilink/bot/getupdates",
      token,
      body: payload,
      timeoutMs,
      label: "getUpdates",
      routeTag,
      clientVersion,
    });
    return parseJson<GetUpdatesV2Response>(raw, "getUpdates");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
    }
    if (formatErrorMessage(error).includes("aborted")) {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
    }
    throw error;
  }
}

async function sendTextV2({
  baseUrl,
  token,
  toUserId,
  text,
  contextToken,
  clientId,
  routeTag = "",
  clientVersion = "",
}: SendTextV2Args): Promise<WeixinApiResponse> {
  if (!String(contextToken || "").trim()) {
    throw new Error("weixin-v2 sendText requires contextToken");
  }
  const itemList: Array<Record<string, unknown>> = [];
  if (String(text || "").trim()) {
    itemList.push({
      type: 1,
      text_item: { text: String(text) },
    });
  }
  if (!itemList.length) {
    throw new Error("weixin-v2 sendText requires non-empty text");
  }
  return sendMessageV2({
    baseUrl,
    token,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: clientId || `cb-${crypto.randomUUID()}`,
        message_type: 2,
        message_state: 2,
        item_list: itemList,
        context_token: contextToken,
      },
    },
    routeTag,
    clientVersion,
  });
}

async function sendMessageV2({
  baseUrl,
  token,
  body,
  routeTag = "",
  clientVersion = "",
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
}: SendMessageV2Args): Promise<WeixinApiResponse> {
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/sendmessage",
    token,
    body: JSON.stringify({
      ...body,
      base_info: buildBaseInfo(),
    }),
    timeoutMs,
    label: "sendMessage",
    routeTag,
    clientVersion,
  });
  return assertApiSuccess(parseJson<WeixinApiResponse>(raw, "sendMessage"), "sendMessage");
}

async function getConfigV2({
  baseUrl,
  token,
  ilinkUserId,
  contextToken,
  routeTag = "",
  clientVersion = "",
  timeoutMs = DEFAULT_CONFIG_TIMEOUT_MS,
}: GetConfigV2Args): Promise<GetConfigV2Response> {
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/getconfig",
    token,
    body: JSON.stringify({
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: buildBaseInfo(),
    }),
    timeoutMs,
    label: "getConfig",
    routeTag,
    clientVersion,
  });
  return assertApiSuccess(parseJson<GetConfigV2Response>(raw, "getConfig"), "getConfig");
}

async function sendTypingV2({
  baseUrl,
  token,
  body,
  routeTag = "",
  clientVersion = "",
  timeoutMs = DEFAULT_CONFIG_TIMEOUT_MS,
}: SendTypingV2Args): Promise<WeixinApiResponse> {
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/sendtyping",
    token,
    body: JSON.stringify({
      ...body,
      base_info: buildBaseInfo(),
    }),
    timeoutMs,
    label: "sendTyping",
    routeTag,
    clientVersion,
  });
  return assertApiSuccess(parseJson<WeixinApiResponse>(raw, "sendTyping"), "sendTyping");
}

async function getUploadUrlV2({
  baseUrl,
  token,
  routeTag = "",
  clientVersion = "",
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
  ...payload
}: GetUploadUrlV2Args): Promise<GetUploadUrlV2Response> {
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    token,
    body: JSON.stringify({
      ...payload,
      base_info: buildBaseInfo(),
    }),
    timeoutMs,
    label: "getUploadUrl",
    routeTag,
    clientVersion,
  });
  return assertApiSuccess(parseJson<GetUploadUrlV2Response>(raw, "getUploadUrl"), "getUploadUrl");
}

function hasErrorCode(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function normalizeErrorCode(value: unknown): number | null {
  if (!hasErrorCode(value)) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return String(error || "unknown error");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export {
  getConfigV2,
  getUpdatesV2,
  getUploadUrlV2,
  sendMessageV2,
  sendTypingV2,
  sendTextV2,
};
