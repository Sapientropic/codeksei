#!/usr/bin/env node

import {
  collectSourceFiles,
  resolveStaticImportViolations,
} from "./import-boundary-guard";

const rules = [
  {
    sourcePrefix: "src/core/",
    disallowedPattern: /\.\.\/(?:adapters|runtime)\//u,
    excludeFiles: ["src/core/app-runtime-factory.ts"],
    reason: "core should only reach adapters/runtime through app-runtime-factory.ts",
  },
  {
    sourcePrefix: "src/shared/shared-managed-runtime.ts",
    disallowedPattern: /\.\.\/adapters\//u,
    reason: "shared-managed-runtime should not depend on adapter implementations directly",
  },
  {
    sourcePrefix: "src/runtime/",
    disallowedPattern: /\.\.\/adapters\/channel\//u,
    reason: "runtime should consume channel attachment contracts instead of adapter internals",
  },
];

export function assertNoCoreImportsAdapters(): void {
  const files = collectSourceFiles();
  const violations = resolveStaticImportViolations({ files, rules });
  if (violations.length) {
    throw new Error([
      "repo core/shared/runtime boundary guard failed",
      "",
      "Unexpected direct imports across guarded layers:",
      ...violations.map((entry) => `- ${entry}`),
    ].join("\n"));
  }
}

export function main(): void {
  assertNoCoreImportsAdapters();
  console.log("[codeksei] core/shared/runtime boundary guard passed");
}

if (require.main === module) {
  main();
}
