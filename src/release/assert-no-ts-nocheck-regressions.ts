#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const rootDir = path.resolve(__dirname, "..", "..", "..");
const testsRoot = path.join(rootDir, "tests");
const inventoryPath = path.join(rootDir, "src", "release", "style-type-exception-inventory.json");
const TS_NOCHECK_PATTERN = /^\s*\/\/\s*@ts-nocheck\b/mu;

interface StyleTypeExceptionInventory {
  commonJsSourceAllowlist?: unknown;
  tsNoCheckAllowlist?: unknown;
}

interface AssertNoTsNoCheckRegressionsArgs {
  cwd?: string;
  inventoryFilePath?: string;
}

export function assertNoTsNoCheckRegressions({
  cwd = rootDir,
  inventoryFilePath = inventoryPath,
}: AssertNoTsNoCheckRegressionsArgs = {}): void {
  const inventory = readStyleTypeExceptionInventory(inventoryFilePath);
  const allowlist = new Set(readStringList(inventory.tsNoCheckAllowlist));
  const violations = collectTsNoCheckFiles(path.join(cwd, "tests"), cwd);
  const unexpected = violations.filter((relativePath) => !allowlist.has(relativePath));
  const staleAllowlist = [...allowlist].filter((relativePath) => !violations.includes(relativePath));

  if (unexpected.length || staleAllowlist.length) {
    const lines = ["repo TypeScript test guard failed"];
    if (unexpected.length) {
      lines.push("");
      lines.push("Unexpected @ts-nocheck files:");
      for (const relativePath of unexpected) {
        lines.push(`- ${relativePath}`);
      }
    }
    if (staleAllowlist.length) {
      lines.push("");
      lines.push("Stale @ts-nocheck allowlist entries (remove them from the inventory):");
      for (const relativePath of staleAllowlist) {
        lines.push(`- ${relativePath}`);
      }
    }
    throw new Error(lines.join("\n"));
  }
}

function collectTsNoCheckFiles(directory: string, cwd: string): string[] {
  const violations: string[] = [];
  for (const absolutePath of walkTsFiles(directory)) {
    const source = fs.readFileSync(absolutePath, "utf8");
    if (!TS_NOCHECK_PATTERN.test(source)) {
      continue;
    }
    violations.push(toRelativePosix(cwd, absolutePath));
  }
  return violations.sort();
}

function walkTsFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absoluteEntry = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(absoluteEntry));
      continue;
    }
    if (entry.isFile() && absoluteEntry.endsWith(".ts")) {
      files.push(absoluteEntry);
    }
  }
  return files;
}

function readStyleTypeExceptionInventory(filePath: string): StyleTypeExceptionInventory {
  if (!fs.existsSync(filePath)) {
    throw new Error(`style/type exception inventory missing: ${toRelativePosix(rootDir, filePath)}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as StyleTypeExceptionInventory;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function toRelativePosix(cwd: string, absolutePath: string): string {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

export function main(): void {
  assertNoTsNoCheckRegressions();
  const inventory = readStyleTypeExceptionInventory(inventoryPath);
  const allowCount = readStringList(inventory.tsNoCheckAllowlist).length;
  console.log(`[codeksei] repo @ts-nocheck guard passed (allowlisted tests: ${allowCount})`);
}

if (require.main === module) {
  main();
}
