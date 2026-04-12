const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const { EventEmitter }: typeof import("node:events") = require("node:events");
const test: typeof import("node:test") = require("node:test");
const { CodexRpcClient }: typeof import("../src/adapters/runtime/codex/rpc-client") = require("../src/adapters/runtime/codex/rpc-client");

type NodeEventEmitter = import("node:events").EventEmitter;

interface FakeWritable extends NodeEventEmitter {
  writable: boolean;
  writes: string[];
  write(chunk: unknown): boolean;
}

interface FakeChild extends NodeEventEmitter {
  stdout: NodeEventEmitter;
  stderr: NodeEventEmitter;
  stdin: FakeWritable;
  kill(): void;
  emitSpawn(): void;
}

function createFakeWritable(): FakeWritable {
  const writable = new EventEmitter() as unknown as FakeWritable;
  writable.writable = true;
  writable.writes = [];
  writable.write = (chunk: unknown) => {
    writable.writes.push(String(chunk));
    return true;
  };
  return writable;
}

function createFakeChild({ autoSpawn = true }: { autoSpawn?: boolean } = {}): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild;
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

function readWrittenRequestId(child: FakeChild, index = 0): string {
  const payload = JSON.parse(String(child.stdin.writes[index] || "").trim()) as { id: string };
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
