const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repoRoot = path.join(__dirname, "..");

const builtRuntimeOnlyTests = [
  "cli-agent-native-contract",
  "dependency-contract",
  "published-runtime-artifacts",
  "root-helper-smoke",
  "shared-mode-long-chain",
  "timeline-first-party-runtime",
];

test("package scripts expose source-only and built-runtime test gates", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

  assert.equal(pkg.scripts["test:source-runtime"], "tsx ./src/release/run-source-runtime-tests.ts");
  assert.equal(pkg.scripts["test:built-runtime"], "tsx ./src/release/run-built-runtime-tests.ts");
  assert.match(pkg.scripts.check, /npm run test:source-runtime/u);
  assert.match(pkg.scripts.verify, /npm run build && npm run test:built-runtime/u);
});

test("source-only runtime runner keeps built-dist contract tests out of the source pass", () => {
  const runnerPath = path.join(repoRoot, "src", "release", "run-source-runtime-tests.ts");
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(source, /CODEKSEI_TEST_RUNTIME_MODE:\s*"source"/u);
  for (const testName of builtRuntimeOnlyTests) {
    assert.match(source, new RegExp(`"${testName}\\.test\\.ts"`, "u"));
  }
});
