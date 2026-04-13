#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePackageRoot } from "../core/path-utils";

const rootDir = resolvePackageRoot(__dirname);
const sourceRoot = path.join(rootDir, "src");
const inventoryPath = path.join(rootDir, "src", "release", "style-type-exception-inventory.json");
const COMMONJS_PATTERN = /\brequire\s*\(|\bmodule\.exports\b|\bexports\./u;

interface StyleTypeExceptionInventory {
  commonJsSourceAllowlist?: unknown;
  tsNoCheckAllowlist?: unknown;
}

interface AssertNoKeyTsCommonJsArgs {
  cwd?: string;
  inventoryFilePath?: string;
}

export function assertNoKeyTsCommonJs({
  cwd = rootDir,
  inventoryFilePath = inventoryPath,
}: AssertNoKeyTsCommonJsArgs = {}): void {
  const inventory = readStyleTypeExceptionInventory(inventoryFilePath);
  const allowlist = new Set(readStringList(inventory.commonJsSourceAllowlist));
  const violations = collectTsFilesWithCommonJs(path.join(cwd, "src"), cwd);
  const unexpected = violations.filter((relativePath) => !allowlist.has(relativePath));
  const staleAllowlist = [...allowlist].filter((relativePath) => !violations.includes(relativePath));

  if (unexpected.length || staleAllowlist.length) {
    const lines = ["repo TypeScript import/export guard failed"];
    if (unexpected.length) {
      lines.push("");
      lines.push("Unexpected CommonJS-style source files:");
      for (const relativePath of unexpected) {
        lines.push(`- ${relativePath}`);
      }
    }
    if (staleAllowlist.length) {
      lines.push("");
      lines.push("Stale allowlist entries (remove them from the inventory):");
      for (const relativePath of staleAllowlist) {
        lines.push(`- ${relativePath}`);
      }
    }
    throw new Error(lines.join("\n"));
  }
}

function collectTsFilesWithCommonJs(directory: string, cwd: string): string[] {
  const violations: string[] = [];
  for (const absolutePath of walkTsFiles(directory)) {
    const source = fs.readFileSync(absolutePath, "utf8");
    if (!COMMONJS_PATTERN.test(source)) {
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
  assertNoKeyTsCommonJs();
  const inventory = readStyleTypeExceptionInventory(inventoryPath);
  const allowCount = readStringList(inventory.commonJsSourceAllowlist).length;
  console.log(`[codeksei] repo TS import/export guard passed (allowlisted CommonJS files: ${allowCount})`);
}

if (require.main === module) {
  main();
}
