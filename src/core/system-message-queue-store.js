const path = require("path");
const {
  ensureParentDirectory,
  isPlainObject,
  readJsonStateFile,
  writeJsonStateFile,
} = require("./json-state");

const SYSTEM_MESSAGE_KIND_POLICIES = Object.freeze({
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
        .map(normalizeDeadLetterEntry)
        .filter(Boolean)
        .sort(compareDeadLetterEntries),
    };
  }

  saveDeadLetters(state) {
    const nextEntries = Array.isArray(state?.entries)
      ? state.entries.map(normalizeDeadLetterEntry).filter(Boolean).sort(compareDeadLetterEntries)
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
    const nowIso = formatIsoTime(nowMs);
    let changed = false;

    for (const message of this.state.messages) {
      if (message.accountId !== normalizedAccountId) {
        pending.push(message);
        continue;
      }
      const nextAttemptAtMs = parseIsoTime(message.nextAttemptAt) || parseIsoTime(nowIso);
      if (nextAttemptAtMs > nowMs) {
        pending.push(message);
        continue;
      }
      if (isMessageInFlight(message, nowMs)) {
        pending.push(message);
        continue;
      }

      // Ready backstage work is leased in-place instead of being removed from
      // the queue up front. A crash after selection but before sent/deferred/
      // dead-letter resolution should leave the message recoverable, not lost.
      const leased = markMessageInFlight(message, nowMs);
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
    if (isExpiredMessage(updated, nowMs)) {
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
      if (isExpiredMessage(message, nowMs)) {
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
      message: clearMessageInFlight(normalizedMessage),
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
      ...clearMessageInFlight(message),
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

function normalizeSystemMessage(message) {
  if (!message || typeof message !== "object") {
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

function normalizeDeadLetterEntry(entry) {
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

function inferSystemMessageKind(message) {
  const id = normalizeText(message?.id);
  const text = normalizeText(message?.text);
  if (id.startsWith("reminder:")) {
    return "reminder";
  }
  if (text.startsWith("Take a quiet look at whether now is a good moment to reach out to ")) {
    return "checkin";
  }
  return "manual";
}

function normalizeSystemMessageKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "checkin" || normalized === "reminder" ? normalized : "manual";
}

function getSystemMessagePolicy(kind) {
  return SYSTEM_MESSAGE_KIND_POLICIES[normalizeSystemMessageKind(kind)] || SYSTEM_MESSAGE_KIND_POLICIES.manual;
}

function isExpiredMessage(message, nowMs = Date.now()) {
  const expiresAtMs = parseIsoTime(message?.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

function compareSystemMessages(left, right) {
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

function compareDeadLetterEntries(left, right) {
  const leftTime = parseIsoTime(left?.deadLetterAt) || 0;
  const rightTime = parseIsoTime(right?.deadLetterAt) || 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
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

function normalizeSystemMessageDeliveryState(value) {
  return normalizeText(value) === "in_flight" ? "in_flight" : "pending";
}

function isMessageInFlight(message, nowMs = Date.now()) {
  if (normalizeSystemMessageDeliveryState(message?.deliveryState) !== "in_flight") {
    return false;
  }
  const inFlightAtMs = parseIsoTime(message?.inFlightAt);
  if (!inFlightAtMs) {
    return false;
  }
  return inFlightAtMs + SYSTEM_MESSAGE_IN_FLIGHT_LEASE_MS > nowMs;
}

function markMessageInFlight(message, nowMs = Date.now()) {
  return normalizeSystemMessage({
    ...message,
    deliveryState: "in_flight",
    inFlightAt: formatIsoTime(nowMs),
  });
}

function clearMessageInFlight(message) {
  return normalizeSystemMessage({
    ...message,
    deliveryState: "pending",
    inFlightAt: "",
  });
}

function normalizeIsoTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString();
}

function parseIsoTime(value) {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatIsoTime(value) {
  const numeric = Number(value);
  return new Date(Number.isFinite(numeric) ? numeric : Date.now()).toISOString();
}

function normalizeNonNegativeInteger(value) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateSystemMessageQueueState(state) {
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

function validateSystemMessageDeadLetterState(state) {
  if (!isPlainObject(state)) {
    return "system message dead letter top-level state must be an object";
  }
  if (!Array.isArray(state.entries)) {
    return "system message dead letter entries must be an array";
  }
  for (let index = 0; index < state.entries.length; index += 1) {
    if (!normalizeDeadLetterEntry(state.entries[index])) {
      return `system message dead letter entries[${index}] is invalid`;
    }
  }
  return true;
}

module.exports = {
  SystemMessageQueueStore,
  SYSTEM_MESSAGE_KIND_POLICIES,
};
