import { normalizeText } from "./text-normalization";

export type CodekseiLocale = "zh-CN" | "en";

export const DEFAULT_CODEKSEI_LOCALE: CodekseiLocale = "zh-CN";

export function normalizeCodekseiLocale(value: unknown): CodekseiLocale | "" {
  const normalized = normalizeText(value).replace(/_/gu, "-").toLowerCase();
  if (normalized === "en" || normalized === "en-us" || normalized === "en-gb") {
    return "en";
  }
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans" || normalized === "cn") {
    return "zh-CN";
  }
  return "";
}

export function resolveCodekseiLocale(...values: unknown[]): CodekseiLocale {
  for (const value of values) {
    const normalized = normalizeCodekseiLocale(value);
    if (normalized) {
      return normalized;
    }
  }
  return DEFAULT_CODEKSEI_LOCALE;
}

export function pickLocalizedText(
  catalog: Partial<Record<CodekseiLocale, string>> & { default?: string },
  locale: unknown,
): string {
  const resolved = resolveCodekseiLocale(locale);
  return catalog[resolved] || catalog[DEFAULT_CODEKSEI_LOCALE] || catalog.default || "";
}
