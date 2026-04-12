// @ts-nocheck
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { SessionStore } = require("../src/adapters/runtime/codex/session-store");
const { loadWeixinAccount, saveWeixinAccount } = require("../src/adapters/channel/weixin/account-store");
const {
  loadPersistedContextTokens,
  persistContextToken,
} = require("../src/adapters/channel/weixin/context-token-store");
const { loadSyncBuffer, saveSyncBuffer } = require("../src/adapters/channel/weixin/sync-buffer-store");
const {
  reminderQueueStateSchema,
  systemMessageDeadLetterStateSchema,
  systemMessageQueueStateSchema,
  timelineScreenshotQueueStateSchema,
} = require("../src/contracts/queue-items");
const { sessionStoreStateSchema } = require("../src/contracts/session-state");
const { ReminderQueueStore } = require("../src/state/reminder-queue-store");
const { SystemMessageQueueStore } = require("../src/state/system-message-queue-store");
const { TimelineScreenshotQueueStore } = require("../src/state/timeline-screenshot-queue-store");
const {
  readSharedBridgeHeartbeat,
  writeSharedBridgeHeartbeat,
} = require("../src/shared/shared-bridge-heartbeat");

function createWeixinConfig(tempRoot) {
  return {
    accountsDir: path.join(tempRoot, "accounts"),
    weixinBaseUrl: "http://127.0.0.1",
    weixinRouteTag: "default",
  };
}

test("managed state ownership matrix stays single-owner and executable", () => {
  const ownershipMatrix = [
    {
      file: "sessions.json",
      schemaExports: [sessionStoreStateSchema],
      storeExports: [SessionStore],
    },
    {
      file: "system-message-queue.json",
      schemaExports: [systemMessageQueueStateSchema, systemMessageDeadLetterStateSchema],
      storeExports: [SystemMessageQueueStore],
    },
    {
      file: "timeline-screenshot-queue.json",
      schemaExports: [timelineScreenshotQueueStateSchema],
      storeExports: [TimelineScreenshotQueueStore],
    },
    {
      file: "reminder-queue.json",
      schemaExports: [reminderQueueStateSchema],
      storeExports: [ReminderQueueStore],
    },
    {
      file: "shared bridge heartbeat",
      schemaExports: [readSharedBridgeHeartbeat, writeSharedBridgeHeartbeat],
      storeExports: [readSharedBridgeHeartbeat, writeSharedBridgeHeartbeat],
    },
    {
      file: "weixin account state",
      schemaExports: [loadWeixinAccount, saveWeixinAccount],
      storeExports: [loadWeixinAccount, saveWeixinAccount],
    },
    {
      file: "weixin context tokens",
      schemaExports: [loadPersistedContextTokens, persistContextToken],
      storeExports: [loadPersistedContextTokens, persistContextToken],
    },
    {
      file: "weixin sync buffer",
      schemaExports: [loadSyncBuffer, saveSyncBuffer],
      storeExports: [loadSyncBuffer, saveSyncBuffer],
    },
  ];

  assert.equal(new Set(ownershipMatrix.map((entry) => entry.file)).size, ownershipMatrix.length);
  for (const entry of ownershipMatrix) {
    assert.ok(entry.schemaExports.every(Boolean), `${entry.file} should expose one schema ingress/validator owner`);
    assert.ok(entry.storeExports.every(Boolean), `${entry.file} should expose one store owner`);
  }
});

test("loadWeixinAccount quarantines schema-invalid managed state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-account-state-"));
  const config = createWeixinConfig(tempRoot);
  fs.mkdirSync(config.accountsDir, { recursive: true });
  const filePath = path.join(config.accountsDir, "acct-1.json");
  fs.writeFileSync(filePath, JSON.stringify({ token: ["bad"] }, null, 2), "utf8");

  const account = loadWeixinAccount(config, "acct-1");

  assert.equal(account, null);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(config.accountsDir).some((entry) => /^acct-1\.corrupt-.*\.json$/.test(entry)),
    true
  );
});

test("saveWeixinAccount round-trips through managed state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-account-save-"));
  const config = createWeixinConfig(tempRoot);

  saveWeixinAccount(config, "acct-1", {
    token: "token-1",
    baseUrl: "http://bridge.local",
    userId: "wx-user",
    routeTag: "default",
  });

  const account = loadWeixinAccount(config, "acct-1");
  assert.equal(account.accountId, "acct-1");
  assert.equal(account.token, "token-1");
  assert.equal(account.baseUrl, "http://bridge.local");
  assert.equal(account.userId, "wx-user");
});

test("loadPersistedContextTokens quarantines schema-invalid managed state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-context-state-"));
  const config = createWeixinConfig(tempRoot);
  fs.mkdirSync(config.accountsDir, { recursive: true });
  const filePath = path.join(config.accountsDir, "acct-1.context-tokens.json");
  fs.writeFileSync(filePath, JSON.stringify({ "wx-user": ["bad"] }, null, 2), "utf8");

  const tokens = loadPersistedContextTokens(config, "acct-1");

  assert.deepEqual(tokens, {});
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(config.accountsDir).some((entry) => /^acct-1\.context-tokens\.corrupt-.*\.json$/.test(entry)),
    true
  );
});

test("persistContextToken round-trips through managed state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-context-save-"));
  const config = createWeixinConfig(tempRoot);

  persistContextToken(config, "acct-1", "wx-user", "ctx-1");

  assert.deepEqual(loadPersistedContextTokens(config, "acct-1"), {
    "wx-user": "ctx-1",
  });
});

test("sync buffer store round-trips through its single state owner", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-sync-buffer-save-"));
  const config = {
    ...createWeixinConfig(tempRoot),
    syncBufferDir: path.join(tempRoot, "sync-buffers"),
  };

  saveSyncBuffer(config, "acct-1", "buf-1");

  assert.equal(loadSyncBuffer(config, "acct-1"), "buf-1");
});

test("readSharedBridgeHeartbeat quarantines schema-invalid managed state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-heartbeat-state-"));
  const filePath = path.join(tempRoot, "shared-heartbeat.json");
  fs.writeFileSync(filePath, JSON.stringify({ pid: {} }, null, 2), "utf8");

  const heartbeat = readSharedBridgeHeartbeat(filePath);

  assert.equal(heartbeat, null);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(tempRoot).some((entry) => /^shared-heartbeat\.corrupt-.*\.json$/.test(entry)),
    true
  );
});

test("writeSharedBridgeHeartbeat round-trips through managed state", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-heartbeat-save-"));
  const filePath = path.join(tempRoot, "shared-heartbeat.json");

  writeSharedBridgeHeartbeat(filePath, {
    pid: 12345,
    status: "running",
    accountId: "acct-1",
  });

  const heartbeat = readSharedBridgeHeartbeat(filePath);
  assert.equal(heartbeat.pid, 12345);
  assert.equal(heartbeat.status, "running");
  assert.equal(heartbeat.accountId, "acct-1");
  assert.match(heartbeat.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
