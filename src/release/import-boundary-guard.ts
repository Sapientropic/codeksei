import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePackageRoot } from "../core/path-utils";

const repoRoot = resolvePackageRoot(__dirname);
const srcRoot = path.join(repoRoot, "src");

export interface ImportBoundaryAllowlistEntry {
  from: string;
  to: string;
}

export interface ImportBoundaryRule {
  sourcePrefix: string;
  forbiddenPrefixes: string[];
  reason: string;
}

export interface StaticImportBoundaryRule {
  sourcePrefix: string;
  disallowedPattern: RegExp;
  reason: string;
  excludeFiles?: string[];
}

export function collectSourceFiles(rootPath: string = srcRoot): string[] {
  const files: string[] = [];
  const stack: string[] = [rootPath];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (/\.(ts|js)$/u.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

export function collectRelativeDependencies(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  const matches = [
    ...source.matchAll(/from\s+["'](.+?)["']/gu),
    ...source.matchAll(/require\(\s*["'](.+?)["']\s*\)/gu),
  ];
  const dependencies: string[] = [];
  for (const match of matches) {
    const specifier = typeof match[1] === "string" ? match[1] : "";
    if (!specifier.startsWith(".")) {
      continue;
    }
    dependencies.push(resolveRepoImport(filePath, specifier));
  }
  return dependencies.filter(Boolean);
}

export function resolveImportBoundaryViolations({
  files = collectSourceFiles(),
  rules,
  allowlist = [],
}: {
  files?: string[];
  rules: ImportBoundaryRule[];
  allowlist?: ImportBoundaryAllowlistEntry[];
}): string[] {
  const violations: string[] = [];
  for (const filePath of files) {
    const relativeFile = toRepoRelative(filePath);
    for (const rule of rules) {
      if (!relativeFile.startsWith(rule.sourcePrefix)) {
        continue;
      }
      for (const dependency of collectRelativeDependencies(filePath)) {
        if (!rule.forbiddenPrefixes.some((prefix) => dependency.startsWith(prefix))) {
          continue;
        }
        const allowlisted = allowlist.some((entry) => entry.from === relativeFile && entry.to === dependency);
        if (allowlisted) {
          continue;
        }
        violations.push(`${relativeFile} -> ${dependency} (${rule.reason})`);
      }
    }
  }
  return violations;
}

export function resolveStaticImportViolations({
  files = collectSourceFiles(),
  rules,
}: {
  files?: string[];
  rules: StaticImportBoundaryRule[];
}): string[] {
  const violations: string[] = [];
  for (const filePath of files) {
    const relativeFile = toRepoRelative(filePath);
    const source = fs.readFileSync(filePath, "utf8");
    for (const rule of rules) {
      if (!relativeFile.startsWith(rule.sourcePrefix)) {
        continue;
      }
      if (Array.isArray(rule.excludeFiles) && rule.excludeFiles.includes(relativeFile)) {
        continue;
      }
      if (rule.disallowedPattern.test(source)) {
        violations.push(`${relativeFile} (${rule.reason})`);
      }
    }
  }
  return violations;
}

export function toRepoRelative(targetPath: string): string {
  return path.relative(repoRoot, targetPath).replace(/\\/g, "/");
}

function resolveRepoImport(fromFile: string, specifier: string): string {
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.js`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.js"),
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate)) || basePath;
  return toRepoRelative(resolved);
}
