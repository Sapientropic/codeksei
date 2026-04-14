const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  buildSemanticReviewUnavailableReason,
  normalizeReviewSemanticHost,
  resolveActiveSemanticReviewHost,
} = require("../src/core/host-mode");

test("auto semantic review host follows the active host profile", () => {
  assert.equal(
    resolveActiveSemanticReviewHost({
      runtime: "codex",
      channelProvider: "codeksei",
      reviewSemanticHost: "auto",
    }),
    "codex",
  );
  assert.equal(
    resolveActiveSemanticReviewHost({
      runtime: "hermes",
      channelProvider: "hermes",
      reviewSemanticHost: "auto",
    }),
    "hermes",
  );
});

test("explicit semantic review host requests stay sticky across host profiles", () => {
  assert.equal(
    resolveActiveSemanticReviewHost({
      runtime: "hermes",
      channelProvider: "hermes",
      reviewSemanticHost: "deterministic",
    }),
    "deterministic",
  );
  assert.equal(
    resolveActiveSemanticReviewHost({
      runtime: "codex",
      channelProvider: "codeksei",
      reviewSemanticHost: "hermes",
    }),
    "hermes",
  );
});

test("semantic review host normalization and unavailable reasons stay user-readable", () => {
  assert.equal(normalizeReviewSemanticHost("  CoDeX "), "codex");
  assert.equal(normalizeReviewSemanticHost("unknown"), "auto");
  assert.equal(
    buildSemanticReviewUnavailableReason("auto", "codex", false),
    "当前 host profile 默认仍走 codex semantic host。",
  );
  assert.equal(
    buildSemanticReviewUnavailableReason("hermes", "hermes", false),
    "当前需要 Hermes semantic host，但找不到可执行的 Hermes 命令。",
  );
});
