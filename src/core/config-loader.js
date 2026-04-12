// @ts-check

const fs = require("fs");

const configCache = new Map();

function loadJsonConfig({
  filePath,
  label = "json config",
  normalize = (value, _context) => value,
  fallback = null,
  missing = "fallback",
  invalid = "throw",
  useCache = true,
}) {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath) {
    if (missing === "throw") {
      throw new Error(`${label} file path is required`);
    }
    return cloneFallback(fallback);
  }

  let stats = null;
  try {
    stats = fs.statSync(normalizedPath);
  } catch (error) {
    if (error?.code === "ENOENT" && missing !== "throw") {
      configCache.delete(normalizedPath);
      return cloneFallback(fallback);
    }
    throw new Error(`${label} not found: ${normalizedPath}`);
  }

  if (!stats.isFile()) {
    if (invalid === "fallback") {
      configCache.delete(normalizedPath);
      return cloneFallback(fallback);
    }
    throw new Error(`${label} is not a file: ${normalizedPath}`);
  }

  if (useCache) {
    const cached = configCache.get(normalizedPath);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cloneValue(cached.value);
    }
  }

  let parsed = null;
  try {
    const raw = fs.readFileSync(normalizedPath, "utf8");
    parsed = JSON.parse(raw);
  } catch (error) {
    if (invalid === "fallback") {
      configCache.delete(normalizedPath);
      return cloneFallback(fallback);
    }
    throw new Error(`${label} is not valid JSON: ${normalizedPath} (${formatErrorMessage(error)})`);
  }

  let normalized = null;
  try {
    normalized = normalize(parsed, { filePath: normalizedPath });
  } catch (error) {
    if (invalid === "fallback") {
      configCache.delete(normalizedPath);
      return cloneFallback(fallback);
    }
    throw new Error(`${label} is invalid: ${normalizedPath} (${formatErrorMessage(error)})`);
  }

  configCache.set(normalizedPath, {
    mtimeMs: stats.mtimeMs,
    value: cloneValue(normalized),
  });
  return cloneValue(normalized);
}

function clearJsonConfigCache(filePath = "") {
  const normalizedPath = normalizePath(filePath);
  if (normalizedPath) {
    configCache.delete(normalizedPath);
    return;
  }
  configCache.clear();
}

function cloneFallback(fallback) {
  if (typeof fallback === "function") {
    return cloneValue(fallback());
  }
  return cloneValue(fallback);
}

function cloneValue(value) {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizePath(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

module.exports = {
  clearJsonConfigCache,
  loadJsonConfig,
};
