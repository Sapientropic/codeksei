const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  collectHermesRepoLocalReport,
  resolveHermesRepoRoot,
} = require("../src/core/hermes-repo-local");

test("repo-local report recognizes a sibling hermes-agent checkout when present", () => {
  const siblingRepo = resolveHermesRepoRoot();
  if (!fs.existsSync(siblingRepo)) {
    return;
  }

  const report = collectHermesRepoLocalReport();
  assert.equal(path.resolve(report.repoRoot), path.resolve(siblingRepo));
  assert.equal(report.exists, true);
  assert.equal(report.weixinAdapterFound, true);
  assert.equal(report.deliveryFound, true);
  assert.equal(report.cronFound, true);
  assert.equal(report.sessionContextMode, "contextvars");
});
