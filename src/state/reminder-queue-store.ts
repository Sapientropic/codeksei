import {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "./json-state";
import {
  compareReminderQueueEntries,
  normalizeReminderQueueEntry,
  reminderQueueStateSchema,
  type ReminderQueueEntry,
} from "../contracts/queue-items";

interface ReminderQueueState {
  reminders: ReminderQueueEntry[];
}

class ReminderQueueStore {
  filePath: string;
  state: ReminderQueueState;

  constructor({ filePath }: { filePath: string }) {
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
    const normalizedState = /** @type {{ reminders?: import("../contracts/queue-items").ReminderQueueEntry[] }} */ (parsed || {});
    const reminders = Array.isArray(normalizedState.reminders)
      ? normalizedState.reminders.slice() as ReminderQueueEntry[]
      : [];
    this.state = {
      reminders: reminders.sort(compareReminderQueueEntries),
    };
  }

  save() {
    writeManagedJsonStateFile(this.filePath, this.state);
  }

  enqueue(reminder: unknown): ReminderQueueEntry {
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

  listDue(nowMs = Date.now()): ReminderQueueEntry[] {
    this.load();
    const due: ReminderQueueEntry[] = [];
    const pending: ReminderQueueEntry[] = [];

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

  peekNextDueAtMs(): number {
    this.load();
    const first = this.state.reminders[0];
    const dueAtMs = first?.dueAtMs;
    return typeof dueAtMs === "number" && Number.isFinite(dueAtMs) ? dueAtMs : 0;
  }
}

export { ReminderQueueStore };
