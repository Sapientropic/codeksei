import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { normalizeWorkspaceAliasManifest } from "../contracts/config-files";
import { loadJsonConfig } from "../core/config-loader";

const DEFAULT_ALIAS_MANIFEST = path.join(os.homedir(), ".codex", "windows-ascii-alias", "aliases.json");

interface ResolveAliasOptions {
  manifestPath?: string;
}

interface AliasManifestEntry {
  slug?: unknown;
  target_path?: unknown;
  alias_path?: unknown;
}

interface AliasManifest {
  mappings?: AliasManifestEntry[];
}

interface AliasMapping {
  slug: string;
  targetPath: string;
  aliasPath: string;
}

interface ResolvedAliasMapping {
  slug: string;
  kind: "target" | "alias";
  fromRoot: string;
  toRoot: string;
}

export function resolveCodexWorkspaceRoot(workspaceRoot: unknown, options: ResolveAliasOptions = {}): string {
  const normalized = normalizeWorkspaceRoot(workspaceRoot);
  if (!normalized) {
    return "";
  }
  if (isAscii(normalized)) {
    return normalized;
  }

  const mapping = resolveAliasMappingForPath(normalized, options);
  if (!mapping) {
    return normalized;
  }

  const converted = convertRootedPath(normalized, mapping.fromRoot, mapping.toRoot);
  if (!converted) {
    return normalized;
  }
  // Alias roots are only a compatibility shim for Codex transport quirks. If
  // the manifest drifts or the junction disappears, prefer the real workspace
  // root over a synthetic cwd that would otherwise trigger os error 267.
  return isReadableDirectory(converted) ? converted : normalized;
}

export function resolveAliasMappingForPath(
  workspaceRoot: unknown,
  options: ResolveAliasOptions = {},
): ResolvedAliasMapping | null {
  const normalized = normalizeWorkspaceRoot(workspaceRoot);
  if (!normalized) {
    return null;
  }

  const mappings = loadAliasMappings(options);
  let bestMatch: ResolvedAliasMapping | null = null;
  let bestLength = -1;

  for (const mapping of mappings) {
    const candidates: Array<{ kind: "target" | "alias"; root: string; toRoot: string }> = [
      { kind: "target", root: mapping.targetPath, toRoot: mapping.aliasPath },
      { kind: "alias", root: mapping.aliasPath, toRoot: mapping.aliasPath },
    ];
    for (const candidate of candidates) {
      if (!isPathWithinRoot(normalized, candidate.root)) {
        continue;
      }
      if (candidate.root.length <= bestLength) {
        continue;
      }
      bestMatch = {
        slug: mapping.slug,
        kind: candidate.kind,
        fromRoot: candidate.root,
        toRoot: candidate.toRoot,
      };
      bestLength = candidate.root.length;
    }
  }

  return bestMatch;
}

export function loadAliasMappings(options: ResolveAliasOptions = {}): AliasMapping[] {
  const manifestPath = typeof options.manifestPath === "string" && options.manifestPath.trim()
    ? options.manifestPath.trim()
    : DEFAULT_ALIAS_MANIFEST;
  const manifest = loadJsonConfig<AliasManifest>({
    filePath: manifestPath,
    label: "workspace alias manifest",
    normalize: normalizeWorkspaceAliasManifest as (value: unknown) => AliasManifest,
    fallback: { mappings: [] },
    missing: "fallback",
    invalid: "fallback",
  });
  const mappings = Array.isArray(manifest?.mappings) ? manifest.mappings : [];
  return mappings
    .map((mapping) => ({
      slug: normalizeText(mapping?.slug),
      targetPath: normalizeWorkspaceRoot(mapping?.target_path),
      aliasPath: normalizeWorkspaceRoot(mapping?.alias_path),
    }))
    .filter((mapping) => Boolean(mapping.slug && mapping.targetPath && mapping.aliasPath));
}

export function convertRootedPath(pathValue: unknown, fromRoot: unknown, toRoot: unknown): string {
  const normalizedPath = normalizeWorkspaceRoot(pathValue);
  const normalizedFromRoot = normalizeWorkspaceRoot(fromRoot);
  const normalizedToRoot = normalizeWorkspaceRoot(toRoot);
  if (!normalizedPath || !normalizedFromRoot || !normalizedToRoot) {
    return "";
  }
  if (!isPathWithinRoot(normalizedPath, normalizedFromRoot)) {
    return "";
  }
  if (normalizedPath === normalizedFromRoot) {
    return normalizedToRoot;
  }
  return `${normalizedToRoot}${normalizedPath.slice(normalizedFromRoot.length)}`;
}

function isPathWithinRoot(pathValue: unknown, rootValue: unknown): boolean {
  const normalizedPath = normalizeWorkspaceRoot(pathValue);
  const normalizedRoot = normalizeWorkspaceRoot(rootValue);
  if (!normalizedPath || !normalizedRoot) {
    return false;
  }
  if (normalizedPath === normalizedRoot) {
    return true;
  }
  if (normalizedPath.length <= normalizedRoot.length) {
    return false;
  }
  if (!normalizedPath.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
    return false;
  }
  const nextChar = normalizedPath[normalizedRoot.length];
  return nextChar === "/" || nextChar === "\\";
}

function isReadableDirectory(pathValue: unknown): boolean {
  const normalized = normalizeWorkspaceRoot(pathValue);
  if (!normalized) {
    return false;
  }
  try {
    return fs.statSync(path.resolve(normalized)).isDirectory();
  } catch {
    return false;
  }
}

export function normalizeWorkspaceRoot(value: unknown): string {
  const normalized = normalizeText(value).replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  if (normalized.length > 3) {
    return normalized.replace(/\/+$/g, "");
  }
  return normalized;
}

function isAscii(value: unknown): boolean {
  for (const char of String(value || "")) {
    if (char.charCodeAt(0) > 127) {
      return false;
    }
  }
  return true;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  DEFAULT_ALIAS_MANIFEST,
};
