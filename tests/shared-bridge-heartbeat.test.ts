const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { classifySharedBridgeHeartbeat } = require("../src/shared/shared-bridge-heartbeat");

test("shared bridge heartbeat does not report ok without a live managed pid", () => {
  const state = classifySharedBridgeHeartbeat({
    pid: 12345,
    status: "running",
    updatedAt: new Date().toISOString(),
  }, {
    expectedPid: 0,
    maxAgeMs: 120_000,
  });

  assert.equal(state.status, "missing_process");
  assert.equal(state.healthy, false);
});

test("shared bridge heartbeat stays healthy only when the managed pid matches", () => {
  const state = classifySharedBridgeHeartbeat({
    pid: 12345,
    status: "running",
    updatedAt: new Date().toISOString(),
  }, {
    expectedPid: 12345,
    maxAgeMs: 120_000,
  });

  assert.equal(state.status, "ok");
  assert.equal(state.healthy, true);
});

test("shared bridge heartbeat reports pid mismatch for a fresh heartbeat from another process", () => {
  const state = classifySharedBridgeHeartbeat({
    pid: 22222,
    status: "running",
    updatedAt: new Date().toISOString(),
  }, {
    expectedPid: 11111,
    maxAgeMs: 120_000,
  });

  assert.equal(state.status, "pid_mismatch");
  assert.equal(state.healthy, false);
});

test("shared bridge heartbeat keeps explicit stopped records non-healthy", () => {
  const state = classifySharedBridgeHeartbeat({
    pid: 12345,
    status: "stopped",
    updatedAt: new Date().toISOString(),
  }, {
    expectedPid: 0,
    maxAgeMs: 120_000,
  });

  assert.equal(state.status, "stopped");
  assert.equal(state.healthy, false);
});
