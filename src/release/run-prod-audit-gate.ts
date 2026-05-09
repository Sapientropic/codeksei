#!/usr/bin/env node

import { spawnSync } from "node:child_process";

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

export interface ProdAuditGateResult {
  blockingFindings: string[];
  ignoredFindings: string[];
}

/*
 * Production dependency audit is a release gate, not a vulnerability triage
 * registry. Keep the default fail-closed: zero production vulnerabilities pass;
 * any new advisory blocks until a human reviews impact and updates dependencies
 * or writes a new, narrow exception with explicit expiry criteria.
 */
export function evaluateProdAuditGate(report: AuditReport): ProdAuditGateResult {
  const blockingFindings: string[] = [];
  const ignoredFindings: string[] = [];
  const vulnerabilities = report.vulnerabilities || {};
  const vulnerabilityKeys = Object.keys(vulnerabilities).sort();
  const totalVulnerabilityCount = toFiniteNumber(report.metadata?.vulnerabilities?.total);

  if (report.auditReportVersion !== 2) {
    blockingFindings.push(`unexpected npm audit report version ${String(report.auditReportVersion)}; expected auditReportVersion=2`);
  }

  if (!Number.isFinite(totalVulnerabilityCount)) {
    blockingFindings.push("npm audit report metadata.vulnerabilities.total is missing or invalid");
  }

  if (!vulnerabilityKeys.length && totalVulnerabilityCount === 0) {
    return { blockingFindings, ignoredFindings };
  }

  if (!vulnerabilityKeys.length) {
    blockingFindings.push(`npm audit metadata reports ${String(totalVulnerabilityCount)} production vulnerabilities but no vulnerability entries were present`);
    return { blockingFindings, ignoredFindings };
  }

  blockingFindings.push(`npm audit reported production vulnerabilities: ${vulnerabilityKeys.join(", ")}`);
  for (const key of vulnerabilityKeys) {
    blockingFindings.push(formatVulnerabilityFinding(key, vulnerabilities[key]));
  }

  return { blockingFindings, ignoredFindings };
}

export function main(): void {
  const repoRoot = resolvePackageRoot(__dirname);
  const report = readAuditReport(repoRoot);
  const result = evaluateProdAuditGate(report);

  if (result.blockingFindings.length) {
    throw new Error(formatBlockingFailure(result.blockingFindings));
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

function formatVulnerabilityFinding(name: string, vulnerability: AuditVulnerability | undefined): string {
  if (!vulnerability) {
    return `${name}: missing vulnerability detail`;
  }

  const detailParts = [
    `severity=${normalizeText(vulnerability.severity) || "<missing>"}`,
    `range=${normalizeText(vulnerability.range) || "<missing>"}`,
    `direct=${String(Boolean(vulnerability.isDirect))}`,
  ];
  const viaText = formatVia(vulnerability.via);
  if (viaText) {
    detailParts.push(`via=${viaText}`);
  }
  const fixText = formatFixAvailable(vulnerability.fixAvailable);
  if (fixText) {
    detailParts.push(`fix=${fixText}`);
  }

  return `${normalizeText(vulnerability.name) || name}: ${detailParts.join("; ")}`;
}

function formatVia(via: AuditVia[] | undefined): string {
  if (!Array.isArray(via) || !via.length) {
    return "";
  }
  return via
    .map((entry) => {
      if (typeof entry === "string") {
        return normalizeText(entry);
      }
      return [
        extractGhsa(entry.url),
        normalizeText(entry.title),
        normalizeText(entry.name),
        normalizeText(entry.range),
      ].filter(Boolean).join(" | ");
    })
    .filter(Boolean)
    .join(", ");
}

function formatFixAvailable(fixAvailable: AuditFixAvailable | boolean | undefined): string {
  if (fixAvailable === true) {
    return "available";
  }
  if (!fixAvailable || typeof fixAvailable === "boolean") {
    return "";
  }
  return [
    normalizeText(fixAvailable.name),
    normalizeText(fixAvailable.version),
    fixAvailable.isSemVerMajor ? "semver-major" : "",
  ].filter(Boolean).join("@");
}

function extractGhsa(value: unknown): string {
  const normalized = normalizeText(value);
  const match = normalized.match(/\bGHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/iu);
  return match?.[0] || "";
}

function normalizeCommandOutput(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatBlockingFailure(blockingFindings: string[]): string {
  return [
    "prod audit gate failed",
    "",
    ...blockingFindings.map((finding) => `- ${finding}`),
    "",
    "This gate requires zero production vulnerabilities by default.",
    "Run npm run audit:prod:json to inspect new advisories, then update dependencies or add a narrow reviewed exception with explicit expiry criteria.",
  ].join("\n");
}

if (require.main === module) {
  main();
}
