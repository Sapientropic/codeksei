#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");

function collectPublishedJsFiles({ packageJson = null, cwd = rootDir } = {}) {
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

function walkJsFiles(directory, cwd, discovered) {
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

function runNodeSyntaxChecks(files, {
  cwd = rootDir,
  execFileSyncImpl = execFileSync,
  nodePath = process.execPath,
} = {}) {
  for (const relativeFile of files) {
    execFileSyncImpl(nodePath, ["--check", path.resolve(cwd, relativeFile)], {
      cwd,
      stdio: "inherit",
    });
  }
}

function toRelativePosix(cwd, absolutePath) {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

function main() {
  const files = collectPublishedJsFiles();
  if (!files.length) {
    throw new Error("No published JS files found under package.json files entries.");
  }
  runNodeSyntaxChecks(files);
  console.log(`[codeksei] syntax-checked ${files.length} published JS files`);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectPublishedJsFiles,
  runNodeSyntaxChecks,
};
