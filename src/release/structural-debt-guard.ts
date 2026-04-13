#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { resolvePackageRoot } from "../core/path-utils";

const rootDir = resolvePackageRoot(__dirname);
const sourceDirs = [
  path.join(rootDir, "src"),
  path.join(rootDir, "tests"),
];
const inventoryPath = path.join(rootDir, "src", "release", "structural-debt-inventory.json");

export interface StructuralDebtInventory {
  emptyCatchAllowlist?: unknown;
  duplicateNormalizeTextAllowlist?: unknown;
  redundantTypedAliasAllowlist?: unknown;
  definiteAssignmentAllowlist?: unknown;
  explicitAnyAllowlist?: unknown;
}

export function readStructuralDebtInventory(filePath: string = inventoryPath): StructuralDebtInventory {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as StructuralDebtInventory;
}

export function readAllowlistEntries(
  inventory: StructuralDebtInventory,
  key: keyof StructuralDebtInventory,
): Set<string> {
  const value = inventory[key];
  return new Set(
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
  );
}

export function walkRepoTsFiles(directories: string[] = sourceDirs): string[] {
  const files: string[] = [];
  for (const directory of directories) {
    if (!fs.existsSync(directory)) {
      continue;
    }
    files.push(...walkDirectory(directory));
  }
  return files.sort();
}

function walkDirectory(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absoluteEntry = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(absoluteEntry));
      continue;
    }
    if (entry.isFile() && (absoluteEntry.endsWith(".ts") || absoluteEntry.endsWith(".tsx"))) {
      files.push(absoluteEntry);
    }
  }
  return files;
}

export function parseTsFile(absolutePath: string): ts.SourceFile {
  return ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    absolutePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

export function toRelativePosix(absolutePath: string): string {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

export function formatLocation(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${toRelativePosix(sourceFile.fileName)}:${line + 1}`;
}

export function resolveGuardResult(actual: string[], allowlist: Set<string>) {
  const unexpected = actual.filter((entry) => !allowlist.has(entry));
  const staleAllowlist = [...allowlist].filter((entry) => !actual.includes(entry));
  return { unexpected, staleAllowlist };
}

export function buildGuardFailureMessage({
  title,
  unexpectedLabel,
  unexpected,
  staleAllowlist,
}: {
  title: string;
  unexpectedLabel: string;
  unexpected: string[];
  staleAllowlist: string[];
}): string {
  const lines = [title];
  if (unexpected.length) {
    lines.push("");
    lines.push(unexpectedLabel);
    for (const entry of unexpected) {
      lines.push(`- ${entry}`);
    }
  }
  if (staleAllowlist.length) {
    lines.push("");
    lines.push("Stale allowlist entries (remove them from structural-debt-inventory.json):");
    for (const entry of staleAllowlist) {
      lines.push(`- ${entry}`);
    }
  }
  return lines.join("\n");
}
