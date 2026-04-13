#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const rootDir = path.resolve(__dirname, "..", "..", "..");
const sourceRoot = path.join(rootDir, "src");
const TYPED_MODULE_DESTRUCTURE_PATTERN = /const\s*\{[\s\S]*?\}\s*=\s*\w+Module\s+as\s+\{/u;

export function assertNoTypedModuleDestructure(root: string = sourceRoot): void {
  const violations: string[] = [];
  for (const absolutePath of walkTsFiles(root)) {
    if (path.basename(absolutePath) === "assert-no-typed-module-destructure.ts") {
      continue;
    }
    const source = fs.readFileSync(absolutePath, "utf8");
    if (!TYPED_MODULE_DESTRUCTURE_PATTERN.test(source)) {
      continue;
    }
    violations.push(toRelativePosix(rootDir, absolutePath));
  }
  if (violations.length) {
    throw new Error([
      "repo typed module-destructure guard failed",
      "",
      "Replace typed namespace-destructure bridges with direct imports or explicit local wrappers:",
      ...violations.map((relativePath) => `- ${relativePath}`),
    ].join("\n"));
  }
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

function toRelativePosix(cwd: string, absolutePath: string): string {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

export function main(): void {
  assertNoTypedModuleDestructure();
  console.log("[codeksei] typed module-destructure guard passed");
}

if (require.main === module) {
  main();
}
