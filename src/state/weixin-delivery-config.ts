import { readPrefixedEnv, readPrefixedIntEnv } from "../contracts/app-env";
import {
  MAX_WEIXIN_MIN_CHUNK_CHARS,
  normalizeOptionalWeixinDeliveryReplyMode,
  type WeixinDeliveryConfig,
  type WeixinDeliveryReplyMode,
} from "../contracts/weixin-delivery-config";
import { WeixinDeliveryConfigStore } from "./weixin-delivery-config-store";

export const DEFAULT_WEIXIN_MIN_CHUNK_CHARS = 80;
export { MAX_WEIXIN_MIN_CHUNK_CHARS };

export interface ResolvedWeixinDeliveryConfig {
  minChunkChars: number;
  replyMode: WeixinDeliveryReplyMode;
  minChunkCharsSource: "stored" | "env" | "default";
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
  const store = new WeixinDeliveryConfigStore({ filePath });
  const storedConfig = store.getConfig();
  const envReplyMode = normalizeOptionalWeixinDeliveryReplyMode(readPrefixedEnv(env, "WEIXIN_REPLY_MODE"));
  const envMinChunkChars = normalizeMinChunkChars(readPrefixedIntEnv(env, "WEIXIN_MIN_CHUNK_CHARS"));
  return {
    replyMode: storedConfig?.replyMode
      || envReplyMode
      || normalizeOptionalWeixinDeliveryReplyMode(defaultReplyMode)
      || "stream",
    minChunkChars: storedConfig?.minChunkChars
      || envMinChunkChars
      || DEFAULT_WEIXIN_MIN_CHUNK_CHARS,
    replyModeSource: storedConfig?.replyMode ? "stored" : (envReplyMode ? "env" : "default"),
    minChunkCharsSource: storedConfig?.minChunkChars ? "stored" : (envMinChunkChars ? "env" : "default"),
    storedConfig,
  };
}

export function parseWeixinMinChunkChars(value: unknown): number {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) ? normalizeMinChunkChars(Number(normalized)) : 0;
}

export function formatWeixinDeliveryConfig(config: Pick<ResolvedWeixinDeliveryConfig, "replyMode" | "replyModeSource" | "minChunkChars" | "minChunkCharsSource">): string {
  return [
    `replyMode: ${config.replyMode} [${config.replyModeSource}]`,
    `merge: ${config.minChunkChars} chars [${config.minChunkCharsSource}]`,
    "用法：/reply mode stream|settled、/reply merge 80、/reply reset",
  ].join("\n");
}

function normalizeMinChunkChars(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_WEIXIN_MIN_CHUNK_CHARS) {
    return 0;
  }
  return numeric;
}
