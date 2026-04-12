#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..", "..", "..");

function collectPublishedJsFiles({ packageJson = null, cwd = rootDir }: any = {}) {
  const manifest = packageJson || JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  const roots = Array.isArray(manifest.files) ? manifest.files : [];
  const discovered = new Set();

  for (const entry of roots) {
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

function walkJsFiles(directory: any, cwd: any, discovered: any) {
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

function runNodeSyntaxChecks(files: any, {
  cwd = rootDir,
  execFileSyncImpl = execFileSync,
  nodePath = process.execPath,
}: any = {}) {
  for (const relativeFile of files) {
    execFileSyncImpl(nodePath, ["--check", path.resolve(cwd, relativeFile)], {
      cwd,
      stdio: "inherit",
    });
  }
}

function assertPublishedWrappersDoNotRequireSource(files: any, { cwd = rootDir }: any = {}) {
  const wrappers = files.filter((relativeFile: any) => /^(bin|scripts)\//u.test(relativeFile));
  for (const relativeFile of wrappers) {
    const source = fs.readFileSync(path.resolve(cwd, relativeFile), "utf8");
    if (/\.\.\/src\//u.test(source)) {
      throw new Error(`Published wrapper must not import repo source directly: ${relativeFile}`);
    }
  }
}

function assertBinTargetsUseDist({ packageJson = null, cwd = rootDir }: any = {}) {
  const manifest = packageJson || JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  for (const [binName, target] of Object.entries(manifest.bin || {})) {
    const normalizedTarget = toRelativePosix(cwd, path.resolve(cwd, String(target || "")));
    if (!normalizedTarget.startsWith("dist/")) {
      throw new Error(`bin target must point at dist output: ${binName} -> ${target}`);
    }
  }
}

function toRelativePosix(cwd: any, absolutePath: any) {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

function main() {
  const files = collectPublishedJsFiles();
  if (!files.length) {
    throw new Error("No published JS files found under package.json files entries.");
  }
  assertBinTargetsUseDist();
  assertPublishedWrappersDoNotRequireSource(files);
  runNodeSyntaxChecks(files);
  console.log(`[codeksei] syntax-checked ${files.length} published JS files`);
}

if (require.main === module) {
  main();
}

module.exports = {
  assertPublishedWrappersDoNotRequireSource,
  assertBinTargetsUseDist,
  collectPublishedJsFiles,
  main,
  runNodeSyntaxChecks,
};

export {};
