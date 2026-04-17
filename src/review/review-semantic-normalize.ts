import {
  asRecord,
  normalizeText,
  parseSemanticJson,
  type JsonObject,
} from "../core/semantic-json";

export function compactDiaryDays(entries: unknown): Array<JsonObject> {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    date: normalizeText(entry?.date),
    openTodos: normalizeStringList(entry?.todo?.open, 5, 140),
    doneTodos: normalizeStringList(entry?.todo?.done, 5, 140),
    summary: normalizeStringList(entry?.summary, 6, 180),
    timeline: normalizeStringList(entry?.timeline, 4, 160),
    fragment: normalizeStringList(entry?.fragment, 4, 180),
    supplement: normalizeSupplementGroups(
      (Array.isArray(entry?.supplement) ? entry.supplement : []).map((item: unknown) => ({
        date: normalizeText(entry?.date),
        title: normalizeText(asRecord(item).title),
        body_lines: compactBodyLines(asRecord(item).body, 3, 180),
      })),
      5,
      3,
      180,
    ),
  }));
}

export function compactNightlyDays(entries: unknown): Array<JsonObject> {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    date: normalizeText(entry?.date),
    progress: normalizeStringList(entry?.progress, 4, 160),
    friction: normalizeStringList(entry?.friction, 4, 180),
    open_loops: normalizeStringList(entry?.openLoops, 4, 140),
    carry_forward: normalizeStringList(entry?.carryForward, 4, 140),
    closeout: normalizeStringList(entry?.closeout, 4, 160),
    signals: normalizeStringList(entry?.signals, 4, 160),
  }));
}

export function normalizeSemanticResult(kind: string, raw: unknown): JsonObject | null {
  const normalizedRaw = asRecord(raw);
  if (!Object.keys(normalizedRaw).length) {
    return null;
  }
  if (kind === "nightly") {
    return {
      progress: normalizeStringList(normalizedRaw.progress, 5, 160),
      friction: normalizeStringList(normalizedRaw.friction, 5, 220),
      openLoops: normalizeStringList(normalizedRaw.open_loops || normalizedRaw.openLoops, 6, 160),
      carryForward: normalizeStringList(normalizedRaw.carry_forward || normalizedRaw.carryForward, 4, 160),
      closeout: normalizeStringList(normalizedRaw.closeout, 5, 180),
      signals: normalizeStringList(normalizedRaw.signals, 5, 160),
    };
  }
  return {
    progress: normalizeStringList(normalizedRaw.progress, 6, 180),
    friction: normalizeStringList(normalizedRaw.friction, 6, 220),
    openLoops: normalizeStringList(normalizedRaw.open_loops || normalizedRaw.openLoops, 6, 160),
    carryForward: normalizeStringList(normalizedRaw.carry_forward || normalizedRaw.carryForward, 4, 160),
    dailySummaries: normalizeDayGroups(normalizedRaw.daily_summaries || normalizedRaw.dailySummaries, 31, 3, 160),
    supplements: normalizeSupplementGroups(normalizedRaw.supplement_groups || normalizedRaw.supplements, 8, 4, 180),
  };
}

export function hasSemanticPayload(kind: string, data: JsonObject | null): boolean {
  if (!data) {
    return false;
  }
  if (kind === "nightly") {
    return [
      data.progress,
      data.friction,
      data.openLoops,
      data.carryForward,
      data.closeout,
      data.signals,
    ].some((items) => Array.isArray(items) && items.length);
  }
  return [
    data.progress,
    data.friction,
    data.openLoops,
    data.carryForward,
    data.dailySummaries,
    data.supplements,
  ].some((items) => Array.isArray(items) && items.length);
}

export function normalizeDayGroups(value: unknown, maxGroups: number, maxLines: number, maxLength: number) {
  const groups: Array<{ date: string; lines: string[] }> = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const date = normalizeText(item?.date);
    const lines = normalizeStringList(item?.lines, maxLines, maxLength);
    if (!date || !lines.length) {
      continue;
    }
    const signature = `${date}:${lines.join("|").toLowerCase()}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    groups.push({ date, lines });
    if (groups.length >= maxGroups) {
      break;
    }
  }
  return groups;
}

export function normalizeSupplementGroups(value: unknown, maxGroups: number, maxLines: number, maxLength: number) {
  const groups: Array<{ date: string; title: string; body: string }> = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const date = normalizeText(item?.date);
    const title = normalizeText(item?.title);
    const bodyLines = normalizeStringList(item?.body_lines || item?.bodyLines || item?.body, maxLines, maxLength);
    if (!date || !bodyLines.length) {
      continue;
    }
    const signature = `${date}:${title}:${bodyLines.join("|").toLowerCase()}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    groups.push({
      date,
      title,
      body: bodyLines.join("\n"),
    });
    if (groups.length >= maxGroups) {
      break;
    }
  }
  return groups;
}

export function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? splitLines(value)
      : [];
  for (const raw of rawItems) {
    const normalized = truncateSentence(normalizeText(String(raw || "").replace(/^\s*-\s*/u, "")), maxLength);
    if (!normalized) {
      continue;
    }
    const signature = normalized.toLowerCase();
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    items.push(normalized);
    if (items.length >= maxItems) {
      break;
    }
  }
  return items;
}

export function compactBodyLines(value: unknown, maxLines: number, maxLength: number): string[] {
  return normalizeStringList(splitLines(String(value || "")), maxLines, maxLength);
}

export function splitLines(value: unknown): string[] {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function truncateSentence(value: unknown, maxLength: number): string {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/[，。；,;:\s]+$/u, "")}…`;
}

export {
  asRecord,
  normalizeText,
  parseSemanticJson,
  type JsonObject,
};

