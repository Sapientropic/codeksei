import { z } from "zod";

import { normalizeText } from "./text-normalization";

type PlainObject = Record<string, unknown>;

export type WeixinDeliveryReplyMode = "settled" | "stream";
export const MAX_WEIXIN_MIN_CHUNK_CHARS = 3800;

export interface RawWeixinDeliveryConfig extends PlainObject {
  minChunkChars?: unknown;
  replyMode?: unknown;
  updatedAt?: unknown;
}

export interface WeixinDeliveryConfig {
  minChunkChars?: number;
  replyMode?: WeixinDeliveryReplyMode;
  updatedAt?: string;
}

export function normalizeWeixinDeliveryReplyMode(value: unknown): WeixinDeliveryReplyMode {
  return normalizeText(value).toLowerCase() === "settled" ? "settled" : "stream";
}

export function normalizeOptionalWeixinDeliveryReplyMode(value: unknown): WeixinDeliveryReplyMode | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "stream" || normalized === "settled") {
    return normalized;
  }
  return "";
}

export function normalizeWeixinDeliveryConfig(value: unknown): WeixinDeliveryConfig {
  const source = asRawWeixinDeliveryConfig(value);
  const normalized: WeixinDeliveryConfig = {};
  const updatedAt = normalizeIsoTimestamp(source.updatedAt);
  if (updatedAt) {
    normalized.updatedAt = updatedAt;
  }
  const replyMode = normalizeOptionalWeixinDeliveryReplyMode(source.replyMode);
  if (replyMode) {
    normalized.replyMode = replyMode;
  }
  const minChunkChars = normalizePositiveInteger(source.minChunkChars);
  if (minChunkChars > 0) {
    normalized.minChunkChars = minChunkChars;
  }
  return normalized;
}

export function validateWeixinDeliveryConfig(value: unknown): true | string {
  const source = asRawWeixinDeliveryConfig(value);
  if (!isPlainObject(value)) {
    return "weixin delivery config must be an object";
  }
  if ("replyMode" in source) {
    const normalizedReplyMode = normalizeText(source.replyMode).toLowerCase();
    if (normalizedReplyMode !== "stream" && normalizedReplyMode !== "settled") {
      return "weixin delivery config replyMode must be stream or settled";
    }
  }
  if ("minChunkChars" in source && !isValidMinChunkChars(source.minChunkChars)) {
    return "weixin delivery config minChunkChars must be an integer from 1 to 3800";
  }
  if ("updatedAt" in source && typeof source.updatedAt !== "string") {
    return "weixin delivery config updatedAt must be a string";
  }
  return true;
}

export const weixinDeliveryConfigSchema = z.unknown().transform((
  value: unknown,
  ctx: z.RefinementCtx,
): WeixinDeliveryConfig | typeof z.NEVER => {
  const validation = validateWeixinDeliveryConfig(value);
  if (validation !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation });
    return z.NEVER;
  }
  return normalizeWeixinDeliveryConfig(value);
});

function normalizePositiveInteger(value: unknown): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 && numeric <= MAX_WEIXIN_MIN_CHUNK_CHARS ? numeric : 0;
}

function normalizeIsoTimestamp(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function isPositiveInteger(value: unknown): boolean {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0;
}

function isValidMinChunkChars(value: unknown): boolean {
  const numeric = Number(value);
  return isPositiveInteger(numeric) && numeric <= MAX_WEIXIN_MIN_CHUNK_CHARS;
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRawWeixinDeliveryConfig(value: unknown): RawWeixinDeliveryConfig {
  return isPlainObject(value) ? value as RawWeixinDeliveryConfig : {};
}
