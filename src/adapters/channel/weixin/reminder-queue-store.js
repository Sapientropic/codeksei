const {
  ensureParentDirectory,
  isPlainObject,
  readJsonStateFile,
  writeJsonStateFile,
} = require("../../../core/json-state");

class ReminderQueueStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = { reminders: [] };
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    ensureParentDirectory(this.filePath);
  }

  load() {
    const parsed = readJsonStateFile({
      filePath: this.filePath,
      fallback: { reminders: [] },
      label: "reminder queue",
      validate: validateReminderQueueState,
    });
    const reminders = Array.isArray(parsed?.reminders) ? parsed.reminders : [];
    this.state = {
      reminders: reminders
        .map(normalizeReminder)
        .filter(Boolean)
        .sort((left, right) => left.dueAtMs - right.dueAtMs),
    };
  }

  save() {
    writeJsonStateFile(this.filePath, this.state);
  }

  enqueue(reminder) {
    this.load();
    const normalized = normalizeReminder(reminder);
    if (!normalized) {
      throw new Error("invalid reminder");
    }
    this.state.reminders.push(normalized);
    this.state.reminders.sort((left, right) => left.dueAtMs - right.dueAtMs);
    this.save();
    return normalized;
  }

  listDue(nowMs = Date.now()) {
    this.load();
    const due = [];
    const pending = [];

    for (const reminder of this.state.reminders) {
      if (reminder.dueAtMs <= nowMs) {
        due.push(reminder);
      } else {
        pending.push(reminder);
      }
    }

    if (due.length) {
      this.state.reminders = pending;
      this.save();
    }

    return due;
  }

  peekNextDueAtMs() {
    this.load();
    const first = this.state.reminders[0];
    return Number.isFinite(first?.dueAtMs) ? first.dueAtMs : 0;
  }
}

function normalizeReminder(reminder) {
  if (!reminder || typeof reminder !== "object") {
    return null;
  }
  const id = typeof reminder.id === "string" ? reminder.id.trim() : "";
  const accountId = typeof reminder.accountId === "string" ? reminder.accountId.trim() : "";
  const senderId = typeof reminder.senderId === "string" ? reminder.senderId.trim() : "";
  const contextToken = typeof reminder.contextToken === "string" ? reminder.contextToken.trim() : "";
  const text = typeof reminder.text === "string" ? reminder.text.trim() : "";
  const dueAtMs = Number(reminder.dueAtMs);
  const createdAt = typeof reminder.createdAt === "string" ? reminder.createdAt.trim() : "";
  if (!id || !accountId || !senderId || !contextToken || !text || !Number.isFinite(dueAtMs) || dueAtMs <= 0) {
    return null;
  }
  return {
    id,
    accountId,
    senderId,
    contextToken,
    text,
    dueAtMs,
    createdAt: createdAt || new Date().toISOString(),
  };
}

function validateReminderQueueState(state) {
  if (!isPlainObject(state)) {
    return "reminder queue top-level state must be an object";
  }
  if (!Array.isArray(state.reminders)) {
    return "reminder queue reminders must be an array";
  }
  for (let index = 0; index < state.reminders.length; index += 1) {
    if (!normalizeReminder(state.reminders[index])) {
      return `reminder queue reminders[${index}] is invalid`;
    }
  }
  return true;
}

module.exports = { ReminderQueueStore };
