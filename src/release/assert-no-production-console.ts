#!/usr/bin/env node

import * as fs from "node:fs";

import {
  collectSourceFiles,
  toRepoRelative,
} from "./import-boundary-guard";

const ALLOWLIST_PREFIXES = [
  "src/maintainer/",
  "src/release/",
];

const ALLOWLIST_FILES = new Set([
  "src/core/logging.ts",
]);

const DIRECT_CONSOLE_PATTERN = /\bconsole\.(?:log|warn|error)\s*\(/u;

export function assertNoProductionConsole(): void {
  const violations = collectSourceFiles()
    .map((filePath) => ({
      filePath,
      relativeFile: toRepoRelative(filePath),
    }))
    .filter(({ relativeFile }) => (
      !ALLOWLIST_FILES.has(relativeFile)
      && !ALLOWLIST_PREFIXES.some((prefix) => relativeFile.startsWith(prefix))
    ))
    .filter(({ filePath }) => DIRECT_CONSOLE_PATTERN.test(fs.readFileSync(filePath, "utf8")))
    .map(({ relativeFile }) => relativeFile);

  if (violations.length) {
    throw new Error([
      "repo production console guard failed",
      "",
      "Use core/logging.ts for logs and core/terminal-output.ts for CLI output instead of direct console.*:",
      ...violations.map((relativeFile) => `- ${relativeFile}`),
    ].join("\n"));
  }
}

export function main(): void {
  assertNoProductionConsole();
  console.log("[codeksei] production console guard passed");
}

if (require.main === module) {
  main();
}
