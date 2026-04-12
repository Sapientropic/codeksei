const fs = require("fs");
const os = require("os");
const path = require("path");
const { normalizeWorkspaceAliasManifest } = require("../contracts/config-files");
const { loadJsonConfig } = require("../core/config-loader");

const DEFAULT_ALIAS_MANIFEST = path.join(os.homedir(), ".codex", "windows-ascii-alias", "aliases.json");

function resolveCodexWorkspaceRoot(workspaceRoot: any, options: any = {}) {
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

function resolveAliasMappingForPath(workspaceRoot: any, options: any = {}) {
  const normalized = normalizeWorkspaceRoot(workspaceRoot);
  if (!normalized) {
    return null;
  }

  const mappings = loadAliasMappings(options);
  let bestMatch = null;
  let bestLength = -1;

  for (const mapping of mappings) {
    for (const candidate of [
      { kind: "target", root: mapping.targetPath, toRoot: mapping.aliasPath },
      { kind: "alias", root: mapping.aliasPath, toRoot: mapping.aliasPath },
    ]) {
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

function loadAliasMappings(options: any = {}) {
  const manifestPath = typeof options.manifestPath === "string" && options.manifestPath.trim()
    ? options.manifestPath.trim()
    : DEFAULT_ALIAS_MANIFEST;
  const manifest = loadJsonConfig({
    filePath: manifestPath,
    label: "workspace alias manifest",
    normalize: normalizeWorkspaceAliasManifest,
    fallback: { mappings: [] },
    missing: "fallback",
    invalid: "fallback",
  });
  const mappings = Array.isArray(manifest?.mappings) ? manifest.mappings : [];
  return mappings
    .map((mapping: any) => ({
      slug: normalizeText(mapping?.slug),
      targetPath: normalizeWorkspaceRoot(mapping?.target_path),
      aliasPath: normalizeWorkspaceRoot(mapping?.alias_path),
    }))
    .filter((mapping: any) => mapping.slug && mapping.targetPath && mapping.aliasPath);
}

function convertRootedPath(pathValue: any, fromRoot: any, toRoot: any) {
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

function isPathWithinRoot(pathValue: any, rootValue: any) {
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

function isReadableDirectory(pathValue: any) {
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

function normalizeWorkspaceRoot(value: any) {
  const normalized = normalizeText(value).replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  if (normalized.length > 3) {
    return normalized.replace(/\/+$/g, "");
  }
  return normalized;
}

function isAscii(value: any) {
  for (const char of String(value || "")) {
    if (char.charCodeAt(0) > 127) {
      return false;
    }
  }
  return true;
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  DEFAULT_ALIAS_MANIFEST,
  convertRootedPath,
  loadAliasMappings,
  normalizeWorkspaceRoot,
  resolveAliasMappingForPath,
  resolveCodexWorkspaceRoot,
};

export {};
