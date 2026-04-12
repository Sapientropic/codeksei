const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSpawnInvocation } = require("../src/core/codex-spawn");

test("buildSpawnInvocation keeps exe paths direct on Windows", () => {
  const spec = buildSpawnInvocation("C:\\Program Files\\OpenAI\\codex.exe", ["app-server"], {
    platform: "win32",
    existsSyncImpl: (candidate) => candidate === "C:\\Program Files\\OpenAI\\codex.exe",
  });

  assert.equal(spec.command, "C:\\Program Files\\OpenAI\\codex.exe");
  assert.deepEqual(spec.args, ["app-server"]);
});

test("buildSpawnInvocation wraps spaced cmd paths safely on Windows", () => {
  const spec = buildSpawnInvocation("C:\\Program Files\\OpenAI\\codex.cmd", ["app-server"], {
    platform: "win32",
    existsSyncImpl: (candidate) => candidate === "C:\\Program Files\\OpenAI\\codex.cmd",
  });

  assert.equal(spec.command, "cmd.exe");
  assert.deepEqual(spec.args, [
    "/d",
    "/s",
    "/c",
    "\"C:\\Program Files\\OpenAI\\codex.cmd\" app-server",
  ]);
});
