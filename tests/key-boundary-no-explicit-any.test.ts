const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const repoRoot = path.join(__dirname, "..");

const GUARDED_FILES = [
  "src/contracts/session-state.ts",
  "src/core/system-message-dispatcher.ts",
  "src/core/approval-command-policy.ts",
  "src/integrations/timeline/state-sync.ts",
];

test("key boundary files stay free of explicit any", () => {
  for (const relativePath of GUARDED_FILES) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.equal(
      /\bany\b/u.test(source),
      false,
      `${relativePath} should not reintroduce explicit any`,
    );
  }
});
