import * as fs from "node:fs";

import {
  normalizeDisplayPath,
  resolveCrossPlatformPathFromRoot,
} from "./path-utils";
import { normalizeText } from "./text-normalization";

export const PRIMARY_WORKSPACE_CONFIG_DIR = ".codeksei";
export const LEGACY_WORKSPACE_CONFIG_DIR = ".codex";

export function listWorkspaceScopedRelativePathCandidates(relativePath: unknown): string[] {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  if (!normalizedRelativePath) {
    return [];
  }

  const primaryPrefix = `${PRIMARY_WORKSPACE_CONFIG_DIR}/`;
  const legacyPrefix = `${LEGACY_WORKSPACE_CONFIG_DIR}/`;
  if (normalizedRelativePath.startsWith(primaryPrefix)) {
    const suffix = normalizedRelativePath.slice(primaryPrefix.length);
    return dedupeRelativePaths([
      normalizedRelativePath,
      `${LEGACY_WORKSPACE_CONFIG_DIR}/${suffix}`,
    ]);
  }
  if (normalizedRelativePath.startsWith(legacyPrefix)) {
    const suffix = normalizedRelativePath.slice(legacyPrefix.length);
    return dedupeRelativePaths([
      `${PRIMARY_WORKSPACE_CONFIG_DIR}/${suffix}`,
      normalizedRelativePath,
    ]);
  }
  return [normalizedRelativePath];
}

export function listWorkspaceScopedConfigFileCandidates(
  workspaceRoot: unknown,
  fileName: unknown,
): string[] {
  const normalizedFileName = normalizeRelativePath(fileName);
  if (!normalizedFileName) {
    return [];
  }
  return [
    resolveCrossPlatformPathFromRoot(workspaceRoot, PRIMARY_WORKSPACE_CONFIG_DIR, normalizedFileName),
    resolveCrossPlatformPathFromRoot(workspaceRoot, LEGACY_WORKSPACE_CONFIG_DIR, normalizedFileName),
  ].filter(Boolean);
}

export function resolveWorkspaceScopedConfigFile(
  workspaceRoot: unknown,
  fileName: unknown,
): string {
  const candidates = listWorkspaceScopedConfigFileCandidates(workspaceRoot, fileName);
  return candidates.find(isReadableFile) || candidates[0] || "";
}

function isReadableFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function normalizeRelativePath(value: unknown): string {
  return normalizeDisplayPath(normalizeText(value))
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "");
}

function dedupeRelativePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const candidate of paths) {
    const normalized = normalizeRelativePath(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

