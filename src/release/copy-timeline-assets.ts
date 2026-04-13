#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const sourceRoot = path.join(repoRoot, "src", "timeline");
const distRoot = path.join(repoRoot, "dist", "src", "timeline");
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"]);

export function copyTimelineAssets(): void {
  copyTree(path.join(sourceRoot, "runtime"), path.join(distRoot, "runtime"), {
    shouldCopyFile: (sourcePath) => !isCodeAsset(sourcePath),
  });
  copyTree(path.join(sourceRoot, "examples"), path.join(distRoot, "examples"));
  console.log("[codeksei] copied timeline non-code assets into dist");
}

interface CopyTreeOptions {
  shouldCopyFile?: (sourcePath: string) => boolean;
}

function copyTree(sourceDir: string, targetDir: string, options: CopyTreeOptions = {}): void {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath, options);
      continue;
    }
    if (options.shouldCopyFile && !options.shouldCopyFile(sourcePath)) {
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function isCodeAsset(sourcePath: string): boolean {
  const fileName = path.basename(sourcePath);
  if (fileName.endsWith(".d.ts")) {
    return true;
  }
  return CODE_EXTENSIONS.has(path.extname(sourcePath));
}

export function main(): void {
  copyTimelineAssets();
}

if (require.main === module) {
  main();
}
