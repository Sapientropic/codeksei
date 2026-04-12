#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const rootDir = path.resolve(__dirname, "..", "..", "..");
const testsRoot = path.join(rootDir, "tests");

interface AssertNoJsTestsArgs {
  cwd?: string;
}

export function collectLegacyJsTests(cwd: string = rootDir): string[] {
  const directory = path.join(cwd, "tests");
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
    .map((entry) => toRelativePosix(cwd, path.join(directory, entry.name)))
    .sort();
}

export function assertNoLegacyJsTests({ cwd = rootDir }: AssertNoJsTestsArgs = {}): void {
  const legacyTests = collectLegacyJsTests(cwd);
  if (!legacyTests.length) {
    return;
  }
  throw new Error([
    "repo JS test guard failed",
    "",
    "Legacy JS tests must be migrated to .test.ts before check/verify can pass:",
    ...legacyTests.map((relativePath) => `- ${relativePath}`),
  ].join("\n"));
}

function toRelativePosix(cwd: string, absolutePath: string): string {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

export function main(): void {
  assertNoLegacyJsTests();
  console.log("[codeksei] JS test guard passed");
}

if (require.main === module) {
  main();
}
