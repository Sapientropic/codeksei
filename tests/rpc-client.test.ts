// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { CodexRpcClient } = require("../src/adapters/runtime/codex/rpc-client");

function createFakeWritable() {
  const writable = new EventEmitter();
  writable.writable = true;
  writable.writes = [];
  writable.write = (chunk) => {
    writable.writes.push(chunk);
    return true;
  };
  return writable;
}

function createFakeChild({ autoSpawn = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = createFakeWritable();
  child.kill = () => {
    child.stdin.writable = false;
  };
  child.emitSpawn = () => queueMicrotask(() => child.emit("spawn"));
  if (autoSpawn) {
    child.emitSpawn();
  }
  return child;
}

function readWrittenRequestId(child, index = 0) {
  const payload = JSON.parse(String(child.stdin.writes[index] || "").trim());
  return payload.id;
}

test("rpc client rejects pending requests when spawn child closes", async () => {
  const child = createFakeChild();
  const client = new CodexRpcClient({ spawnImpl: () => child });

  await client.connect();
  const pending = client.sendRequest("thread/list", {});

  child.stderr.emit("data", Buffer.from("fatal transport shutdown\n"));
  child.emit("close", 1, null);

  await assert.rejects(pending, /Codex process closed \(code=1\); stderr tail: fatal transport shutdown/);
});

test("rpc client rejects pending requests when spawn child errors", async () => {
  const child = createFakeChild();
  const client = new CodexRpcClient({ spawnImpl: () => child });

  await client.connect();
  const pending = client.sendRequest("thread/list", {});

  child.stderr.emit("data", Buffer.from("broken pipe\n"));
  child.emit("error", new Error("spawn EPIPE"));

  await assert.rejects(pending, /Codex process transport errored: spawn EPIPE; stderr tail: broken pipe/);
});

test("rpc client can reconnect and initialize after a transport close", async () => {
  const firstChild = createFakeChild();
  const secondChild = createFakeChild({ autoSpawn: false });
  let spawnCount = 0;
  const client = new CodexRpcClient({
    spawnImpl: () => {
      if (spawnCount++ === 0) {
        return firstChild;
      }
      secondChild.emitSpawn();
      return secondChild;
    },
  });

  await client.connect();
  const pending = client.sendRequest("thread/list", {});
  firstChild.emit("close", 1, null);
  await assert.rejects(pending, /Codex process closed/);

  await client.connect();
  const initializePromise = client.initialize();
  const requestId = readWrittenRequestId(secondChild);
  secondChild.stdout.emit("data", Buffer.from(`${JSON.stringify({ id: requestId, result: {} })}\n`));
  await initializePromise;

  assert.equal(client.isReady, true);
  assert.equal(JSON.parse(String(secondChild.stdin.writes[1]).trim()).method, "initialized");
});

test("rpc client surfaces spawn startup failures before initialization", async () => {
  const child = createFakeChild({ autoSpawn: false });
  const client = new CodexRpcClient({ spawnImpl: () => child });

  queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")));

  await assert.rejects(client.connect(), /Unable to spawn Codex app-server via .*spawn ENOENT/);
});
