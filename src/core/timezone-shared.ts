const LEGACY_TIMELINE_TIMEZONE = "Asia/Shanghai";
const DEFAULT_FALLBACK_TIMEZONE = "UTC";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimezone(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export {
  DEFAULT_FALLBACK_TIMEZONE,
  LEGACY_TIMELINE_TIMEZONE,
  asRecord,
  normalizeText,
  normalizeTimezone,
};
