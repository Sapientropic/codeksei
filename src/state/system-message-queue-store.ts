import { normalizeText } from "../core/text-normalization";
import * as path from "node:path";

import {
  clearSystemMessageInFlight,
  compareSystemMessageDeadLetters,
  compareSystemMessages,
  getSystemMessagePolicy,
  isSystemMessageExpired,
  markSystemMessageInFlight,
  normalizeSystemMessage,
  normalizeSystemMessageDeadLetterEntry,
  SYSTEM_MESSAGE_KIND_POLICIES,
  type SystemMessageDeadLetterEntry,
  type SystemMessage,
  systemMessageDeadLetterStateSchema,
  systemMessageQueueStateSchema,
} from "../contracts/queue-items";
import {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "./json-state";
import type { ZodType } from "zod";

const SYSTEM_MESSAGE_IN_FLIGHT_LEASE_MS = 60_000;

interface SystemMessageQueueState {
  messages: SystemMessage[];
}

interface SystemMessageDeadLetterState {
  entries: SystemMessageDeadLetterEntry[];
}

class SystemMessageQueueStore {
  deadLetterFilePath: string;
  filePath: string;
  state: SystemMessageQueueState;

  constructor({ filePath, deadLetterFilePath = "" }: { filePath: string; deadLetterFilePath?: unknown }) {
    this.filePath = filePath;
    this.deadLetterFilePath = normalizeText(deadLetterFilePath)
      || path.join(path.dirname(filePath), "system-message-dead-letter.json");
    this.state = { messages: [] };
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory(): void {
    ensureParentDirectory(this.filePath);
    ensureParentDirectory(this.deadLetterFilePath);
  }

  load(): void {
    // systemMessageQueueStateSchema is the one ingress that repairs legacy queue
    // payloads. Once data crosses that boundary, the store should sort/clone it
    // instead of re-normalizing the same record on every load/save cycle.
    const parsed = readManagedJsonStateFile<{ messages?: SystemMessage[] }>({
      filePath: this.filePath,
      fallback: { messages: [] },
      label: "system message queue",
      schema: systemMessageQueueStateSchema as ZodType<{ messages: SystemMessage[] }>,
    });
    const normalizedState = parsed || {};
    const messages = Array.isArray(normalizedState.messages) ? normalizedState.messages.slice() : [];
    this.state = {
      messages: messages.sort(compareSystemMessages),
    };
  }

  save(): void {
    this.persistMessages(this.state.messages);
  }

  persistMessages(messages: SystemMessage[]): SystemMessage[] {
    const nextMessages = Array.isArray(messages)
      ? messages.slice().sort(compareSystemMessages)
      : [];
    writeManagedJsonStateFile(this.filePath, { messages: nextMessages });
    this.state = { messages: nextMessages };
    return nextMessages;
  }

  loadDeadLetters(): SystemMessageDeadLetterState {
    const parsed = readManagedJsonStateFile<{ entries?: SystemMessageDeadLetterEntry[] }>({
      filePath: this.deadLetterFilePath,
      fallback: { entries: [] },
      label: "system message dead letter",
      schema: systemMessageDeadLetterStateSchema as ZodType<{ entries: SystemMessageDeadLetterEntry[] }>,
    });
    // Dead-letter payloads share the same single-ingress contract as the live
    // queue. Once schema parse succeeds here, stores should only clone/sort the
    // canonical entries instead of re-running per-entry repair.
    const normalizedState = parsed || {};
    const entries = Array.isArray(normalizedState.entries)
      ? normalizedState.entries.slice()
      : [];
    return {
      entries: entries.sort(compareSystemMessageDeadLetters),
    };
  }

  saveDeadLetters(state: SystemMessageDeadLetterState): SystemMessageDeadLetterState {
    const nextEntries = Array.isArray(state?.entries)
      ? state.entries.slice().sort(compareSystemMessageDeadLetters)
      : [];
    writeManagedJsonStateFile(this.deadLetterFilePath, { entries: nextEntries });
    return { entries: nextEntries };
  }

  listDeadLetters(): SystemMessageDeadLetterEntry[] {
    return this.loadDeadLetters().entries;
  }

  enqueue(message: unknown): SystemMessage {
    this.load();
    const normalized = normalizeSystemMessage(message);
    if (!normalized) {
      throw new Error("invalid system message");
    }
    upsertMessage(this.state.messages, normalized);
    this.state.messages.sort(compareSystemMessages);
    this.save();
    return normalized;
  }

  takeReadyForAccount(accountId: unknown, { nowMs = Date.now() }: { nowMs?: number } = {}): SystemMessage[] {
    this.load();
    this.expireMessages(nowMs);
    const normalizedAccountId = normalizeText(accountId);
    const ready = [];
    const pending = [];
    let changed = false;

    for (const message of this.state.messages) {
      if (message.accountId !== normalizedAccountId) {
        pending.push(message);
        continue;
      }
      const nextAttemptAtMs = parseIsoTime(message.nextAttemptAt) || nowMs;
      if (nextAttemptAtMs > nowMs) {
        pending.push(message);
        continue;
      }
      if (isMessageInFlight(message, nowMs)) {
        pending.push(message);
        continue;
      }

      const leased = markSystemMessageInFlight(message, nowMs);
      if (!leased) {
        pending.push(message);
        continue;
      }
      ready.push(leased);
      pending.push(leased);
      changed = true;
    }

    if (changed) {
      this.persistMessages(pending);
    }

    return ready;
  }

  hasPendingForAccount(accountId: unknown, { nowMs = Date.now() }: { nowMs?: number } = {}): boolean {
    this.load();
    this.expireMessages(nowMs);
    const normalizedAccountId = normalizeText(accountId);
    return this.state.messages.some((message) => message.accountId === normalizedAccountId);
  }

  defer(message: unknown, {
    delayMs = 0,
    reason = "",
    countAttempt = false,
    nowMs = Date.now(),
  }: {
    delayMs?: number;
    reason?: unknown;
    countAttempt?: boolean;
    nowMs?: number;
  } = {}) {
    this.load();
    this.expireMessages(nowMs);
    const normalized = this.findMessage(message) || normalizeSystemMessage(message);
    if (!normalized) {
      throw new Error("invalid system message");
    }
    const updated = normalizeSystemMessage({
      ...normalized,
      attemptCount: countAttempt ? normalized.attemptCount + 1 : normalized.attemptCount,
      lastAttemptAt: formatIsoTime(nowMs),
      nextAttemptAt: formatIsoTime(nowMs + Math.max(0, Number(delayMs) || 0)),
      lastFailureReason: normalizeText(reason) || normalized.lastFailureReason,
      deliveryState: "pending",
      inFlightAt: "",
    });
    if (!updated) {
      throw new Error("invalid deferred system message");
    }

    const policy = getSystemMessagePolicy(updated.kind);
    if (isSystemMessageExpired(updated, nowMs)) {
      const [deadLetter] = this.moveMessagesToDeadLetter([updated], "expired", nowMs);
      return {
        status: "dead_letter",
        message: deadLetter || updated,
      };
    }
    if (updated.attemptCount >= policy.maxAttempts) {
      const [deadLetter] = this.moveMessagesToDeadLetter(
        [updated],
        normalizeText(reason) || "max_attempts_exceeded",
        nowMs
      );
      return {
        status: "dead_letter",
        message: deadLetter || updated,
      };
    }

    upsertMessage(this.state.messages, updated);
    this.persistMessages(this.state.messages);
    return {
      status: "deferred",
      message: updated,
    };
  }

  expireMessages(nowMs: number = Date.now()): SystemMessageDeadLetterEntry[] {
    const expired: SystemMessage[] = [];

    for (const message of this.state.messages) {
      if (isSystemMessageExpired(message, nowMs)) {
        expired.push(message);
      }
    }

    if (!expired.length) {
      return [];
    }

    return this.moveMessagesToDeadLetter(expired, "expired", nowMs);
  }

  appendDeadLetter(message: unknown, reason: unknown, nowMs: number = Date.now()): SystemMessageDeadLetterEntry | null {
    const normalizedMessage = normalizeSystemMessage(message);
    if (!normalizedMessage) {
      return null;
    }
    const deadLetters = this.loadDeadLetters();
    const nextEntry = {
      ...normalizedMessage,
      deadLetterReason: normalizeText(reason) || "dead_letter",
      deadLetterAt: formatIsoTime(nowMs),
    } satisfies SystemMessageDeadLetterEntry;
    upsertDeadLetterEntry(deadLetters.entries, nextEntry);
    const persisted = this.saveDeadLetters(deadLetters);
    return persisted.entries.find((entry) => entry.id === nextEntry.id) || nextEntry;
  }

  deadLetter(message: unknown, {
    reason = "",
    nowMs = Date.now(),
  }: {
    reason?: unknown;
    nowMs?: number;
  } = {}) {
    this.load();
    this.expireMessages(nowMs);
    const normalizedMessage = this.findMessage(message) || normalizeSystemMessage(message);
    if (!normalizedMessage) {
      return { status: "dead_letter", message: null };
    }

    const [deadLetter] = this.moveMessagesToDeadLetter(
      [normalizedMessage],
      normalizeText(reason) || "dead_letter",
      nowMs
    );
    return {
      status: "dead_letter",
      message: deadLetter || normalizedMessage,
    };
  }

  complete(message: unknown, { nowMs = Date.now() }: { nowMs?: number } = {}) {
    this.load();
    this.expireMessages(nowMs);
    const normalizedMessage = this.findMessage(message) || normalizeSystemMessage(message);
    if (!normalizedMessage) {
      return { status: "sent", message: null };
    }

    const nextMessages = this.state.messages.filter((entry) => entry.id !== normalizedMessage.id);
    if (nextMessages.length !== this.state.messages.length) {
      this.persistMessages(nextMessages);
    }
    return {
      status: "sent",
      message: clearSystemMessageInFlight(normalizedMessage),
    };
  }

  findMessage(message: unknown): SystemMessage | null {
    const normalizedId = normalizeText(asRecord(message).id);
    if (!normalizedId) {
      return null;
    }
    const existing = this.state.messages.find((entry) => entry.id === normalizedId);
    return existing || null;
  }

  moveMessagesToDeadLetter(
    messages: unknown,
    reason: unknown,
    nowMs: number = Date.now(),
  ): SystemMessageDeadLetterEntry[] {
    const normalizedReason = normalizeText(reason) || "dead_letter";
    const normalizedMessages = Array.isArray(messages)
      ? messages.filter((message): message is SystemMessage => Boolean(message && normalizeText(asRecord(message).id)))
      : [];
    if (!normalizedMessages.length) {
      return [];
    }

    const deadLetters = this.loadDeadLetters();
    const deadLetterEntries = normalizedMessages
      .map((message) => {
        const cleared = clearSystemMessageInFlight(message);
        return cleared ? {
          ...cleared,
          deadLetterReason: normalizedReason,
          deadLetterAt: formatIsoTime(nowMs),
        } satisfies SystemMessageDeadLetterEntry : null;
      })
      .filter((entry): entry is SystemMessageDeadLetterEntry => Boolean(entry));
    for (const entry of deadLetterEntries) {
      upsertDeadLetterEntry(deadLetters.entries, entry);
    }
    this.saveDeadLetters(deadLetters);

    const deadLetterIds = new Set(deadLetterEntries.map((entry) => entry.id));
    const nextMessages = this.state.messages.filter((entry) => !deadLetterIds.has(entry.id));
    this.persistMessages(nextMessages);
    return deadLetterEntries;
  }
}

function upsertMessage(messages: SystemMessage[], nextMessage: SystemMessage): void {
  const index = messages.findIndex((entry) => entry.id === nextMessage.id);
  if (index >= 0) {
    messages[index] = nextMessage;
    return;
  }
  messages.push(nextMessage);
}

function upsertDeadLetterEntry(entries: SystemMessageDeadLetterEntry[], nextEntry: SystemMessageDeadLetterEntry): void {
  const index = entries.findIndex((entry) => entry.id === nextEntry.id);
  if (index >= 0) {
    entries[index] = nextEntry;
    return;
  }
  entries.push(nextEntry);
}

function isMessageInFlight(message: Partial<SystemMessage> | null | undefined, nowMs: number = Date.now()): boolean {
  if (normalizeText(message?.deliveryState) !== "in_flight") {
    return false;
  }
  const inFlightAtMs = parseIsoTime(message?.inFlightAt);
  if (!inFlightAtMs) {
    return false;
  }
  return inFlightAtMs + SYSTEM_MESSAGE_IN_FLIGHT_LEASE_MS > nowMs;
}

function parseIsoTime(value: unknown): number {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatIsoTime(value: unknown): string {
  const numeric = Number(value);
  return new Date(Number.isFinite(numeric) ? numeric : Date.now()).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export {
  SystemMessageQueueStore,
  SYSTEM_MESSAGE_KIND_POLICIES,
};

