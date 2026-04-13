const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const repoRoot = path.join(__dirname, "..");

const GUARDED_FILES = [
  "src/contracts/runtime-events.ts",
  "src/contracts/config-files.ts",
  "src/app/reminder-write-cli.ts",
  "src/adapters/runtime/codex/model-catalog.ts",
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
