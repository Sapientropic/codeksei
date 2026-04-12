// @ts-check

const path = require("path");
const {
  clearSystemMessageInFlight,
  compareSystemMessageDeadLetters,
  compareSystemMessages,
  getSystemMessagePolicy,
  isSystemMessageExpired,
  markSystemMessageInFlight,
  normalizeSystemMessage,
  normalizeSystemMessageDeadLetterEntry,
  SYSTEM_MESSAGE_KIND_POLICIES,
  validateSystemMessageDeadLetterState,
  validateSystemMessageQueueState,
} = require("../contracts/queue-items");
const {
  ensureParentDirectory,
  readJsonStateFile,
  writeJsonStateFile,
} = require("./json-state");

const SYSTEM_MESSAGE_IN_FLIGHT_LEASE_MS = 60_000;

class SystemMessageQueueStore {
  constructor({ filePath, deadLetterFilePath = "" }) {
    this.filePath = filePath;
    this.deadLetterFilePath = normalizeText(deadLetterFilePath)
      || path.join(path.dirname(filePath), "system-message-dead-letter.json");
    this.state = { messages: [] };
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    ensureParentDirectory(this.filePath);
    ensureParentDirectory(this.deadLetterFilePath);
  }

  load() {
    const parsed = readJsonStateFile({
      filePath: this.filePath,
      fallback: { messages: [] },
      label: "system message queue",
      validate: validateSystemMessageQueueState,
    });
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    this.state = {
      messages: messages
        .map(normalizeSystemMessage)
        .filter(Boolean)
        .sort(compareSystemMessages),
    };
  }

  save() {
    this.persistMessages(this.state.messages);
  }

  persistMessages(messages) {
    const nextMessages = Array.isArray(messages)
      ? messages.map(normalizeSystemMessage).filter(Boolean).sort(compareSystemMessages)
      : [];
    writeJsonStateFile(this.filePath, { messages: nextMessages });
    this.state = { messages: nextMessages };
    return nextMessages;
  }

  loadDeadLetters() {
    const parsed = readJsonStateFile({
      filePath: this.deadLetterFilePath,
      fallback: { entries: [] },
      label: "system message dead letter",
      validate: validateSystemMessageDeadLetterState,
    });
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return {
      entries: entries
        .map(normalizeSystemMessageDeadLetterEntry)
        .filter(Boolean)
        .sort(compareSystemMessageDeadLetters),
    };
  }

  saveDeadLetters(state) {
    const nextEntries = Array.isArray(state?.entries)
      ? state.entries
        .map(normalizeSystemMessageDeadLetterEntry)
        .filter(Boolean)
        .sort(compareSystemMessageDeadLetters)
      : [];
    writeJsonStateFile(this.deadLetterFilePath, { entries: nextEntries });
    return { entries: nextEntries };
  }

  listDeadLetters() {
    return this.loadDeadLetters().entries;
  }

  enqueue(message) {
    this.load();
    this.expireMessages(Date.now());
    const normalized = normalizeSystemMessage(message);
    if (!normalized) {
      throw new Error("invalid system message");
    }
    upsertMessage(this.state.messages, normalized);
    this.state.messages.sort(compareSystemMessages);
    this.save();
    return normalized;
  }

  takeReadyForAccount(accountId, { nowMs = Date.now() } = {}) {
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
      ready.push(leased);
      pending.push(leased);
      changed = true;
    }

    if (changed) {
      this.persistMessages(pending);
    }

    return ready;
  }

  hasPendingForAccount(accountId, { nowMs = Date.now() } = {}) {
    this.load();
    this.expireMessages(nowMs);
    const normalizedAccountId = normalizeText(accountId);
    return this.state.messages.some((message) => message.accountId === normalizedAccountId);
  }

  defer(message, {
    delayMs = 0,
    reason = "",
    countAttempt = false,
    nowMs = Date.now(),
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

  expireMessages(nowMs = Date.now()) {
    const expired = [];

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

  appendDeadLetter(message, reason, nowMs = Date.now()) {
    const normalizedMessage = normalizeSystemMessage(message);
    if (!normalizedMessage) {
      return null;
    }
    const deadLetters = this.loadDeadLetters();
    const nextEntry = {
      ...normalizedMessage,
      deadLetterReason: normalizeText(reason) || "dead_letter",
      deadLetterAt: formatIsoTime(nowMs),
    };
    upsertDeadLetterEntry(deadLetters.entries, nextEntry);
    const persisted = this.saveDeadLetters(deadLetters);
    return persisted.entries.find((entry) => entry.id === nextEntry.id) || nextEntry;
  }

  deadLetter(message, { reason = "", nowMs = Date.now() } = {}) {
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

  complete(message, { nowMs = Date.now() } = {}) {
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

  findMessage(message) {
    const normalizedId = normalizeText(message?.id);
    if (!normalizedId) {
      return null;
    }
    const existing = this.state.messages.find((entry) => entry.id === normalizedId);
    return existing || null;
  }

  moveMessagesToDeadLetter(messages, reason, nowMs = Date.now()) {
    const normalizedReason = normalizeText(reason) || "dead_letter";
    const normalizedMessages = Array.isArray(messages)
      ? messages.map((message) => normalizeSystemMessage(message)).filter(Boolean)
      : [];
    if (!normalizedMessages.length) {
      return [];
    }

    const deadLetters = this.loadDeadLetters();
    const deadLetterEntries = normalizedMessages.map((message) => ({
      ...clearSystemMessageInFlight(message),
      deadLetterReason: normalizedReason,
      deadLetterAt: formatIsoTime(nowMs),
    }));
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

function upsertMessage(messages, nextMessage) {
  const index = messages.findIndex((entry) => entry.id === nextMessage.id);
  if (index >= 0) {
    messages[index] = nextMessage;
    return;
  }
  messages.push(nextMessage);
}

function upsertDeadLetterEntry(entries, nextEntry) {
  const index = entries.findIndex((entry) => entry.id === nextEntry.id);
  if (index >= 0) {
    entries[index] = nextEntry;
    return;
  }
  entries.push(nextEntry);
}

function isMessageInFlight(message, nowMs = Date.now()) {
  if (normalizeText(message?.deliveryState) !== "in_flight") {
    return false;
  }
  const inFlightAtMs = parseIsoTime(message?.inFlightAt);
  if (!inFlightAtMs) {
    return false;
  }
  return inFlightAtMs + SYSTEM_MESSAGE_IN_FLIGHT_LEASE_MS > nowMs;
}

function parseIsoTime(value) {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatIsoTime(value) {
  const numeric = Number(value);
  return new Date(Number.isFinite(numeric) ? numeric : Date.now()).toISOString();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  SystemMessageQueueStore,
  SYSTEM_MESSAGE_KIND_POLICIES,
};
