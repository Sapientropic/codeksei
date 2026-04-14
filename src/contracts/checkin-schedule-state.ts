import { z } from "zod";

type PlainObject = Record<string, unknown>;

export type CheckinCompletionResult = "backstage_only" | "sent_message" | "silent";
export type CheckinScheduleSource = "agent" | "fallback" | "guardrail_clamped" | "recovery";

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

export interface CheckinActiveWake extends CheckinPendingTrigger {
  startedAt: string;
}

export interface CheckinLastCompletion {
  completedAt: string;
  nextWakeAt: string;
  result: CheckinCompletionResult;
  scheduleSource: CheckinScheduleSource;
  triggerId: string;
}

export interface RawCheckinScheduleState extends PlainObject {
  activeWake?: unknown;
  lastCompletion?: unknown;
  lastConfirmedAt?: unknown;
  nextDueAt?: unknown;
  nextWakeAt?: unknown;
  pendingTrigger?: unknown;
  scheduleSource?: unknown;
  senderId?: unknown;
  targetKey?: unknown;
  updatedAt?: unknown;
  workspaceRoot?: unknown;
}

export interface CheckinScheduleState {
  activeWake: CheckinActiveWake | null;
  lastCompletion: CheckinLastCompletion | null;
  nextWakeAt: string;
  pendingTrigger: CheckinPendingTrigger | null;
  scheduleSource: CheckinScheduleSource;
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

export function normalizeCheckinActiveWake(value: unknown): CheckinActiveWake | null {
  const pendingTrigger = normalizeCheckinPendingTrigger(value);
  const source = asPlainObject(value);
  const startedAt = normalizeIsoTimestamp(source.startedAt);
  if (!pendingTrigger || !startedAt) {
    return null;
  }
  return {
    ...pendingTrigger,
    startedAt,
  };
}

export function normalizeCheckinLastCompletion(value: unknown): CheckinLastCompletion | null {
  const source = asPlainObject(value);
  const completedAt = normalizeIsoTimestamp(source.completedAt);
  const nextWakeAt = normalizeIsoTimestamp(source.nextWakeAt);
  const result = normalizeCheckinCompletionResult(source.result);
  const scheduleSource = normalizeCheckinScheduleSource(source.scheduleSource);
  const triggerId = normalizeNonEmptyString(source.triggerId);
  if (!completedAt || !nextWakeAt || !result || !scheduleSource || !triggerId) {
    return null;
  }
  return {
    completedAt,
    nextWakeAt,
    result,
    scheduleSource,
    triggerId,
  };
}

export function normalizeCheckinScheduleState(value: unknown): CheckinScheduleState {
  const source = asRawCheckinScheduleState(value);
  const nextWakeAt = normalizeIsoTimestamp(source.nextWakeAt) || normalizeIsoTimestamp(source.nextDueAt);
  const pendingTrigger = normalizeCheckinPendingTrigger(source.pendingTrigger);
  const activeWake = normalizeCheckinActiveWake(source.activeWake);
  const lastCompletion = normalizeCheckinLastCompletion(source.lastCompletion);
  const scheduleSource = normalizeCheckinScheduleSource(source.scheduleSource)
    || inferLegacyScheduleSource({
      activeWake,
      lastCompletion,
      nextWakeAt,
      pendingTrigger,
    });
  return {
    activeWake,
    lastCompletion,
    nextWakeAt,
    pendingTrigger,
    scheduleSource,
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
  if ("nextWakeAt" in source && source.nextWakeAt != null && typeof source.nextWakeAt !== "string") {
    return "checkin schedule state nextWakeAt must be a string";
  }
  if ("nextDueAt" in source && source.nextDueAt != null && typeof source.nextDueAt !== "string") {
    return "checkin schedule state nextDueAt must be a string";
  }
  if ("updatedAt" in source && typeof source.updatedAt !== "string") {
    return "checkin schedule state updatedAt must be a string";
  }
  if ("pendingTrigger" in source && source.pendingTrigger != null && !normalizeCheckinPendingTrigger(source.pendingTrigger)) {
    return "checkin schedule state pendingTrigger is invalid";
  }
  if ("activeWake" in source && source.activeWake != null && !normalizeCheckinActiveWake(source.activeWake)) {
    return "checkin schedule state activeWake is invalid";
  }
  if ("lastCompletion" in source && source.lastCompletion != null && !normalizeCheckinLastCompletion(source.lastCompletion)) {
    return "checkin schedule state lastCompletion is invalid";
  }
  if ("scheduleSource" in source && source.scheduleSource != null && !normalizeCheckinScheduleSource(source.scheduleSource)) {
    return "checkin schedule state scheduleSource is invalid";
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

export function normalizeCheckinCompletionResult(value: unknown): CheckinCompletionResult | "" {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  if (normalized === "sent_message" || normalized === "silent" || normalized === "backstage_only") {
    return normalized;
  }
  return "";
}

export function normalizeCheckinScheduleSource(value: unknown): CheckinScheduleSource | "" {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  if (normalized === "agent" || normalized === "fallback" || normalized === "recovery" || normalized === "guardrail_clamped") {
    return normalized;
  }
  return "";
}

function inferLegacyScheduleSource({
  activeWake,
  lastCompletion,
  nextWakeAt,
  pendingTrigger,
}: {
  activeWake: CheckinActiveWake | null;
  lastCompletion: CheckinLastCompletion | null;
  nextWakeAt: string;
  pendingTrigger: CheckinPendingTrigger | null;
}): CheckinScheduleSource {
  if (lastCompletion?.scheduleSource) {
    return lastCompletion.scheduleSource;
  }
  if (activeWake || pendingTrigger || nextWakeAt) {
    return "fallback";
  }
  return "fallback";
}

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
