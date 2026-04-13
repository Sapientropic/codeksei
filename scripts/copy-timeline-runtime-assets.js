#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(repoRoot, "src", "timeline");
const distRoot = path.join(repoRoot, "dist", "src", "timeline");

main();

function main() {
  copyTree(path.join(sourceRoot, "runtime"), path.join(distRoot, "runtime"));
  copyTree(path.join(sourceRoot, "examples"), path.join(distRoot, "examples"));
  console.log("[codeksei] copied vendored timeline runtime assets into dist");
}

function copyTree(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath);
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}
