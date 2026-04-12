#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const rootDir = path.resolve(__dirname, "..", "..", "..");
const LEGACY_NAME = ["cyber", "boss"].join("");
const TARGETS = [
  "src",
  "scripts",
  "tests",
  "docs",
  "package.json",
  "README.md",
  "README.en.md",
  "AGENTS.md",
];
const LOCAL_ONLY_SUFFIXES = [".local.md", ".private.md", ".maintainer.md"];
const LEGACY_PATTERN = new RegExp(
  `\\b(?:${LEGACY_NAME}|${capitalize(LEGACY_NAME)}|${LEGACY_NAME.toUpperCase()}(?:_[A-Z0-9_]+)?)\\b`,
  "u"
);
const README_ACKNOWLEDGEMENT_SNIPPETS = [
  `WenXiaoWendy/${LEGACY_NAME}`,
];

function collectFiles(entries: string[], cwd: string = rootDir): string[] {
  const discovered: string[] = [];
  for (const entry of entries) {
    const absoluteEntry = path.resolve(cwd, entry);
    if (!fs.existsSync(absoluteEntry)) {
      continue;
    }
    const stats = fs.statSync(absoluteEntry);
    if (stats.isDirectory()) {
      walkFiles(absoluteEntry, discovered);
      continue;
    }
    if (stats.isFile()) {
      discovered.push(absoluteEntry);
    }
  }
  return discovered.sort();
}

function walkFiles(directory: string, discovered: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absoluteEntry = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absoluteEntry, discovered);
      continue;
    }
    if (entry.isFile() && !isLocalOnlyFile(entry.name)) {
      discovered.push(absoluteEntry);
    }
  }
}

function isAllowedReadmeAcknowledgement(filePath: string, line: string): boolean {
  const relativePath = toRelativePosix(filePath);
  if (relativePath !== "README.md" && relativePath !== "README.en.md") {
    return false;
  }
  return README_ACKNOWLEDGEMENT_SNIPPETS.some((snippet: any) => line.includes(snippet));
}

function assertNoLegacyBranding({ files = collectFiles(TARGETS) }: { files?: string[] } = {}): void {
  const violations: string[] = [];
  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    const lines = source.split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (!LEGACY_PATTERN.test(line)) {
        return;
      }
      if (isAllowedReadmeAcknowledgement(filePath, line)) {
        return;
      }
      violations.push(`${toRelativePosix(filePath)}:${index + 1}: ${line.trim()}`);
    });
  }

  if (violations.length) {
    throw new Error(`legacy branding is not allowed outside README acknowledgement:\n${violations.join("\n")}`);
  }
}

function toRelativePosix(filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function isLocalOnlyFile(fileName: string): boolean {
  const normalized = String(fileName || "").toLowerCase();
  return LOCAL_ONLY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function main(): void {
  assertNoLegacyBranding();
  console.log("[codeksei] legacy branding guard passed");
}

function capitalize(value: unknown): string {
  const text = String(value || "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

export {
  assertNoLegacyBranding,
  collectFiles,
  main,
};

if (require.main === module) {
  main();
}
