import { z } from "zod";

type PlainObject = Record<string, unknown>;

export interface SystemMessage {
  id: string;
  accountId: string;
  senderId: string;
  workspaceRoot: string;
  text: string;
  kind: "checkin" | "reminder" | "manual";
  attemptCount: number;
  lastAttemptAt: string;
  nextAttemptAt: string;
  expiresAt: string;
  lastFailureReason: string;
  deliveryState: "pending" | "in_flight";
  inFlightAt: string;
  createdAt: string;
}

export interface SystemMessageDeadLetterEntry extends SystemMessage {
  deadLetterReason: string;
  deadLetterAt: string;
}

export interface TimelineScreenshotJob {
  id: string;
  accountId: string;
  senderId: string;
  outputFile: string;
  args: string[];
  createdAt: string;
}

export interface ReminderQueueEntry {
  id: string;
  accountId: string;
  senderId: string;
  contextToken: string;
  text: string;
  dueAtMs: number;
  createdAt: string;
}

export const SYSTEM_MESSAGE_KIND_POLICIES = Object.freeze({
  checkin: Object.freeze({
    ttlMs: 30 * 60_000,
    maxAttempts: 3,
  }),
  reminder: Object.freeze({
    ttlMs: 24 * 60 * 60_000,
    maxAttempts: 6,
  }),
  manual: Object.freeze({
    ttlMs: 24 * 60 * 60_000,
    maxAttempts: 6,
  }),
});

export function normalizeSystemMessage(message: unknown): SystemMessage | null {
  if (!isPlainObject(message)) {
    return null;
  }

  const id = normalizeText(message.id);
  const accountId = normalizeText(message.accountId);
  const senderId = normalizeText(message.senderId);
  const workspaceRoot = normalizeText(message.workspaceRoot);
  const text = normalizeText(message.text);
  const kind = normalizeSystemMessageKind(message.kind || inferSystemMessageKind(message));
  const createdAt = normalizeIsoTime(message.createdAt) || new Date().toISOString();
  const policy = getSystemMessagePolicy(kind);
  const attemptCount = normalizeNonNegativeInteger(message.attemptCount);
  const lastAttemptAt = normalizeIsoTime(message.lastAttemptAt);
  const nextAttemptAt = normalizeIsoTime(message.nextAttemptAt) || createdAt;
  const expiresAt = normalizeIsoTime(message.expiresAt)
    || formatIsoTime((parseIsoTime(createdAt) || Date.now()) + policy.ttlMs);
  const lastFailureReason = normalizeText(message.lastFailureReason);
  let deliveryState = normalizeSystemMessageDeliveryState(message.deliveryState);
  let inFlightAt = normalizeIsoTime(message.inFlightAt);
  if (deliveryState === "in_flight" && !inFlightAt) {
    deliveryState = "pending";
  }
  if (deliveryState !== "in_flight") {
    inFlightAt = "";
  }

  if (!id || !accountId || !senderId || !workspaceRoot || !text) {
    return null;
  }

  return {
    id,
    accountId,
    senderId,
    workspaceRoot,
    text,
    kind,
    attemptCount,
    lastAttemptAt,
    nextAttemptAt,
    expiresAt,
    lastFailureReason,
    deliveryState,
    inFlightAt,
    createdAt,
  };
}

export function normalizeSystemMessageDeadLetterEntry(entry: unknown): SystemMessageDeadLetterEntry | null {
  if (!isPlainObject(entry)) {
    return null;
  }
  const normalizedMessage = normalizeSystemMessage(entry);
  if (!normalizedMessage) {
    return null;
  }
  const deadLetterReason = normalizeText(entry.deadLetterReason) || "dead_letter";
  const deadLetterAt = normalizeIsoTime(entry.deadLetterAt) || new Date().toISOString();
  return {
    ...normalizedMessage,
    deadLetterReason,
    deadLetterAt,
  };
}

export function validateSystemMessageQueueState(state: unknown): true | string {
  if (!isPlainObject(state)) {
    return "system message queue top-level state must be an object";
  }
  if (!Array.isArray(state.messages)) {
    return "system message queue messages must be an array";
  }
  for (let index = 0; index < state.messages.length; index += 1) {
    if (!normalizeSystemMessage(state.messages[index])) {
      return `system message queue messages[${index}] is invalid`;
    }
  }
  return true;
}

export function validateSystemMessageDeadLetterState(state: unknown): true | string {
  if (!isPlainObject(state)) {
    return "system message dead letter top-level state must be an object";
  }
  if (!Array.isArray(state.entries)) {
    return "system message dead letter entries must be an array";
  }
  for (let index = 0; index < state.entries.length; index += 1) {
    if (!normalizeSystemMessageDeadLetterEntry(state.entries[index])) {
      return `system message dead letter entries[${index}] is invalid`;
    }
  }
  return true;
}

export function normalizeTimelineScreenshotJob(job: unknown): TimelineScreenshotJob | null {
  if (!isPlainObject(job)) {
    return null;
  }

  const id = normalizeText(job.id);
  const accountId = normalizeText(job.accountId);
  const senderId = normalizeText(job.senderId);
  const outputFile = normalizeText(job.outputFile);
  const createdAt = normalizeIsoTime(job.createdAt);
  const args = Array.isArray(job.args)
    ? job.args.map((value: any) => normalizeText(value)).filter(Boolean)
    : [];

  if (!id || !accountId || !senderId) {
    return null;
  }

  return {
    id,
    accountId,
    senderId,
    outputFile,
    args,
    createdAt: createdAt || new Date().toISOString(),
  };
}

export function validateTimelineScreenshotQueueState(state: unknown): true | string {
  if (!isPlainObject(state)) {
    return "timeline screenshot queue top-level state must be an object";
  }
  if (!Array.isArray(state.jobs)) {
    return "timeline screenshot queue jobs must be an array";
  }
  for (let index = 0; index < state.jobs.length; index += 1) {
    if (!normalizeTimelineScreenshotJob(state.jobs[index])) {
      return `timeline screenshot queue jobs[${index}] is invalid`;
    }
  }
  return true;
}

export function normalizeReminderQueueEntry(reminder: unknown): ReminderQueueEntry | null {
  if (!isPlainObject(reminder)) {
    return null;
  }

  const id = normalizeText(reminder.id);
  const accountId = normalizeText(reminder.accountId);
  const senderId = normalizeText(reminder.senderId);
  const contextToken = normalizeText(reminder.contextToken);
  const text = normalizeText(reminder.text);
  const dueAtMs = normalizePositiveInteger(reminder.dueAtMs);
  const createdAt = normalizeIsoTime(reminder.createdAt) || new Date().toISOString();

  if (!id || !accountId || !senderId || !contextToken || !text || !dueAtMs) {
    return null;
  }

  return {
    id,
    accountId,
    senderId,
    contextToken,
    text,
    dueAtMs,
    createdAt,
  };
}

export function validateReminderQueueState(state: unknown): true | string {
  if (!isPlainObject(state)) {
    return "reminder queue top-level state must be an object";
  }
  if (!Array.isArray(state.reminders)) {
    return "reminder queue reminders must be an array";
  }
  for (let index = 0; index < state.reminders.length; index += 1) {
    if (!normalizeReminderQueueEntry(state.reminders[index])) {
      return `reminder queue reminders[${index}] is invalid`;
    }
  }
  return true;
}

export const systemMessageQueueStateSchema = z.unknown().transform((value: any, ctx: any) => {
  const validation = validateSystemMessageQueueState(value);
  if (validation !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation });
    return z.NEVER;
  }
  const source = value as { messages: unknown[] } & PlainObject;
  return {
    ...source,
    messages: source.messages.map((message: any) => normalizeSystemMessage(message)!),
  };
});

export const systemMessageDeadLetterStateSchema = z.unknown().transform((value: any, ctx: any) => {
  const validation = validateSystemMessageDeadLetterState(value);
  if (validation !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation });
    return z.NEVER;
  }
  const source = value as { entries: unknown[] } & PlainObject;
  return {
    ...source,
    entries: source.entries.map((entry: any) => normalizeSystemMessageDeadLetterEntry(entry)!),
  };
});

export const timelineScreenshotQueueStateSchema = z.unknown().transform((value: any, ctx: any) => {
  const validation = validateTimelineScreenshotQueueState(value);
  if (validation !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation });
    return z.NEVER;
  }
  const source = value as { jobs: unknown[] } & PlainObject;
  return {
    ...source,
    jobs: source.jobs.map((job: any) => normalizeTimelineScreenshotJob(job)!),
  };
});

export const reminderQueueStateSchema = z.unknown().transform((value: any, ctx: any) => {
  const validation = validateReminderQueueState(value);
  if (validation !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation });
    return z.NEVER;
  }
  const source = value as { reminders: unknown[] } & PlainObject;
  return {
    ...source,
    reminders: source.reminders.map((reminder: any) => normalizeReminderQueueEntry(reminder)!),
  };
});

export function compareSystemMessages(left: Partial<SystemMessage> | null | undefined, right: Partial<SystemMessage> | null | undefined): number {
  const leftReadyAt = parseIsoTime(left?.nextAttemptAt) || 0;
  const rightReadyAt = parseIsoTime(right?.nextAttemptAt) || 0;
  if (leftReadyAt !== rightReadyAt) {
    return leftReadyAt - rightReadyAt;
  }
  const leftCreatedAt = parseIsoTime(left?.createdAt) || 0;
  const rightCreatedAt = parseIsoTime(right?.createdAt) || 0;
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

export function compareSystemMessageDeadLetters(left: Partial<SystemMessageDeadLetterEntry> | null | undefined, right: Partial<SystemMessageDeadLetterEntry> | null | undefined): number {
  const leftTime = parseIsoTime(left?.deadLetterAt) || 0;
  const rightTime = parseIsoTime(right?.deadLetterAt) || 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

export function compareTimelineScreenshotJobs(left: Partial<TimelineScreenshotJob> | null | undefined, right: Partial<TimelineScreenshotJob> | null | undefined): number {
  const leftTime = parseIsoTime(left?.createdAt) || 0;
  const rightTime = parseIsoTime(right?.createdAt) || 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

export function compareReminderQueueEntries(left: Partial<ReminderQueueEntry> | null | undefined, right: Partial<ReminderQueueEntry> | null | undefined): number {
  const leftDueAtMs = normalizePositiveInteger(left?.dueAtMs);
  const rightDueAtMs = normalizePositiveInteger(right?.dueAtMs);
  if (leftDueAtMs !== rightDueAtMs) {
    return leftDueAtMs - rightDueAtMs;
  }
  const leftCreatedAt = parseIsoTime(left?.createdAt) || 0;
  const rightCreatedAt = parseIsoTime(right?.createdAt) || 0;
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

export function clearSystemMessageInFlight(message: SystemMessage): SystemMessage | null {
  return normalizeSystemMessage({
    ...message,
    deliveryState: "pending",
    inFlightAt: "",
  });
}

export function markSystemMessageInFlight(message: SystemMessage, nowMs: any = Date.now()): SystemMessage | null {
  return normalizeSystemMessage({
    ...message,
    deliveryState: "in_flight",
    inFlightAt: formatIsoTime(nowMs),
  });
}

export function isSystemMessageExpired(message: Partial<SystemMessage> | null | undefined, nowMs: any = Date.now()): boolean {
  const expiresAtMs = parseIsoTime(message?.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

function inferSystemMessageKind(message: PlainObject): "checkin" | "reminder" | "manual" {
  const id = normalizeText(message.id);
  const text = normalizeText(message.text);
  if (id.startsWith("reminder:")) {
    return "reminder";
  }
  if (text.startsWith("Take a quiet look at whether now is a good moment to reach out to ")) {
    return "checkin";
  }
  return "manual";
}

export function normalizeSystemMessageKind(value: unknown): "checkin" | "reminder" | "manual" {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "checkin" || normalized === "reminder" ? normalized : "manual";
}

function normalizeSystemMessageDeliveryState(value: unknown): "pending" | "in_flight" {
  return normalizeText(value) === "in_flight" ? "in_flight" : "pending";
}

export function getSystemMessagePolicy(kind: unknown) {
  return SYSTEM_MESSAGE_KIND_POLICIES[normalizeSystemMessageKind(kind)]
    || SYSTEM_MESSAGE_KIND_POLICIES.manual;
}

function normalizeIsoTime(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function parseIsoTime(value: unknown): number {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatIsoTime(value: unknown): string {
  const numeric = Number(value);
  return new Date(Number.isFinite(numeric) ? numeric : Date.now()).toISOString();
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function normalizePositiveInteger(value: unknown): number {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
