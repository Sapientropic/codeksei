const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { ReminderQueueStore }: typeof import("../src/state/reminder-queue-store") = require("../src/state/reminder-queue-store");

function createStore(): { filePath: string; store: InstanceType<typeof ReminderQueueStore> } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-reminder-queue-"));
  const filePath = path.join(tempRoot, "reminder-queue.json");
  return {
    filePath,
    store: new ReminderQueueStore({ filePath }),
  };
}

test("ReminderQueueStore normalizes persisted reminders through the shared queue contract", () => {
  const { store } = createStore();

  const reminder = store.enqueue({
    id: "reminder-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text: "起身喝水",
    dueAtMs: "1712908800000",
    createdAt: "2026-04-12T00:00:00.000Z",
  });

  assert.deepEqual(reminder, {
    id: "reminder-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text: "起身喝水",
    dueAtMs: 1712908800000,
    createdAt: "2026-04-12T00:00:00.000Z",
  });
  assert.equal(store.peekNextDueAtMs(), 1712908800000);
});

test("ReminderQueueStore accepts schema-repaired legacy reminders on load without quarantine", () => {
  const { filePath } = createStore();
  fs.writeFileSync(filePath, JSON.stringify({
    retained: true,
    reminders: [
      {
        id: "legacy-reminder",
        accountId: "acct-1",
        senderId: "user-1",
        contextToken: "ctx-1",
        text: "起身喝水",
        dueAtMs: "1712908800000",
        createdAt: "2026-04-12T00:00:00.000Z",
      },
    ],
  }, null, 2), "utf8");

  const reloaded = new ReminderQueueStore({ filePath });

  assert.equal(reloaded.peekNextDueAtMs(), 1712908800000);
  assert.equal(fs.existsSync(filePath), true);
  assert.deepEqual(reloaded.listDue(1712908800000), [{
    id: "legacy-reminder",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    text: "起身喝水",
    dueAtMs: 1712908800000,
    createdAt: "2026-04-12T00:00:00.000Z",
  }]);
});

test("ReminderQueueStore quarantines schema-invalid managed state on load", () => {
  const { filePath } = createStore();
  fs.writeFileSync(filePath, JSON.stringify({
    reminders: [
      {
        id: "bad",
        accountId: "acct-1",
        senderId: "user-1",
        contextToken: "ctx-1",
        text: "bad",
        dueAtMs: 0,
      },
    ],
  }, null, 2), "utf8");

  const reloaded = new ReminderQueueStore({ filePath });

  assert.equal(reloaded.peekNextDueAtMs(), 0);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(path.dirname(filePath)).some((entry) => /^reminder-queue\.corrupt-.*\.json$/.test(entry)),
    true
  );
});
