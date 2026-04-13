#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePackageRoot } from "../core/path-utils";

const rootDir = resolvePackageRoot(__dirname);

interface PackageJsonLike {
  files?: unknown;
  bin?: Record<string, unknown>;
}

interface CollectPublishedRuntimeArtifactsArgs {
  packageJson?: PackageJsonLike | null;
  cwd?: string;
}

interface RunNodeSyntaxChecksArgs {
  cwd?: string;
  execFileSyncImpl?: typeof execFileSync;
  nodePath?: string;
}

interface AssertPublishedWrappersArgs {
  cwd?: string;
}

function collectPublishedRuntimeArtifacts({
  packageJson = null,
  cwd = rootDir,
}: CollectPublishedRuntimeArtifactsArgs = {}): string[] {
  const manifest = packageJson || readPackageJson(cwd);
  const roots = Array.isArray(manifest.files) ? manifest.files : [];
  const discovered = new Set<string>();

  for (const entry of roots) {
    if (typeof entry !== "string" || !entry.trim()) {
      continue;
    }
    const absoluteEntry = path.resolve(cwd, entry);
    if (!fs.existsSync(absoluteEntry)) {
      continue;
    }
    const stats = fs.statSync(absoluteEntry);
    if (stats.isDirectory()) {
      walkJsFiles(absoluteEntry, cwd, discovered);
      continue;
    }
    if (stats.isFile() && absoluteEntry.endsWith(".js")) {
      discovered.add(toRelativePosix(cwd, absoluteEntry));
    }
  }

  return [...discovered].sort();
}

function walkJsFiles(directory: string, cwd: string, discovered: Set<string>): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absoluteEntry = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(absoluteEntry, cwd, discovered);
      continue;
    }
    if (entry.isFile() && absoluteEntry.endsWith(".js")) {
      discovered.add(toRelativePosix(cwd, absoluteEntry));
    }
  }
}

function runNodeSyntaxChecks(
  files: string[],
  {
    cwd = rootDir,
    execFileSyncImpl = execFileSync,
    nodePath = process.execPath,
  }: RunNodeSyntaxChecksArgs = {},
): void {
  for (const relativeFile of files) {
    execFileSyncImpl(nodePath, ["--check", path.resolve(cwd, relativeFile)], {
      cwd,
      stdio: "inherit",
    });
  }
}

function assertPublishedRuntimeArtifactWrappersDoNotRequireSource(
  files: string[],
  { cwd = rootDir }: AssertPublishedWrappersArgs = {},
): void {
  const wrappers = files.filter((relativeFile) => /^(bin|scripts)\//u.test(relativeFile));
  for (const relativeFile of wrappers) {
    const source = fs.readFileSync(path.resolve(cwd, relativeFile), "utf8");
    if (/\.\.\/src\//u.test(source)) {
      throw new Error(`Published wrapper must not import repo source directly: ${relativeFile}`);
    }
  }
}

function assertPublishedRuntimeArtifactBinTargetsUseDist({
  packageJson = null,
  cwd = rootDir,
}: CollectPublishedRuntimeArtifactsArgs = {}): void {
  const manifest = packageJson || readPackageJson(cwd);
  for (const [binName, target] of Object.entries(manifest.bin || {})) {
    const normalizedTarget = toRelativePosix(cwd, path.resolve(cwd, String(target || "")));
    if (!normalizedTarget.startsWith("dist/")) {
      throw new Error(`bin target must point at dist output: ${binName} -> ${target}`);
    }
  }
}

function readPackageJson(cwd: string): PackageJsonLike {
  return JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as PackageJsonLike;
}

function toRelativePosix(cwd: string, absolutePath: string): string {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

function main(): void {
  const files = collectPublishedRuntimeArtifacts();
  assertPublishedRuntimeArtifactBinTargetsUseDist();
  if (!files.length) {
    console.log("[codeksei] published runtime artifact manifest points at dist (syntax checks skipped because dist is absent)");
    return;
  }
  assertPublishedRuntimeArtifactWrappersDoNotRequireSource(files);
  runNodeSyntaxChecks(files);
  console.log(`[codeksei] syntax-checked ${files.length} published runtime artifacts`);
}

if (require.main === module) {
  main();
}

export {
  assertPublishedRuntimeArtifactBinTargetsUseDist,
  assertPublishedRuntimeArtifactWrappersDoNotRequireSource,
  collectPublishedRuntimeArtifacts,
  main,
  runNodeSyntaxChecks,
};
