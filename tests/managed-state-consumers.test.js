const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadWeixinAccount, saveWeixinAccount } = require("../src/adapters/channel/weixin/account-store");
const {
  loadPersistedContextTokens,
  persistContextToken,
} = require("../src/adapters/channel/weixin/context-token-store");
const {
  readSharedBridgeHeartbeat,
  writeSharedBridgeHeartbeat,
} = require("../src/core/shared-bridge-heartbeat");

function createWeixinConfig(tempRoot) {
  return {
    accountsDir: path.join(tempRoot, "accounts"),
    weixinBaseUrl: "http://127.0.0.1",
    weixinRouteTag: "default",
  };
}

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
