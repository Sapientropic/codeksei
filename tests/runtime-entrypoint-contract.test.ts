const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRuntimeEntrypointArg,
  listRuntimeEntrypoints,
  resolveRuntimeEntrypoint,
} = require("../src/contracts/runtime-entrypoints");

const repoRoot = path.join(__dirname, "..");
const allowedFiles = new Set([
  "package.json",
  "scripts/lib/runtime-entrypoints.ps1",
  "scripts/lib/runtime-entrypoints.sh",
  "src/contracts/runtime-entrypoints.ts",
  "tests/runtime-entrypoint-contract.test.ts",
]);

test("repo keeps concrete built-runtime paths behind approved edge contracts only", () => {
  const violations = [];
  for (const relativePath of listScannedFiles()) {
    if (allowedFiles.has(relativePath)) {
      continue;
    }
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    for (const entrypoint of listRuntimeEntrypoints()) {
      const concretePaths = [
        resolveRuntimeEntrypoint(entrypoint.id),
        buildRuntimeEntrypointArg(entrypoint.id),
      ];
      for (const concretePath of concretePaths) {
        if (source.includes(concretePath)) {
          violations.push(`${relativePath} -> ${concretePath}`);
        }
      }
    }
    const sourceJsMatches = source.match(/\bsrc\/[A-Za-z0-9_./-]+\.js\b/gu) || [];
    for (const match of sourceJsMatches) {
      violations.push(`${relativePath} -> ${match}`);
    }
  }

  assert.deepEqual(violations, []);
});

function listScannedFiles() {
  return [
    ...walkDirectory("src"),
    ...walkDirectory("tests"),
    ...walkDirectory("scripts"),
    ...walkDirectory("docs"),
    "README.md",
    "README.en.md",
    "package.json",
  ].filter((relativePath) => (
    !relativePath.startsWith("docs/tasks/archive/")
    && !relativePath.endsWith(".local.md")
  ));
}

function walkDirectory(relativeDir: string): string[] {
  const absoluteDir = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }
  const discovered = [];
  const stack = [absoluteDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absoluteEntry = path.join(current, entry.name);
      const relativeEntry = path.relative(repoRoot, absoluteEntry).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        stack.push(absoluteEntry);
        continue;
      }
      discovered.push(relativeEntry);
    }
  }
  return discovered;
}
