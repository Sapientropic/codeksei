const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  assertBridgeMode,
  formatBridgeOnlyCommandMessage,
  resolveHostMode,
} = require("../src/core/host-mode");

test("resolveHostMode defaults to codex-mode with the first-party weixin adapter when no host override is configured", () => {
  const resolved = resolveHostMode({});

  assert.deepEqual(resolved, {
    profile: "codex-mode",
    legacyProfileIds: ["bridge-codex-weixin"],
    runtime: "codex",
    runtimeProvider: "codex",
    runtimeOwner: "codeksei",
    channelProvider: "codeksei",
    channel: "weixin",
    channelKind: "weixin",
    deliveryRecipe: "codeksei-weixin-bridge",
    mode: "codex",
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

  assert.equal(resolved.profile, "hosted-mode");
  assert.equal(resolved.mode, "hosted");
  assert.equal(resolved.supported, true);
  assert.equal(resolved.capabilities.supportsHostedSkillInstall, true);
});

test("resolveHostMode recognizes Claude Code as a first-party bridge runtime", () => {
  const resolved = resolveHostMode({
    runtime: "claudecode",
    channelProvider: "codeksei",
  });

  assert.deepEqual(resolved, {
    profile: "claudecode-mode",
    legacyProfileIds: ["bridge-claudecode-weixin"],
    runtime: "claudecode",
    runtimeProvider: "claudecode",
    runtimeOwner: "codeksei",
    channelProvider: "codeksei",
    channel: "weixin",
    channelKind: "weixin",
    deliveryRecipe: "codeksei-weixin-bridge",
    mode: "claudecode",
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

test("resolveHostMode keeps codex-mode open to host-managed non-weixin channels", () => {
  const resolved = resolveHostMode({
    runtime: "codex",
    channelProvider: "host",
    channel: "telegram",
  });

  assert.equal(resolved.profile, "codex-mode");
  assert.equal(resolved.mode, "codex");
  assert.equal(resolved.supported, true);
  assert.equal(resolved.channelKind, "telegram");
  assert.equal(resolved.deliveryRecipe, "generic-shell");
  assert.deepEqual(resolved.legacyProfileIds, []);
});

test("resolveHostMode keeps hosted-mode open to host-managed non-weixin channels", () => {
  const resolved = resolveHostMode({
    runtime: "hermes",
    channelProvider: "host",
    channel: "discord",
  });

  assert.equal(resolved.profile, "hosted-mode");
  assert.equal(resolved.mode, "hosted");
  assert.equal(resolved.supported, true);
  assert.equal(resolved.channelKind, "discord");
  assert.equal(resolved.deliveryRecipe, "generic-shell");
  assert.deepEqual(resolved.legacyProfileIds, []);
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
    /Hosted Mode/u,
  );
  assert.match(formatBridgeOnlyCommandMessage(hosted, "codeksei start"), /Hosted Mode/u);
  assert.match(formatBridgeOnlyCommandMessage(hosted, "codeksei start"), /host\/operator\/skill/u);
});
