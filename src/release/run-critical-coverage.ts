#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface CoverageRow {
  branchPercent: number;
  filePath: string;
  functionPercent: number;
  linePercent: number;
}

export interface CoverageThresholds {
  branchPercent: number;
  functionPercent: number;
  linePercent: number;
}

const DEFAULT_THRESHOLDS: CoverageThresholds = {
  branchPercent: 75,
  functionPercent: 85,
  linePercent: 88,
};

const EXPLICIT_CRITICAL_COVERAGE_FILES = [
  "src/core/config.ts",
  "src/adapters/channel/weixin/delivery-text.ts",
  "src/runtime/runtime-turn-actions.ts",
  "src/runtime/runtime-turn-preparation.ts",
  "src/runtime/runtime-turn-send.ts",
  "src/runtime/runtime-turn-lifecycle.ts",
  "src/runtime/stream-delivery.ts",
];

const CRITICAL_COVERAGE_ARGS = [
  "--experimental-test-coverage",
  ...EXPLICIT_CRITICAL_COVERAGE_FILES.map((filePath) => `--test-coverage-include=${filePath}`),
  "--test-coverage-include=src/runtime/stream-delivery/*.ts",
  "--experimental-strip-types",
  "--require",
  "./tests/helpers/build-path-resolver.ts",
  "--test",
  "tests/runtime-turn-lifecycle.test.ts",
  "tests/app-command-wiring.test.ts",
  "tests/app-typing.test.ts",
  "tests/weixin-delivery-text.test.ts",
  "tests/stream-delivery.test.ts",
  "tests/stream-delivery-flush-scheduler.test.ts",
  "tests/stream-delivery-transport.test.ts",
  "tests/stream-delivery-run-state.test.ts",
  "tests/stream-delivery-delta-merge.test.ts",
  "tests/stream-delivery-visible-text.test.ts",
  "tests/stream-delivery-trace-abandonment.test.ts",
  "tests/stream-delivery-reply-target-registry.test.ts",
  "tests/branding-config.test.ts",
  "tests/config-slices.test.ts",
];

export function parseNodeCoverageReport(output: string): CoverageRow[] {
  const rows: CoverageRow[] = [];
  const stack: Array<{ indent: number; name: string }> = [];

  for (const rawLine of output.split(/\r?\n/u)) {
    const line = stripInfoPrefix(rawLine).trimEnd();
    if (!line.includes("|")) {
      continue;
    }
    const columns = line.split("|");
    if (columns.length < 4) {
      continue;
    }
    const rawName = columns[0] || "";
    const name = rawName.trim();
    if (!name || name === "file" || name === "all files" || /^-+$/u.test(name)) {
      continue;
    }
    const indent = rawName.match(/^\s*/u)?.[0].length || 0;
    const linePercent = parsePercent(columns[1]);
    const branchPercent = parsePercent(columns[2]);
    const functionPercent = parsePercent(columns[3]);

    stack.splice(findFirstChildIndex(stack, indent));
    if (!Number.isFinite(linePercent) || !Number.isFinite(branchPercent) || !Number.isFinite(functionPercent)) {
      stack.push({ indent, name });
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/u.test(name)) {
      continue;
    }
    rows.push({
      branchPercent,
      filePath: [...stack.map((entry) => entry.name), name].join("/"),
      functionPercent,
      linePercent,
    });
  }

  return rows;
}

export function resolveCriticalCoverageViolations(
  rows: CoverageRow[],
  thresholds: CoverageThresholds = DEFAULT_THRESHOLDS,
  expectedFiles: readonly string[] = [],
): string[] {
  const violations: string[] = [];
  const rowByFile = new Map(rows.map((row) => [normalizeReportPath(row.filePath), row]));
  for (const expectedFile of expectedFiles.map((filePath) => normalizeReportPath(filePath)).sort()) {
    if (!rowByFile.has(expectedFile)) {
      violations.push(`${expectedFile} coverage row missing`);
    }
  }
  for (const row of rows) {
    if (row.linePercent < thresholds.linePercent) {
      violations.push(formatViolation(row.filePath, "line", row.linePercent, thresholds.linePercent));
    }
    if (row.branchPercent < thresholds.branchPercent) {
      violations.push(formatViolation(row.filePath, "branch", row.branchPercent, thresholds.branchPercent));
    }
    if (row.functionPercent < thresholds.functionPercent) {
      violations.push(formatViolation(row.filePath, "function", row.functionPercent, thresholds.functionPercent));
    }
  }
  return violations;
}

export function resolveExpectedCriticalCoverageFiles(cwd: string = process.cwd()): string[] {
  const streamDeliveryDir = path.join(cwd, "src", "runtime", "stream-delivery");
  const streamDeliveryFiles = fs.readdirSync(streamDeliveryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => normalizeReportPath(path.join("src", "runtime", "stream-delivery", entry.name)));
  return Array.from(new Set([
    ...EXPLICIT_CRITICAL_COVERAGE_FILES,
    ...streamDeliveryFiles,
  ].map((filePath) => normalizeReportPath(filePath)))).sort();
}

function stripInfoPrefix(line: string): string {
  return line.replace(/^\s*(?:ℹ|#)\s?/u, "");
}

function parsePercent(value: unknown): number {
  const parsed = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function findFirstChildIndex(stack: Array<{ indent: number }>, indent: number): number {
  const index = stack.findIndex((entry) => entry.indent >= indent);
  return index >= 0 ? index : stack.length;
}

function normalizeReportPath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

function formatViolation(filePath: string, metric: string, actual: number, expected: number): string {
  return `${filePath} ${metric} coverage ${formatNumber(actual)} < ${formatNumber(expected)}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}

export function main(): void {
  const result = spawnSync(process.execPath, CRITICAL_COVERAGE_ARGS, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");

  if (result.error instanceof Error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  const rows = parseNodeCoverageReport(`${result.stdout || ""}\n${result.stderr || ""}`);
  const violations = resolveCriticalCoverageViolations(rows, DEFAULT_THRESHOLDS, resolveExpectedCriticalCoverageFiles());
  if (violations.length) {
    throw new Error([
      "critical coverage per-file gate failed",
      "",
      ...violations.map((violation) => `- ${violation}`),
    ].join("\n"));
  }
}

if (require.main === module) {
  main();
}
