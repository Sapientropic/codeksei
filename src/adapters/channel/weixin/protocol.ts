import * as crypto from "node:crypto";
import { TENCENT_OPENCLAW_WEIXIN_VERSION } from "../../../contracts/weixin-official";

const DEFAULT_PROTOCOL_CLIENT_VERSION = TENCENT_OPENCLAW_WEIXIN_VERSION;
const BOT_API_USER_AGENT = "node";
const ILINK_APP_ID = "bot";
// Keep one stable sender identity per bridge process. Re-randomizing this on
// every request makes retries look like they came from different clients,
// which weakens upstream dedupe and can amplify duplicate sends.
const PROCESS_WECHAT_UIN = createStableWechatUin();

function normalizeRouteTag(routeTag: unknown): string {
  return typeof routeTag === "string" ? routeTag.trim() : "";
}

function normalizeProtocolClientVersion(version: unknown): string {
  const normalized = typeof version === "string" ? version.trim() : "";
  return normalized || DEFAULT_PROTOCOL_CLIENT_VERSION;
}

function encodeClientVersion(version: unknown): string {
  const parts = normalizeProtocolClientVersion(version).split(".");
  const parse = (index: number): number => {
    const value = Number.parseInt(parts[index] || "0", 10);
    return Number.isFinite(value) ? value : 0;
  };
  const major = parse(0);
  const minor = parse(1);
  const patch = parse(2);
  const encoded = ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
  return String(encoded);
}

function buildCommonHeaders({
  routeTag = "",
  clientVersion = DEFAULT_PROTOCOL_CLIENT_VERSION,
}: {
  routeTag?: unknown;
  clientVersion?: unknown;
} = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": BOT_API_USER_AGENT,
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": encodeClientVersion(clientVersion),
  };
  const normalizedRouteTag = normalizeRouteTag(routeTag);
  if (normalizedRouteTag) {
    headers.SKRouteTag = normalizedRouteTag;
  }
  return headers;
}

function createStableWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf8").toString("base64");
}

function getStableWechatUin() {
  return PROCESS_WECHAT_UIN;
}

function buildJsonHeaders({
  body,
  token = "",
  routeTag = "",
  clientVersion = DEFAULT_PROTOCOL_CLIENT_VERSION,
}: {
  body: unknown;
  token?: unknown;
  routeTag?: unknown;
  clientVersion?: unknown;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(String(body || ""), "utf8")),
    "X-WECHAT-UIN": getStableWechatUin(),
    ...buildCommonHeaders({ routeTag, clientVersion }),
  };
  const normalizedToken = typeof token === "string" ? token.trim() : "";
  if (normalizedToken) {
    headers.Authorization = `Bearer ${normalizedToken}`;
  }
  return headers;
}

export {
  DEFAULT_PROTOCOL_CLIENT_VERSION,
  buildCommonHeaders,
  buildJsonHeaders,
  getStableWechatUin,
  normalizeProtocolClientVersion,
  normalizeRouteTag,
};
