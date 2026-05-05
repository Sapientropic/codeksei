import { readPrefixedEnv, readPrefixedIntEnv } from "../contracts/app-env";
import {
  MAX_WEIXIN_PAGE_CHARS,
  MAX_WEIXIN_MIN_CHUNK_CHARS,
  MIN_WEIXIN_PAGE_CHARS,
  normalizeOptionalWeixinDeliveryPageMode,
  normalizeOptionalWeixinDeliveryReplyMode,
  type WeixinDeliveryConfig,
  type WeixinDeliveryPageMode,
  type WeixinDeliveryReplyMode,
} from "../contracts/weixin-delivery-config";
import { WeixinDeliveryConfigStore } from "./weixin-delivery-config-store";

export const DEFAULT_WEIXIN_MIN_CHUNK_CHARS = 80;
export const DEFAULT_WEIXIN_PAGE_MODE: WeixinDeliveryPageMode = "auto";
export const DEFAULT_WEIXIN_PAGE_CHARS = 1200;
export { MAX_WEIXIN_MIN_CHUNK_CHARS };
export { MAX_WEIXIN_PAGE_CHARS, MIN_WEIXIN_PAGE_CHARS };

export interface ResolvedWeixinDeliveryConfig {
  minChunkChars: number;
  pageChars: number;
  pageMode: WeixinDeliveryPageMode;
  replyMode: WeixinDeliveryReplyMode;
  minChunkCharsSource: "stored" | "env" | "default";
  pageCharsSource: "stored" | "env" | "default";
  pageModeSource: "stored" | "env" | "default";
  replyModeSource: "stored" | "env" | "default";
  storedConfig: WeixinDeliveryConfig | null;
}

export function resolveWeixinDeliveryConfig({
  filePath,
  env = process.env,
  defaultReplyMode = "stream",
}: {
  filePath: string;
  env?: NodeJS.ProcessEnv;
  defaultReplyMode?: unknown;
}): ResolvedWeixinDeliveryConfig {
  const normalizedFilePath = typeof filePath === "string" ? filePath.trim() : "";
  const storedConfig = normalizedFilePath
    ? new WeixinDeliveryConfigStore({ filePath: normalizedFilePath }).getConfig()
    : null;
  const envReplyMode = normalizeOptionalWeixinDeliveryReplyMode(readPrefixedEnv(env, "WEIXIN_REPLY_MODE"));
  const envMinChunkChars = normalizeMinChunkChars(readPrefixedIntEnv(env, "WEIXIN_MIN_CHUNK_CHARS"));
  const envPageMode = normalizeOptionalWeixinDeliveryPageMode(readPrefixedEnv(env, "WEIXIN_PAGE_MODE"));
  const envPageChars = normalizePageChars(readPrefixedIntEnv(env, "WEIXIN_PAGE_CHARS"));
  return {
    replyMode: storedConfig?.replyMode
      || envReplyMode
      || normalizeOptionalWeixinDeliveryReplyMode(defaultReplyMode)
      || "stream",
    minChunkChars: storedConfig?.minChunkChars
      || envMinChunkChars
      || DEFAULT_WEIXIN_MIN_CHUNK_CHARS,
    pageMode: storedConfig?.pageMode
      || envPageMode
      || DEFAULT_WEIXIN_PAGE_MODE,
    pageChars: storedConfig?.pageChars
      || envPageChars
      || DEFAULT_WEIXIN_PAGE_CHARS,
    replyModeSource: storedConfig?.replyMode ? "stored" : (envReplyMode ? "env" : "default"),
    minChunkCharsSource: storedConfig?.minChunkChars ? "stored" : (envMinChunkChars ? "env" : "default"),
    pageModeSource: storedConfig?.pageMode ? "stored" : (envPageMode ? "env" : "default"),
    pageCharsSource: storedConfig?.pageChars ? "stored" : (envPageChars ? "env" : "default"),
    storedConfig,
  };
}

export function parseWeixinMinChunkChars(value: unknown): number {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) ? normalizeMinChunkChars(Number(normalized)) : 0;
}

export function parseWeixinPageChars(value: unknown): number {
  const normalized = String(value ?? "").trim();
  return /^\d+$/u.test(normalized) ? normalizePageChars(Number(normalized)) : 0;
}

export function formatWeixinDeliveryConfig(config: Pick<
  ResolvedWeixinDeliveryConfig,
  | "replyMode"
  | "replyModeSource"
  | "minChunkChars"
  | "minChunkCharsSource"
  | "pageMode"
  | "pageModeSource"
  | "pageChars"
  | "pageCharsSource"
>): string {
  return [
    `replyMode: ${config.replyMode} [${config.replyModeSource}]`,
    `merge: ${config.minChunkChars} chars [${config.minChunkCharsSource}]`,
    `page: ${config.pageMode} ${config.pageChars} chars [${config.pageModeSource === "stored" || config.pageCharsSource === "stored" ? "stored" : (config.pageModeSource === "env" || config.pageCharsSource === "env" ? "env" : "default")}]`,
    "用法：/reply mode stream|settled、/reply merge 80、/reply page auto|off|1200、/reply reset",
  ].join("\n");
}

function normalizeMinChunkChars(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_WEIXIN_MIN_CHUNK_CHARS) {
    return 0;
  }
  return numeric;
}

function normalizePageChars(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < MIN_WEIXIN_PAGE_CHARS || numeric > MAX_WEIXIN_PAGE_CHARS) {
    return 0;
  }
  return numeric;
}
