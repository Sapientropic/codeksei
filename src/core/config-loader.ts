import * as fs from "node:fs";

type MissingPolicy = "fallback" | "throw";
type InvalidPolicy = "fallback" | "throw";

interface NormalizeContext {
  filePath: string;
}

type NormalizeFn<T> = (value: unknown, context: NormalizeContext) => T;

type FallbackFactory<T> = T | (() => T);

interface CachedConfigEntry {
  mtimeMs: number;
  value: unknown;
}

export interface LoadJsonConfigOptions<T> {
  filePath?: string | null;
  label?: string;
  normalize?: NormalizeFn<T>;
  fallback?: FallbackFactory<T>;
  missing?: MissingPolicy;
  invalid?: InvalidPolicy;
  useCache?: boolean;
}

const configCache = new Map<string, CachedConfigEntry>();

export function loadJsonConfig<T>({
  filePath,
  label = "json config",
  normalize = ((value: unknown) => value as T),
  fallback = null as FallbackFactory<T>,
  missing = "fallback",
  invalid = "throw",
  useCache = true,
}: LoadJsonConfigOptions<T>): T {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath) {
    if (missing === "throw") {
      throw new Error(`${label} file path is required`);
    }
    return cloneFallback(fallback);
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(normalizedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT" && missing !== "throw") {
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
      return cloneValue(cached.value as T);
    }
  }

  let parsed: unknown;
  try {
    const raw = fs.readFileSync(normalizedPath, "utf8");
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    if (invalid === "fallback") {
      configCache.delete(normalizedPath);
      return cloneFallback(fallback);
    }
    throw new Error(`${label} is not valid JSON: ${normalizedPath} (${formatErrorMessage(error)})`);
  }

  let normalized: T;
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

export function clearJsonConfigCache(filePath: string = ""): void {
  const normalizedPath = normalizePath(filePath);
  if (normalizedPath) {
    configCache.delete(normalizedPath);
    return;
  }
  configCache.clear();
}

function cloneFallback<T>(fallback: FallbackFactory<T>): T {
  const resolved = typeof fallback === "function"
    ? (fallback as () => T)()
    : fallback;
  return cloneValue(resolved);
}

function cloneValue<T>(value: T): T {
  if (typeof value === "undefined") {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePath(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error) && typeof error === "object";
}
