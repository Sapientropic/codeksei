import * as fs from "node:fs";
import * as path from "node:path";

import { resolvePackageRoot } from "../../../../contracts/path-utils";
import type { FrameRuntimeConfig } from "../../../runtime-config";

const FRAME_SOURCE_ROOT = path.join("src", "frame", "runtime", "frame");

function buildFrameSite(config: FrameRuntimeConfig): { siteDir: string } {
  const packageRoot = resolvePackageRoot(__dirname);
  const sourceRoot = path.join(packageRoot, FRAME_SOURCE_ROOT);
  const sourceSiteDir = path.join(sourceRoot, "site");
  const sourceAssetsDir = path.join(sourceRoot, "assets");
  copyRequiredFile(path.join(sourceSiteDir, "index.html"), path.join(config.frameSiteDir, "index.html"));
  copyOptionalTree(sourceAssetsDir, config.frameAssetsDir);
  return { siteDir: config.frameSiteDir };
}

function copyRequiredFile(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`frame site asset missing: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyOptionalTree(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyOptionalTree(sourcePath, targetPath);
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

export { buildFrameSite };
