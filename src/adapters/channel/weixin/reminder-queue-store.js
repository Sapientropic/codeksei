const {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} = require("../../../core/json-state");
const {
  compareReminderQueueEntries,
  normalizeReminderQueueEntry,
  validateReminderQueueState,
} = require("../../../contracts/queue-items");

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
    const parsed = readManagedJsonStateFile({
      filePath: this.filePath,
      fallback: { reminders: [] },
      label: "reminder queue",
      validate: validateReminderQueueState,
    });
    const reminders = Array.isArray(parsed?.reminders) ? parsed.reminders : [];
    this.state = {
      reminders: reminders
        .map(normalizeReminderQueueEntry)
        .filter(Boolean)
        .sort(compareReminderQueueEntries),
    };
  }

  save() {
    writeManagedJsonStateFile(this.filePath, this.state);
  }

  enqueue(reminder) {
    this.load();
    const normalized = normalizeReminderQueueEntry(reminder);
    if (!normalized) {
      throw new Error("invalid reminder");
    }
    this.state.reminders.push(normalized);
    this.state.reminders.sort(compareReminderQueueEntries);
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

module.exports = { ReminderQueueStore };
