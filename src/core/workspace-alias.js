const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_ALIAS_MANIFEST = path.join(os.homedir(), ".codex", "windows-ascii-alias", "aliases.json");

function resolveCodexWorkspaceRoot(workspaceRoot, options = {}) {
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
  return converted || normalized;
}

function resolveAliasMappingForPath(workspaceRoot, options = {}) {
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

function loadAliasMappings(options = {}) {
  const manifestPath = typeof options.manifestPath === "string" && options.manifestPath.trim()
    ? options.manifestPath.trim()
    : DEFAULT_ALIAS_MANIFEST;
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const mappings = Array.isArray(parsed?.mappings) ? parsed.mappings : [];
    return mappings
      .map((mapping) => ({
        slug: normalizeText(mapping?.slug),
        targetPath: normalizeWorkspaceRoot(mapping?.target_path),
        aliasPath: normalizeWorkspaceRoot(mapping?.alias_path),
      }))
      .filter((mapping) => mapping.slug && mapping.targetPath && mapping.aliasPath);
  } catch {
    return [];
  }
}

function convertRootedPath(pathValue, fromRoot, toRoot) {
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

function isPathWithinRoot(pathValue, rootValue) {
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

function normalizeWorkspaceRoot(value) {
  const normalized = normalizeText(value).replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  if (normalized.length > 3) {
    return normalized.replace(/\/+$/g, "");
  }
  return normalized;
}

function isAscii(value) {
  for (const char of String(value || "")) {
    if (char.charCodeAt(0) > 127) {
      return false;
    }
  }
  return true;
}

function normalizeText(value) {
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
