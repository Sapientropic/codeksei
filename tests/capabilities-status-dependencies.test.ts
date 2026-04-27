const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildCapabilityStatusReport,
}: typeof import("../src/capabilities/status") = require("../src/capabilities/status");

function createCapabilityFixture(prefix: string) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix)).replace(/\\/g, "/");
  const stateDir = path.join(workspaceRoot, ".codeksei-state");
  fs.mkdirSync(stateDir, { recursive: true });
  return {
    config: {
      allowedUserIds: ["wx-user"],
      channel: "weixin",
      channelProvider: "hermes",
      runtime: "hermes",
      sessionsFile: path.join(stateDir, "sessions.json"),
      stateDir,
      workspaceRoot,
    },
    target: {
      senderId: "wx-user",
      workspaceRoot,
    },
  };
}

function findCapability(report: ReturnType<typeof buildCapabilityStatusReport>, id: string) {
  const capability = report.capabilities.find((entry) => entry.id === id);
  assert.ok(capability, `expected capability ${id} to exist`);
  return capability;
}

test("host execution readiness dependencies are degraded until doctor or provider readiness confirms them", () => {
  const fixture = createCapabilityFixture("codeksei-capability-deps-");
  const report = buildCapabilityStatusReport(fixture.config, {
    provider: "hermes",
    user: fixture.target.senderId,
    workspace: fixture.target.workspaceRoot,
  });

  const doctor = findCapability(report, "host.doctor");
  assert.equal(doctor.availableNow, true);
  assert.equal(doctor.status, "available");

  const seedProactive = findCapability(report, "host.seed_proactive");
  assert.equal(seedProactive.availableNow, false);
  assert.equal(seedProactive.status, "degraded");
  assert.match(seedProactive.reasons.join("\n"), /hosted_repo_local_cron/u);
  assert.match(seedProactive.reasons.join("\n"), /host doctor\/smoke|provider readiness/u);
});

test("read-only capabilities without host dependencies remain available", () => {
  const report = buildCapabilityStatusReport({
    channel: "weixin",
    channelProvider: "hermes",
    runtime: "hermes",
  }, { provider: "hermes" });

  const doctor = findCapability(report, "app.doctor");
  assert.equal(doctor.hostDependencies.length, 0);
  assert.equal(doctor.availableNow, true);
  assert.equal(doctor.status, "available");

  const capabilitiesStatus = findCapability(report, "capabilities.status");
  assert.equal(capabilitiesStatus.hostDependencies.length, 0);
  assert.equal(capabilitiesStatus.availableNow, true);
  assert.equal(capabilitiesStatus.status, "available");
});

test("target-dependent capabilities remain blocked when user or workspace cannot be resolved", () => {
  const report = buildCapabilityStatusReport({
    channel: "weixin",
    channelProvider: "hermes",
    runtime: "hermes",
  }, { provider: "hermes" });

  const sendFile = findCapability(report, "channel.send_file");
  assert.equal(sendFile.availableNow, false);
  assert.equal(sendFile.status, "blocked");
  assert.match(sendFile.reasons.join("\n"), /target resolution is required/u);
  assert.equal(sendFile.sideEffect, true);
});
