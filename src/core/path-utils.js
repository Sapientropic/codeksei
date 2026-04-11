const path = require("path");

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDisplayPath(targetPath) {
  return normalizeText(targetPath).replace(/\\/g, "/");
}

function isCrossPlatformAbsolutePath(targetPath) {
  const normalized = normalizeText(targetPath);
  if (!normalized) {
    return false;
  }
  return path.isAbsolute(normalized) || path.win32.isAbsolute(normalized);
}

function resolveCrossPlatformPath(targetPath) {
  const normalized = normalizeText(targetPath);
  if (!normalized) {
    return "";
  }
  if (isCrossPlatformAbsolutePath(normalized)) {
    return normalizeDisplayPath(normalized);
  }
  return normalizeDisplayPath(path.resolve(normalized));
}

function resolveCrossPlatformPathFromRoot(rootPath, ...segments) {
  const normalizedRoot = normalizeText(rootPath);
  const normalizedSegments = segments
    .flat()
    .map((segment) => normalizeText(segment))
    .filter(Boolean);

  if (!normalizedRoot) {
    return resolveCrossPlatformPath(path.join(...normalizedSegments));
  }

  // CI often runs on Linux even when users configure Windows absolute roots.
  // Preserve those roots instead of reinterpreting `E:/...` as `<cwd>/E:/...`.
  if (path.win32.isAbsolute(normalizedRoot) && !path.isAbsolute(normalizedRoot)) {
    return normalizeDisplayPath(path.win32.resolve(normalizedRoot, ...normalizedSegments));
  }
  return normalizeDisplayPath(path.resolve(normalizedRoot, ...normalizedSegments));
}

module.exports = {
  isCrossPlatformAbsolutePath,
  normalizeDisplayPath,
  resolveCrossPlatformPath,
  resolveCrossPlatformPathFromRoot,
};
