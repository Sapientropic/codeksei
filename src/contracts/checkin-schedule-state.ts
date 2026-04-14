import { z } from "zod";

type PlainObject = Record<string, unknown>;

export interface CheckinPendingTrigger {
  createdAt: string;
  dueAt: string;
  kind: "checkin";
  senderId: string;
  source: "checkin_trigger";
  text: string;
  triggerId: string;
  workspaceRoot: string;
}

export interface RawCheckinScheduleState extends PlainObject {
  lastConfirmedAt?: unknown;
  nextDueAt?: unknown;
  pendingTrigger?: unknown;
  senderId?: unknown;
  targetKey?: unknown;
  updatedAt?: unknown;
  workspaceRoot?: unknown;
}

export interface CheckinScheduleState {
  lastConfirmedAt: string;
  nextDueAt: string;
  pendingTrigger: CheckinPendingTrigger | null;
  senderId: string;
  targetKey: string;
  updatedAt: string;
  workspaceRoot: string;
}

export function normalizeCheckinPendingTrigger(value: unknown): CheckinPendingTrigger | null {
  const source = asPlainObject(value);
  const triggerId = normalizeNonEmptyString(source.triggerId);
  const senderId = normalizeNonEmptyString(source.senderId);
  const workspaceRoot = normalizeNonEmptyString(source.workspaceRoot);
  const text = normalizeNonEmptyString(source.text);
  const createdAt = normalizeIsoTimestamp(source.createdAt);
  const dueAt = normalizeIsoTimestamp(source.dueAt);
  const kind = normalizeNonEmptyString(source.kind) === "checkin" ? "checkin" : "";
  const sourceLabel = normalizeNonEmptyString(source.source) === "checkin_trigger" ? "checkin_trigger" : "";

  if (!triggerId || !senderId || !workspaceRoot || !text || !createdAt || !dueAt || !kind || !sourceLabel) {
    return null;
  }

  return {
    createdAt,
    dueAt,
    kind: "checkin",
    senderId,
    source: "checkin_trigger",
    text,
    triggerId,
    workspaceRoot,
  };
}

export function normalizeCheckinScheduleState(value: unknown): CheckinScheduleState {
  const source = asRawCheckinScheduleState(value);
  return {
    lastConfirmedAt: normalizeIsoTimestamp(source.lastConfirmedAt),
    nextDueAt: normalizeIsoTimestamp(source.nextDueAt),
    pendingTrigger: normalizeCheckinPendingTrigger(source.pendingTrigger),
    senderId: normalizeNonEmptyString(source.senderId),
    targetKey: normalizeNonEmptyString(source.targetKey),
    updatedAt: normalizeIsoTimestamp(source.updatedAt),
    workspaceRoot: normalizeNonEmptyString(source.workspaceRoot),
  };
}

export function validateCheckinScheduleState(value: unknown): true | string {
  const source = asRawCheckinScheduleState(value);
  if (!isPlainObject(value)) {
    return "checkin schedule state must be an object";
  }
  if (!normalizeNonEmptyString(source.targetKey)) {
    return "checkin schedule state targetKey must be a non-empty string";
  }
  if (!normalizeNonEmptyString(source.senderId)) {
    return "checkin schedule state senderId must be a non-empty string";
  }
  if (!normalizeNonEmptyString(source.workspaceRoot)) {
    return "checkin schedule state workspaceRoot must be a non-empty string";
  }
  if ("nextDueAt" in source && source.nextDueAt != null && typeof source.nextDueAt !== "string") {
    return "checkin schedule state nextDueAt must be a string";
  }
  if ("lastConfirmedAt" in source && source.lastConfirmedAt != null && typeof source.lastConfirmedAt !== "string") {
    return "checkin schedule state lastConfirmedAt must be a string";
  }
  if ("updatedAt" in source && typeof source.updatedAt !== "string") {
    return "checkin schedule state updatedAt must be a string";
  }
  if ("pendingTrigger" in source && source.pendingTrigger != null && !normalizeCheckinPendingTrigger(source.pendingTrigger)) {
    return "checkin schedule state pendingTrigger is invalid";
  }
  return true;
}

export const checkinScheduleStateSchema = z.unknown().transform((
  value: unknown,
  ctx: z.RefinementCtx,
): CheckinScheduleState | typeof z.NEVER => {
  const validation = validateCheckinScheduleState(value);
  if (validation !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation });
    return z.NEVER;
  }
  return normalizeCheckinScheduleState(value);
});

function normalizeIsoTimestamp(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asPlainObject(value: unknown): PlainObject {
  return isPlainObject(value) ? value : {};
}

function asRawCheckinScheduleState(value: unknown): RawCheckinScheduleState {
  return isPlainObject(value) ? value as RawCheckinScheduleState : {};
}
