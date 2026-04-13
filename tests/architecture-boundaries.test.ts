const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectSourceFiles,
  resolveImportBoundaryViolations,
} = require("../src/release/import-boundary-guard");
const allowlist: Array<{ from: string; to: string }> = [
  {
    from: "src/workspace/default-targets.ts",
    to: "src/adapters/channel/weixin/context-token-store.ts",
  },
];
const rules: Array<{
  sourcePrefix: string;
  forbiddenPrefixes: string[];
  reason: string;
}> = [
  {
    sourcePrefix: "src/review/",
    forbiddenPrefixes: ["src/app/"],
    reason: "review should not depend on app CLI wiring",
  },
  {
    sourcePrefix: "src/notes/",
    forbiddenPrefixes: ["src/adapters/"],
    reason: "notes should stay above adapter details",
  },
  {
    sourcePrefix: "src/state/",
    forbiddenPrefixes: ["src/app/"],
    reason: "state stores should not depend on app CLI layer",
  },
  {
    sourcePrefix: "src/core/",
    forbiddenPrefixes: ["src/review/", "src/notes/"],
    reason: "core should remain orchestration shell, not absorb review/notes logic",
  },
  {
    sourcePrefix: "src/runtime/",
    forbiddenPrefixes: ["src/review/", "src/notes/", "src/app/", "src/adapters/channel/"],
    reason: "runtime should stay below domain logic and above app CLI wiring/adapters",
  },
  {
    sourcePrefix: "src/shared/",
    forbiddenPrefixes: ["src/app/", "src/review/", "src/notes/"],
    reason: "shared helpers should not absorb app or domain workflow logic",
  },
  {
    sourcePrefix: "src/shared/shared-managed-runtime.ts",
    forbiddenPrefixes: ["src/adapters/"],
    reason: "shared-managed-runtime should not depend on adapter implementation logic",
  },
  {
    sourcePrefix: "src/workspace/",
    forbiddenPrefixes: ["src/runtime/", "src/adapters/", "src/app/", "src/review/", "src/notes/"],
    reason: "workspace continuity should stay below runtime/app wiring and outside domain logic",
  },
  {
    sourcePrefix: "src/adapters/",
    forbiddenPrefixes: ["src/app/", "src/review/", "src/notes/"],
    reason: "adapters should not depend on app CLI or domain workflow implementations",
  },
];

test("architecture boundaries keep review notes state and core decoupled", () => {
  const files = collectSourceFiles();
  const violations = resolveImportBoundaryViolations({ files, rules, allowlist });
  assert.deepEqual(violations, []);
});
