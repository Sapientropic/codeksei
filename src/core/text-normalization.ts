export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
}

export function normalizeLookupText(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

export function normalizeComparableText(value: unknown): string {
  return normalizeLookupText(value);
}

