import { z } from "zod";

type PlainObject = Record<string, unknown>;

export interface RawCheckinConfig extends PlainObject {
  minIntervalMs?: unknown;
  maxIntervalMs?: unknown;
  updatedAt?: unknown;
}

export interface CheckinConfig {
  minIntervalMs: number;
  maxIntervalMs: number;
  updatedAt: string;
}

export function normalizeCheckinConfig(value: unknown): CheckinConfig {
  const source = asRawCheckinConfig(value);
  const minIntervalMs = normalizePositiveInteger(source.minIntervalMs);
  const maxIntervalMs = Math.max(minIntervalMs, normalizePositiveInteger(source.maxIntervalMs));
  return {
    minIntervalMs,
    maxIntervalMs,
    updatedAt: normalizeIsoTimestamp(source.updatedAt),
  };
}

export function validateCheckinConfig(value: unknown): true | string {
  const source = asRawCheckinConfig(value);
  if (!isPlainObject(value)) {
    return "checkin config must be an object";
  }
  if (!isPositiveInteger(source.minIntervalMs)) {
    return "checkin config minIntervalMs must be a positive integer";
  }
  if (!isPositiveInteger(source.maxIntervalMs)) {
    return "checkin config maxIntervalMs must be a positive integer";
  }
  if (Number(source.maxIntervalMs) < Number(source.minIntervalMs)) {
    return "checkin config maxIntervalMs must be >= minIntervalMs";
  }
  if ("updatedAt" in source && typeof source.updatedAt !== "string") {
    return "checkin config updatedAt must be a string";
  }
  return true;
}

export const checkinConfigSchema = z.unknown().transform((
  value: unknown,
  ctx: z.RefinementCtx,
): CheckinConfig | typeof z.NEVER => {
  const validation = validateCheckinConfig(value);
  if (validation !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation });
    return z.NEVER;
  }
  return normalizeCheckinConfig(value);
});

function normalizePositiveInteger(value: unknown): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeIsoTimestamp(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
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

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRawCheckinConfig(value: unknown): RawCheckinConfig {
  return isPlainObject(value) ? value as RawCheckinConfig : {};
}
