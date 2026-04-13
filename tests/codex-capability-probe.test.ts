const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  diagnoseCodexCapabilityIssue,
  probeCodexAppServerCapabilities,
}: typeof import("../src/adapters/runtime/codex/capability-probe") = require("../src/adapters/runtime/codex/capability-probe");

test("diagnoseCodexCapabilityIssue classifies approvalPolicy compatibility errors", () => {
  const diagnosis = diagnoseCodexCapabilityIssue("turn/start rejected unknown field approvalPolicy");

  assert.equal(diagnosis.code, "request_policy_unsupported");
  assert.match(diagnosis.hint, /approvalPolicy/i);
});

test("probeCodexAppServerCapabilities flags missing --listen support from app-server help", () => {
  const probe = probeCodexAppServerCapabilities("codex", {
    spawnSyncImpl: (() => ({
      stdout: "Usage: codex app-server [OPTIONS]\n  --port <PORT>",
      stderr: "",
      status: 0,
      signal: null,
      output: [],
      pid: 123,
    })) as unknown as typeof import("node:child_process").spawnSync,
  });

  assert.equal(probe.canInvokeAppServer, true);
  assert.equal(probe.supportsListen, false);
  assert.equal(probe.diagnosis.code, "app_server_listen_unsupported");
});

test("probeCodexAppServerCapabilities reports spawn-not-found failures with a hint", () => {
  const probe = probeCodexAppServerCapabilities("codex", {
    spawnSyncImpl: (() => ({
      stdout: "",
      stderr: "",
      status: null,
      signal: null,
      output: [],
      pid: 0,
      error: new Error("spawn ENOENT"),
    })) as unknown as typeof import("node:child_process").spawnSync,
  });

  assert.equal(probe.canInvokeAppServer, false);
  assert.equal(probe.diagnosis.code, "spawn_not_found");
  assert.match(probe.diagnosis.hint, /CODEX_COMMAND|安装/u);
});
