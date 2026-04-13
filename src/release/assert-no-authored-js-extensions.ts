#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const rootDir = path.resolve(__dirname, "..", "..", "..");
const authoredRoots = [
  path.join(rootDir, "src"),
  path.join(rootDir, "scripts"),
];
const JS_SOURCE_PATTERN = /\.(?:js|jsx|mjs)$/u;

export function assertNoAuthoredJsExtensions(): void {
  const violations = authoredRoots.flatMap((directory) => collectViolations(directory));
  if (!violations.length) {
    return;
  }
  throw new Error([
    "repo authored-source JS extension guard failed",
    "",
    "Repo-tracked source files under src/ and scripts/ must be migrated to TypeScript or a non-JS asset type:",
    ...violations.map((relativePath) => `- ${relativePath}`),
  ].join("\n"));
}

function collectViolations(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const violations: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absoluteEntry = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      violations.push(...collectViolations(absoluteEntry));
      continue;
    }
    if (entry.isFile() && JS_SOURCE_PATTERN.test(entry.name)) {
      violations.push(toRelativePosix(rootDir, absoluteEntry));
    }
  }
  return violations.sort();
}

function toRelativePosix(cwd: string, absolutePath: string): string {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

export function main(): void {
  assertNoAuthoredJsExtensions();
  console.log("[codeksei] authored-source JS extension guard passed");
}

if (require.main === module) {
  main();
}
