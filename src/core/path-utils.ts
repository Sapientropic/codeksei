import { normalizeText } from "./text-normalization";
import * as fs from "node:fs";
import * as path from "node:path";

export function normalizeDisplayPath(targetPath: unknown): string {
  return normalizeText(targetPath).replace(/\\/gu, "/");
}

export function isCrossPlatformAbsolutePath(targetPath: unknown): boolean {
  const normalized = normalizeText(targetPath);
  if (!normalized) {
    return false;
  }
  return path.isAbsolute(normalized) || path.win32.isAbsolute(normalized);
}

export function resolveCrossPlatformPath(targetPath: unknown): string {
  const normalized = normalizeText(targetPath);
  if (!normalized) {
    return "";
  }
  if (isCrossPlatformAbsolutePath(normalized)) {
    return normalizeDisplayPath(normalized);
  }
  return normalizeDisplayPath(path.resolve(normalized));
}

export function resolveCrossPlatformPathFromRoot(rootPath: unknown, ...segments: unknown[]): string {
  const normalizedRoot = normalizeText(rootPath);
  const normalizedSegments = segments
    .flat()
    .map((segment: unknown) => normalizeText(segment))
    .filter(Boolean);

  if (!normalizedRoot) {
    return resolveCrossPlatformPath(path.join(...normalizedSegments));
  }

  if (path.win32.isAbsolute(normalizedRoot) && !path.isAbsolute(normalizedRoot)) {
    return normalizeDisplayPath(path.win32.resolve(normalizedRoot, ...normalizedSegments));
  }
  return normalizeDisplayPath(path.resolve(normalizedRoot, ...normalizedSegments));
}

export function resolvePackageRoot(fromDir: unknown): string {
  let current = path.resolve(normalizeText(fromDir) || process.cwd());
  for (let index = 0; index < 8; index += 1) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return normalizeDisplayPath(current);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return normalizeDisplayPath(path.resolve(normalizeText(fromDir) || process.cwd()));
}

