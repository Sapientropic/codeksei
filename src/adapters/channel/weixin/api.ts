const fs = require("fs");
const path = require("path");
const { redactSensitiveText } = require("./redact");
const { getStableWechatUin } = require("./protocol");

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

function buildBaseInfo() {
  return { channel_version: CHANNEL_VERSION };
}

function ensureTrailingSlash(url: any) {
  return url.endsWith("/") ? url : `${url}/`;
}

function buildHeaders(opts: any) {
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

async function apiFetch(params: any) {
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

function parseApiJson(rawText: any, label: any) {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`${label} returned invalid JSON: ${redactSensitiveText(rawText)}`);
  }
}

function assertApiSuccess(response: any, label: any) {
  const ret = response?.ret;
  const errcode = response?.errcode;
  if ((ret !== undefined && ret !== 0) || (errcode !== undefined && errcode !== 0)) {
    const errmsg = typeof response?.errmsg === "string" ? response.errmsg.trim() : "";
    throw new Error(`${label} ret=${ret ?? ""} errcode=${errcode ?? ""} errmsg=${redactSensitiveText(errmsg)}`);
  }
  return response;
}

async function getUpdates(params: any) {
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
    return parseApiJson(rawText, "getUpdates");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf || "" };
    }
    throw error;
  }
}

async function sendMessage(params: any) {
  const rawText = await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs || DEFAULT_API_TIMEOUT_MS,
    label: "sendMessage",
  });
  assertApiSuccess(parseApiJson(rawText, "sendMessage"), "sendMessage");
}

async function getUploadUrl(params: any) {
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
  return assertApiSuccess(parseApiJson(rawText, "getUploadUrl"), "getUploadUrl");
}

async function getConfig(params: any) {
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
  return assertApiSuccess(parseApiJson(rawText, "getConfig"), "getConfig");
}

async function sendTyping(params: any) {
  const rawText = await apiFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs || DEFAULT_CONFIG_TIMEOUT_MS,
    label: "sendTyping",
  });
  assertApiSuccess(parseApiJson(rawText, "sendTyping"), "sendTyping");
}

module.exports = {
  buildBaseInfo,
  getConfig,
  getUploadUrl,
  getUpdates,
  sendMessage,
  sendTyping,
};

export {};
