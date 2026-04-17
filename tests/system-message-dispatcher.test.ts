const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { SystemMessageDispatcher }: typeof import("../src/core/system-message-dispatcher") = require("../src/core/system-message-dispatcher");
const { normalizeSystemMessage }: typeof import("../src/contracts/queue-items") = require("../src/contracts/queue-items");

function createSystemMessage(overrides: Record<string, unknown> = {}) {
  const message = normalizeSystemMessage({
    id: "system-msg-1",
    accountId: "acct-1",
    checkinTriggerId: "",
    senderId: "user-1",
    workspaceRoot: "E:/repo/message",
    text: "Follow up quietly.",
    kind: "manual",
    attemptCount: 0,
    lastAttemptAt: "",
    nextAttemptAt: "2026-04-13T06:00:00.000Z",
    expiresAt: "2026-04-14T06:00:00.000Z",
    lastFailureReason: "",
    deliveryState: "pending",
    inFlightAt: "",
    createdAt: "2026-04-13T06:00:00+08:00",
    ...overrides,
  });
  assert.ok(message);
  return message;
}

test("SystemMessageDispatcher builds backstage prepared messages with fallback workspace root", () => {
  const dispatcher = new SystemMessageDispatcher({
    accountId: "acct-1",
    config: {
      workspaceId: "workspace-1",
      workspaceRoot: "E:/repo/default",
      userName: "Dao",
    },
    queueStore: {
      hasPendingForAccount() {
        return false;
      },
      takeReadyForAccount() {
        return [];
      },
      defer() {
        return { status: "deferred", message: null };
      },
      deadLetter() {
        return { status: "dead_letter", message: null };
      },
      complete() {
        return { status: "sent", message: null };
      },
    },
  });

  assert.equal(dispatcher.resolveWorkspaceRoot({ workspaceRoot: "" }), "E:/repo/default");
  const prepared = dispatcher.buildPreparedMessage(createSystemMessage(), "ctx-1");

  assert.equal(prepared.provider, "system");
  assert.equal(prepared.workspaceId, "workspace-1");
  assert.equal(prepared.workspaceRoot, "E:/repo/message");
  assert.equal(prepared.contextToken, "ctx-1");
  assert.equal(prepared.systemMessageKind, "manual");
  assert.equal(prepared.checkinTriggerId, "");
  assert.match(prepared.text, /^系统触发。/u);
  assert.match(prepared.text, /只留在后台/u);
  assert.match(prepared.text, /Follow up quietly\./u);
  assert.equal(prepared.receivedAt, "2026-04-12T22:00:00.000Z");
});

test("SystemMessageDispatcher honors explicit English language for backstage prepared messages", () => {
  const dispatcher = new SystemMessageDispatcher({
    accountId: "acct-1",
    config: {
      workspaceId: "workspace-1",
      workspaceRoot: "E:/repo/default",
      userLanguage: "en",
      userName: "Dao",
    },
    queueStore: {
      hasPendingForAccount() {
        return false;
      },
      takeReadyForAccount() {
        return [];
      },
      defer() {
        return { status: "deferred", message: null };
      },
      deadLetter() {
        return { status: "dead_letter", message: null };
      },
      complete() {
        return { status: "sent", message: null };
      },
    },
  });

  const prepared = dispatcher.buildPreparedMessage(createSystemMessage(), "ctx-1");

  assert.match(prepared.text, /^System trigger\./u);
  assert.match(prepared.text, /stays backstage/u);
  assert.match(prepared.text, /Follow up quietly\./u);
});

test("SystemMessageDispatcher forwards ready checks through the account-scoped queue owner", () => {
  const calls: Array<{ accountId: string; nowMs: number | null }> = [];
  const dispatcher = new SystemMessageDispatcher({
    accountId: "acct-1",
    config: {
      workspaceId: "workspace-1",
      workspaceRoot: "E:/repo/default",
    },
    queueStore: {
      hasPendingForAccount(accountId: string) {
        calls.push({ accountId, nowMs: null });
        return true;
      },
      takeReadyForAccount(accountId: string, options?: { nowMs?: number }) {
        calls.push({ accountId, nowMs: options?.nowMs ?? null });
        return [createSystemMessage({ id: "system-msg-ready" })];
      },
      defer() {
        return { status: "deferred", message: null };
      },
      deadLetter() {
        return { status: "dead_letter", message: null };
      },
      complete() {
        return { status: "sent", message: null };
      },
    },
  });

  assert.equal(dispatcher.hasPending(), true);
  const ready = dispatcher.takeReadyPending(1234);

  assert.equal(ready.length, 1);
  assert.deepEqual(calls, [
    { accountId: "acct-1", nowMs: null },
    { accountId: "acct-1", nowMs: 1234 },
  ]);
});
