#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { resolvePackageRoot } from "../core/path-utils";
import { normalizeText } from "../contracts/text-normalization";

interface AuditAdvisoryVia {
  [key: string]: unknown;
  dependency?: string;
  name?: string;
  range?: string;
  severity?: string;
  source?: number;
  title?: string;
  url?: string;
}

type AuditVia = string | AuditAdvisoryVia;

interface AuditFixAvailable {
  [key: string]: unknown;
  isSemVerMajor?: boolean;
  name?: string;
  version?: string;
}

interface AuditVulnerability {
  [key: string]: unknown;
  effects?: string[];
  fixAvailable?: AuditFixAvailable | boolean;
  isDirect?: boolean;
  name?: string;
  nodes?: string[];
  range?: string;
  severity?: string;
  via?: AuditVia[];
}

interface AuditVulnerabilityTotals {
  [key: string]: number | undefined;
  critical?: number;
  high?: number;
  info?: number;
  low?: number;
  moderate?: number;
  total?: number;
}

interface AuditReport {
  auditReportVersion?: number;
  metadata?: {
    dependencies?: Record<string, number>;
    vulnerabilities?: AuditVulnerabilityTotals;
  };
  vulnerabilities?: Record<string, AuditVulnerability>;
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface InstalledProdAuditState {
  hasDirectUuidDependency?: boolean;
  uuidVersion: string;
  visDataSource: string;
  visDataVersion: string;
  visTimelineVersion: string;
}

export interface ProdAuditGateResult {
  blockingFindings: string[];
  ignoredFindings: string[];
}

const REVIEWED_VIS_TIMELINE_UUID_EXCEPTION = {
  advisorySource: 1116970,
  advisoryTitle: "uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided",
  advisoryUrl: "https://github.com/advisories/GHSA-w5hq-g745-h8pq",
  fixAvailable: {
    isSemVerMajor: true,
    name: "vis-timeline",
    version: "7.2.1",
  },
  packageVersions: {
    uuid: "13.0.0",
    visData: "8.0.3",
    visTimeline: "8.5.0",
  },
  reviewedAt: "2026-05-03",
  uuidRange: "<14.0.0",
} as const;

const REVIEWED_VULNERABILITY_KEYS = ["uuid", "vis-data", "vis-timeline"] as const;
const VIS_DATA_UUID_SOURCE_RELATIVE_PATH = path.join("node_modules", "vis-data", "esnext", "esm", "vis-data.js");

/*
 * This gate is intentionally fail-closed and intentionally narrower than
 * `npm audit` itself. As of 2026-05-03, the latest published `vis-data@8.0.3`
 * and `vis-timeline@8.5.0` still peer-cap `uuid` at `^13`, so forcing
 * `uuid@14` breaks `npm ci` on GitHub Actions. At the same time, the current
 * `npm audit --omit=dev` result is a single GHSA on `uuid < 14` flowing through
 * `vis-timeline -> vis-data -> uuid`.
 *
 * We are not globally ignoring `uuid < 14`. We only tolerate this exact chain
 * while all of the following remain true:
 * - the audit output still contains only GHSA-w5hq-g745-h8pq through
 *   `vis-timeline -> vis-data -> uuid`
 * - the repo does not add a direct `uuid` dependency
 * - installed versions stay pinned to the reviewed tuple
 *   `vis-timeline@8.5.0`, `vis-data@8.0.3`, `uuid@13.0.0`
 * - the installed `vis-data` build still imports and calls only `uuid.v4`
 *
 * Exit conditions: remove this exception as soon as upstream accepts `uuid@14`,
 * the dependency chain disappears, the repo replaces `vis-timeline`, or the
 * installed `vis-data` uuid usage changes and needs a fresh human review.
 */

export function isVisDataUuidV4OnlyUsage(source: string): boolean {
  const importMatch = source.match(/import\s*\{\s*([^}]+)\s*\}\s*from\s*["']uuid["']/u);
  if (!importMatch) {
    return false;
  }
  const specifier = String(importMatch[1] || "").trim();
  const aliasMatch = specifier.match(/^v4(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u);
  if (!aliasMatch) {
    return false;
  }
  const callName = aliasMatch[1] || "v4";
  return new RegExp(`\\b${escapeRegExp(callName)}\\s*\\(`, "u").test(source);
}

export function evaluateProdAuditGate(
  report: AuditReport,
  installedState: InstalledProdAuditState,
): ProdAuditGateResult {
  const blockingFindings: string[] = [];
  const ignoredFindings: string[] = [];
  const vulnerabilities = report.vulnerabilities || {};
  const vulnerabilityKeys = Object.keys(vulnerabilities).sort();
  const totals = report.metadata?.vulnerabilities;
  const totalVulnerabilityCount = toFiniteNumber(totals?.total);

  if (!vulnerabilityKeys.length || totalVulnerabilityCount === 0) {
    return { blockingFindings, ignoredFindings };
  }

  if (report.auditReportVersion !== 2) {
    blockingFindings.push(`unexpected npm audit report version ${String(report.auditReportVersion)}; reviewed exception expects auditReportVersion=2`);
  }

  if (installedState.hasDirectUuidDependency) {
    blockingFindings.push("root package.json declares a direct uuid dependency; the reviewed exception only covers the transitive vis-timeline -> vis-data -> uuid chain");
  }

  assertExactStringSet(
    vulnerabilityKeys,
    [...REVIEWED_VULNERABILITY_KEYS],
    "production vulnerability keys",
    blockingFindings,
  );
  validateUuidVulnerability(vulnerabilities.uuid, blockingFindings);
  validateVisDataVulnerability(vulnerabilities["vis-data"], blockingFindings);
  validateVisTimelineVulnerability(vulnerabilities["vis-timeline"], blockingFindings);
  validateVulnerabilityTotals(totals, blockingFindings);
  validateInstalledState(installedState, blockingFindings);

  if (!blockingFindings.length) {
    ignoredFindings.push([
      `ignored reviewed advisory GHSA-w5hq-g745-h8pq (${REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.advisoryUrl})`,
      `only for vis-timeline@${installedState.visTimelineVersion} -> vis-data@${installedState.visDataVersion} -> uuid@${installedState.uuidVersion}`,
      `reviewed ${REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.reviewedAt}; remove once upstream accepts uuid@14, the chain disappears, or vis-data uuid usage changes`,
    ].join(" | "));
  }

  return { blockingFindings, ignoredFindings };
}

export function main(): void {
  const repoRoot = resolvePackageRoot(__dirname);
  const report = readAuditReport(repoRoot);
  const installedState = readInstalledProdAuditState(repoRoot);
  const result = evaluateProdAuditGate(report, installedState);

  if (result.blockingFindings.length) {
    throw new Error(formatBlockingFailure(result.blockingFindings));
  }

  if (result.ignoredFindings.length) {
    process.stdout.write([
      "[codeksei] prod audit gate passed with a reviewed exception",
      ...result.ignoredFindings.map((finding) => `- ${finding}`),
    ].join("\n"));
    process.stdout.write("\n");
    return;
  }

  process.stdout.write("[codeksei] prod audit gate passed: npm audit reported no production vulnerabilities\n");
}

function readAuditReport(repoRoot: string): AuditReport {
  const result = spawnSync(...resolveAuditCommand(), {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error instanceof Error) {
    throw new Error(`npm audit --omit=dev --json failed to launch: ${result.error.message}`);
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error([
      `npm audit --omit=dev --json exited with ${String(result.status)}`,
      normalizeCommandOutput(result.stderr),
    ].filter(Boolean).join("\n"));
  }
  const stdout = normalizeCommandOutput(result.stdout);
  if (!stdout) {
    throw new Error("npm audit --omit=dev --json did not return JSON output");
  }
  try {
    return JSON.parse(stdout) as AuditReport;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse npm audit JSON: ${message}`);
  }
}

function resolveAuditCommand(): [command: string, args: string[]] {
  if (process.platform === "win32") {
    return [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm audit --omit=dev --json"]];
  }
  return ["npm", ["audit", "--omit=dev", "--json"]];
}

function readInstalledProdAuditState(repoRoot: string): InstalledProdAuditState {
  const packageManifest = readJsonFile<PackageManifest>(path.join(repoRoot, "package.json"));
  return {
    hasDirectUuidDependency: hasDirectUuidDependency(packageManifest),
    uuidVersion: readInstalledPackageVersion(repoRoot, "uuid"),
    visDataSource: fs.readFileSync(path.join(repoRoot, VIS_DATA_UUID_SOURCE_RELATIVE_PATH), "utf8"),
    visDataVersion: readInstalledPackageVersion(repoRoot, "vis-data"),
    visTimelineVersion: readInstalledPackageVersion(repoRoot, "vis-timeline"),
  };
}

function readInstalledPackageVersion(repoRoot: string, packageName: string): string {
  const manifest = readJsonFile<{ version?: string }>(
    path.join(repoRoot, "node_modules", packageName, "package.json"),
  );
  return normalizeText(manifest.version);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function hasDirectUuidDependency(manifest: PackageManifest): boolean {
  return Boolean(
    manifest.dependencies?.uuid
      || manifest.devDependencies?.uuid
      || manifest.optionalDependencies?.uuid
      || manifest.peerDependencies?.uuid,
  );
}

function validateUuidVulnerability(vulnerability: AuditVulnerability | undefined, findings: string[]): void {
  if (!vulnerability) {
    findings.push("uuid vulnerability entry missing from npm audit output");
    return;
  }
  assertCommonVulnerabilityShape(vulnerability, {
    expectedEffects: ["vis-data", "vis-timeline"],
    expectedIsDirect: false,
    expectedName: "uuid",
    expectedNodes: ["node_modules/uuid"],
    expectedRange: REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.uuidRange,
    expectedSeverity: "moderate",
    label: "uuid vulnerability",
  }, findings);

  if (!Array.isArray(vulnerability.via) || vulnerability.via.length !== 1) {
    findings.push("uuid vulnerability via chain no longer matches the reviewed single-advisory shape");
  } else {
    const viaEntry = vulnerability.via[0];
    if (!viaEntry || typeof viaEntry === "string" || !matchesReviewedUuidAdvisory(viaEntry)) {
      findings.push("uuid vulnerability advisory no longer matches reviewed GHSA-w5hq-g745-h8pq metadata");
    }
  }

  assertFixAvailable(vulnerability.fixAvailable, "uuid vulnerability", findings);
}

function validateVisDataVulnerability(vulnerability: AuditVulnerability | undefined, findings: string[]): void {
  if (!vulnerability) {
    findings.push("vis-data vulnerability entry missing from npm audit output");
    return;
  }
  assertCommonVulnerabilityShape(vulnerability, {
    expectedEffects: ["vis-timeline"],
    expectedIsDirect: false,
    expectedName: "vis-data",
    expectedNodes: ["node_modules/vis-data"],
    expectedRange: ">=6.5.0",
    expectedSeverity: "moderate",
    label: "vis-data vulnerability",
  }, findings);
  assertExactStringSet(normalizeStringArray(vulnerability.via), ["uuid"], "vis-data vulnerability via chain", findings);
  assertFixAvailable(vulnerability.fixAvailable, "vis-data vulnerability", findings);
}

function validateVisTimelineVulnerability(vulnerability: AuditVulnerability | undefined, findings: string[]): void {
  if (!vulnerability) {
    findings.push("vis-timeline vulnerability entry missing from npm audit output");
    return;
  }
  assertCommonVulnerabilityShape(vulnerability, {
    expectedEffects: [],
    expectedIsDirect: true,
    expectedName: "vis-timeline",
    expectedNodes: ["node_modules/vis-timeline"],
    expectedRange: ">=7.3.0",
    expectedSeverity: "moderate",
    label: "vis-timeline vulnerability",
  }, findings);
  assertExactStringSet(normalizeStringArray(vulnerability.via), ["uuid", "vis-data"], "vis-timeline vulnerability via chain", findings);
  assertFixAvailable(vulnerability.fixAvailable, "vis-timeline vulnerability", findings);
}

function validateInstalledState(installedState: InstalledProdAuditState, findings: string[]): void {
  if (installedState.visDataVersion !== REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.packageVersions.visData) {
    findings.push(`expected vis-data version ${REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.packageVersions.visData} but found ${installedState.visDataVersion || "<missing>"}`);
  }
  if (installedState.visTimelineVersion !== REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.packageVersions.visTimeline) {
    findings.push(`expected vis-timeline version ${REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.packageVersions.visTimeline} but found ${installedState.visTimelineVersion || "<missing>"}`);
  }
  if (installedState.uuidVersion !== REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.packageVersions.uuid) {
    findings.push(`expected uuid version ${REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.packageVersions.uuid} but found ${installedState.uuidVersion || "<missing>"}`);
  }
  if (!isVisDataUuidV4OnlyUsage(installedState.visDataSource)) {
    findings.push("vis-data uuid usage no longer matches the reviewed v4-only import-and-call shape");
  }
}

function validateVulnerabilityTotals(totals: AuditVulnerabilityTotals | undefined, findings: string[]): void {
  const expectedTotals: Record<keyof AuditVulnerabilityTotals, number> = {
    critical: 0,
    high: 0,
    info: 0,
    low: 0,
    moderate: 3,
    total: 3,
  };
  for (const [field, expectedValue] of Object.entries(expectedTotals) as Array<[keyof AuditVulnerabilityTotals, number]>) {
    const actualValue = toFiniteNumber(totals?.[field]);
    if (actualValue !== expectedValue) {
      findings.push(`expected vulnerability totals.${field}=${String(expectedValue)} but found ${String(actualValue)}`);
    }
  }
}

function assertCommonVulnerabilityShape(
  vulnerability: AuditVulnerability,
  expectation: {
    expectedEffects: string[];
    expectedIsDirect: boolean;
    expectedName: string;
    expectedNodes: string[];
    expectedRange: string;
    expectedSeverity: string;
    label: string;
  },
  findings: string[],
): void {
  if (vulnerability.name !== expectation.expectedName) {
    findings.push(`${expectation.label} name changed from ${expectation.expectedName} to ${String(vulnerability.name || "<missing>")}`);
  }
  if (vulnerability.severity !== expectation.expectedSeverity) {
    findings.push(`${expectation.label} severity changed from ${expectation.expectedSeverity} to ${String(vulnerability.severity || "<missing>")}`);
  }
  if (vulnerability.isDirect !== expectation.expectedIsDirect) {
    findings.push(`${expectation.label} isDirect changed from ${String(expectation.expectedIsDirect)} to ${String(vulnerability.isDirect)}`);
  }
  if (vulnerability.range !== expectation.expectedRange) {
    findings.push(`${expectation.label} range changed from ${expectation.expectedRange} to ${String(vulnerability.range || "<missing>")}`);
  }
  assertExactStringSet(normalizeStringArray(vulnerability.nodes), expectation.expectedNodes, `${expectation.label} nodes`, findings);
  assertExactStringSet(normalizeStringArray(vulnerability.effects), expectation.expectedEffects, `${expectation.label} effects`, findings);
}

function assertFixAvailable(
  fixAvailable: AuditFixAvailable | boolean | undefined,
  label: string,
  findings: string[],
): void {
  if (!fixAvailable || typeof fixAvailable === "boolean") {
    findings.push(`${label} fixAvailable no longer matches the reviewed vis-timeline@7.2.1 semver-major suggestion`);
    return;
  }
  const expected = REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.fixAvailable;
  if (
    fixAvailable.name !== expected.name
    || fixAvailable.version !== expected.version
    || fixAvailable.isSemVerMajor !== expected.isSemVerMajor
  ) {
    findings.push(`${label} fixAvailable no longer matches the reviewed vis-timeline@7.2.1 semver-major suggestion`);
  }
}

function matchesReviewedUuidAdvisory(viaEntry: AuditAdvisoryVia): boolean {
  return viaEntry.source === REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.advisorySource
    && viaEntry.name === "uuid"
    && viaEntry.dependency === "uuid"
    && viaEntry.title === REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.advisoryTitle
    && viaEntry.url === REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.advisoryUrl
    && viaEntry.severity === "moderate"
    && viaEntry.range === REVIEWED_VIS_TIMELINE_UUID_EXCEPTION.uuidRange;
}

function assertExactStringSet(
  actualValues: string[],
  expectedValues: string[],
  label: string,
  findings: string[],
): void {
  const actual = actualValues.slice().sort();
  const expected = expectedValues.slice().sort();
  if (actual.length !== expected.length) {
    findings.push(`${label} changed from [${expected.join(", ")}] to [${actual.join(", ")}]`);
    return;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      findings.push(`${label} changed from [${expected.join(", ")}] to [${actual.join(", ")}]`);
      return;
    }
  }
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function normalizeCommandOutput(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function formatBlockingFailure(blockingFindings: string[]): string {
  return [
    "prod audit gate failed",
    "",
    ...blockingFindings.map((finding) => `- ${finding}`),
    "",
    "This gate only ignores GHSA-w5hq-g745-h8pq for the reviewed vis-timeline -> vis-data -> uuid chain.",
    "Re-review and remove the exception once upstream accepts uuid@14, the chain disappears, or vis-data uuid usage changes.",
  ].join("\n");
}

if (require.main === module) {
  main();
}
