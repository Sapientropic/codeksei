import * as fs from "node:fs";
import * as path from "node:path";
import { redactSensitiveText } from "./redact";
import { getStableWechatUin } from "./protocol";
import type { WeixinSendMessageRequest, WeixinUploadUrlRequest } from "./media-types";


interface WeixinBaseInfo {
  channel_version: string;
}

export interface WeixinLegacyApiResponse extends Record<string, unknown> {
  ret?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
}

export interface GetUpdatesArgs extends Record<string, unknown> {
  baseUrl: string;
  token: string;
  get_updates_buf?: string;
  timeoutMs?: number;
}

export interface GetUpdatesResponse extends WeixinLegacyApiResponse {
  msgs: unknown[];
  get_updates_buf: string;
}

export interface GetConfigArgs extends Record<string, unknown> {
  baseUrl: string;
  token: string;
  ilinkUserId: string;
  contextToken: string;
  timeoutMs?: number;
}

export interface GetConfigResponse extends WeixinLegacyApiResponse {
  typing_ticket?: unknown;
}

interface ApiFetchArgs {
  baseUrl: string;
  endpoint: string;
  body: string;
  token: string;
  timeoutMs: number;
  label: string;
}

function readChannelVersion() {
  try {
    const pkgPath = path.resolve(__dirname, "../../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

const CHANNEL_VERSION = readChannelVersion();
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;

function buildBaseInfo(): WeixinBaseInfo {
  return { channel_version: CHANNEL_VERSION };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function buildHeaders(opts: { token?: string; body: string }): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(opts.body, "utf8")),
    "X-WECHAT-UIN": getStableWechatUin(),
  };
  if (opts.token && String(opts.token).trim()) {
    headers.Authorization = `Bearer ${String(opts.token).trim()}`;
  }
  return headers;
}

async function apiFetch(params: ApiFetchArgs): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const headers = buildHeaders({ token: params.token, body: params.body });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`${params.label} ${response.status}: ${redactSensitiveText(rawText)}`);
    }
    return rawText;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

function parseApiJson<T extends Record<string, unknown>>(rawText: string, label: string): T {
  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON: ${redactSensitiveText(rawText)}`);
  }
}

function assertApiSuccess<T extends WeixinLegacyApiResponse>(response: T, label: string): T {
  const ret = normalizeErrorCode(response?.ret);
  const errcode = normalizeErrorCode(response?.errcode);
  if ((hasErrorCode(response?.ret) && ret !== 0) || (hasErrorCode(response?.errcode) && errcode !== 0)) {
    const errmsg = typeof response?.errmsg === "string" ? response.errmsg.trim() : "";
    throw new Error(`${label} ret=${ret ?? ""} errcode=${errcode ?? ""} errmsg=${redactSensitiveText(errmsg)}`);
  }
  return response;
}

async function getUpdates(params: GetUpdatesArgs): Promise<GetUpdatesResponse> {
  const timeout = params.timeoutMs || DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    const rawText = await apiFetch({
      baseUrl: params.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: params.get_updates_buf || "",
        base_info: buildBaseInfo(),
      }),
      token: params.token,
      timeoutMs: timeout,
      label: "getUpdates",
    });
    return parseApiJson<GetUpdatesResponse>(rawText, "getUpdates");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf || "" };
    }
    throw error;
  }
}

async function sendMessage(params: WeixinSendMessageRequest): Promise<WeixinLegacyApiResponse> {
  const rawText = await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs || DEFAULT_API_TIMEOUT_MS,
    label: "sendMessage",
  });
  return assertApiSuccess(parseApiJson<WeixinLegacyApiResponse>(rawText, "sendMessage"), "sendMessage");
}

async function getUploadUrl(params: WeixinUploadUrlRequest): Promise<WeixinLegacyApiResponse> {
  const rawText = await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    body: JSON.stringify({
      filekey: params.filekey,
      media_type: params.media_type,
      to_user_id: params.to_user_id,
      rawsize: params.rawsize,
      rawfilemd5: params.rawfilemd5,
      filesize: params.filesize,
      thumb_rawsize: params.thumb_rawsize,
      thumb_rawfilemd5: params.thumb_rawfilemd5,
      thumb_filesize: params.thumb_filesize,
      no_need_thumb: params.no_need_thumb,
      aeskey: params.aeskey,
      base_info: buildBaseInfo(),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs || DEFAULT_API_TIMEOUT_MS,
    label: "getUploadUrl",
  });
  return assertApiSuccess(parseApiJson<WeixinLegacyApiResponse>(rawText, "getUploadUrl"), "getUploadUrl");
}

async function getConfig(params: GetConfigArgs): Promise<GetConfigResponse> {
  const rawText = await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getconfig",
    body: JSON.stringify({
      ilink_user_id: params.ilinkUserId,
      context_token: params.contextToken,
      base_info: buildBaseInfo(),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs || DEFAULT_CONFIG_TIMEOUT_MS,
    label: "getConfig",
  });
  return assertApiSuccess(parseApiJson<GetConfigResponse>(rawText, "getConfig"), "getConfig");
}

async function sendTyping(params: WeixinSendMessageRequest): Promise<WeixinLegacyApiResponse> {
  const rawText = await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs || DEFAULT_CONFIG_TIMEOUT_MS,
    label: "sendTyping",
  });
  return assertApiSuccess(parseApiJson<WeixinLegacyApiResponse>(rawText, "sendTyping"), "sendTyping");
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

export {
  buildBaseInfo,
  getConfig,
  getUploadUrl,
  getUpdates,
  sendMessage,
  sendTyping,
};
