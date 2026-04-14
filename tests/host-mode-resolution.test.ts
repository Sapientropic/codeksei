const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  assertBridgeMode,
  formatBridgeOnlyCommandMessage,
  resolveHostMode,
} = require("../src/core/host-mode");

test("resolveHostMode defaults to bridge codex+weixin when no host override is configured", () => {
  const resolved = resolveHostMode({});

  assert.deepEqual(resolved, {
    profile: "bridge-codex-weixin",
    runtime: "codex",
    channelProvider: "codeksei",
    channel: "weixin",
    mode: "bridge",
    supported: true,
    reason: "",
    capabilities: {
      ownsBridgeLifecycle: true,
      ownsSharedThreadControl: true,
      ownsWeixinLogin: true,
      supportsHostedSkillInstall: false,
      supportsLiveHostedSmoke: false,
      supportsSemanticReviewHybrid: true,
    },
  });
});

test("resolveHostMode recognizes Hermes hosted mode as a first-class supported profile", () => {
  const resolved = resolveHostMode({
    runtime: "hermes",
    channelProvider: "hermes",
  });

  assert.equal(resolved.profile, "hosted-hermes-weixin");
  assert.equal(resolved.mode, "hosted");
  assert.equal(resolved.supported, true);
  assert.equal(resolved.capabilities.supportsHostedSkillInstall, true);
});

test("resolveHostMode keeps mixed host combinations explicit instead of silently coercing them", () => {
  const resolved = resolveHostMode({
    runtime: "hermes",
    channelProvider: "codeksei",
  });

  assert.equal(resolved.profile, "unsupported");
  assert.equal(resolved.mode, "unsupported");
  assert.equal(resolved.supported, false);
  assert.match(resolved.reason, /runtime=hermes \+ channelProvider=codeksei/u);
});

test("assertBridgeMode preserves the hosted guidance message for bridge-only commands", () => {
  const hosted = resolveHostMode({
    runtime: "hermes",
    channelProvider: "hermes",
  });

  assert.throws(
    () => assertBridgeMode({ runtime: "hermes", channelProvider: "hermes" }, "codeksei start"),
    /Hermes Hosted Mode/u,
  );
  assert.match(formatBridgeOnlyCommandMessage(hosted, "codeksei start"), /Hermes Hosted Mode/u);
  assert.match(formatBridgeOnlyCommandMessage(hosted, "codeksei start"), /operator \/ skill 入口/u);
});
