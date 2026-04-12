const {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} = require("./json-state");
const {
  compareReminderQueueEntries,
  normalizeReminderQueueEntry,
  reminderQueueStateSchema,
} = require("../contracts/queue-items");

class ReminderQueueStore {
  filePath: any;
  state: Record<string, any>;

  constructor({ filePath }: any) {
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
      schema: reminderQueueStateSchema,
    });
    const normalizedState = /** @type {{ reminders?: unknown[] }} */ (parsed || {});
    const reminders = Array.isArray(normalizedState.reminders) ? normalizedState.reminders : [];
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

  enqueue(reminder: any) {
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

  listDue(nowMs: any = Date.now()) {
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

export {};
