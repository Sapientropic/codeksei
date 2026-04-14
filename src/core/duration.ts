import { normalizeText } from "./text-normalization";

const DURATION_UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
} as const;

export function parseCompactDurationMs(rawValue: unknown): number {
  const normalized = normalizeText(rawValue).toLowerCase();
  if (!normalized) {
    return 0;
  }

  let totalMs = 0;
  let index = 0;
  while (index < normalized.length) {
    while (index < normalized.length && /\s/.test(normalized[index] || "")) {
      index += 1;
    }
    if (index >= normalized.length) {
      break;
    }

    const match = normalized.slice(index).match(/^(\d+)\s*([smhd])/);
    if (!match) {
      return 0;
    }

    const amount = Number.parseInt(match[1] || "", 10);
    const unitKey = normalizeText(match[2]).toLowerCase() as keyof typeof DURATION_UNIT_MS;
    const unitMs = DURATION_UNIT_MS[unitKey] || 0;
    if (!Number.isFinite(amount) || amount <= 0 || !unitMs) {
      return 0;
    }

    totalMs += amount * unitMs;
    index += match[0].length;
  }

  return totalMs > 0 ? totalMs : 0;
}
