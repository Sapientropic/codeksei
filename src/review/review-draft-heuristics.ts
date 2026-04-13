import { normalizeText } from "../core/text-normalization";
import type {
  DiaryReviewEntry,
  DiarySupplementEntry,
  NightlyReviewEntry,
  ReviewSupplementGroup,
} from "./review-types";

export function selectProgressFromDiary(entry: DiaryReviewEntry | null): string[] {
  if (!entry) {
    return [];
  }
  const progressFromSummary = entry.summary.filter(
    (line) => !looksLikeCarryForward(line) && !hasFrictionSignal(line),
  );
  return progressFromSummary.length ? progressFromSummary : entry.timeline;
}

export function selectFrictionFromDiary(entry: DiaryReviewEntry | null): string[] {
  if (!entry) {
    return [];
  }
  return [
    ...entry.fragment.filter(hasFrictionSignal),
    ...selectFrictionFromSupplements(entry.supplement),
    ...entry.summary.filter(hasFrictionSignal),
  ];
}

export function selectPeriodicProgress(entry: DiaryReviewEntry, nightlyEntry: NightlyReviewEntry | null | undefined): string[] {
  if (nightlyEntry?.progress?.length) {
    return nightlyEntry.progress;
  }
  return selectProgressFromDiary(entry);
}

export function selectPeriodicFriction(entry: DiaryReviewEntry, nightlyEntry: NightlyReviewEntry | null | undefined): string[] {
  if (nightlyEntry?.friction?.length) {
    return nightlyEntry.friction;
  }
  return selectFrictionFromDiary(entry);
}

export function selectPeriodicCloseout(entry: DiaryReviewEntry, nightlyEntry: NightlyReviewEntry | null | undefined): string[] {
  if (nightlyEntry?.closeout?.length) {
    return nightlyEntry.closeout;
  }
  if (entry.summary.length) {
    return entry.summary;
  }
  return selectProgressFromDiary(entry);
}

export function selectPeriodicSupplementGroups(
  entry: DiaryReviewEntry,
  nightlyEntry: NightlyReviewEntry | null | undefined,
): ReviewSupplementGroup[] {
  if (nightlyEntry?.signals?.length) {
    return [{
      date: entry.date,
      title: "夜间收口提炼",
      body: nightlyEntry.signals.map((line) => `- ${normalizeLineItem(line)}`).join("\n"),
    }];
  }
  return entry.supplement
    .map((item): ReviewSupplementGroup => ({
      date: entry.date,
      title: item.title,
      body: toCompactSentence(item.body),
    }))
    .filter((item) => item.body);
}

export function selectFrictionFromSupplements(items: DiarySupplementEntry[]): string[] {
  return items
    .map((item) => {
      const seed = item.title || toCompactSentence(item.body);
      if (!hasFrictionSignal(seed) && !hasFrictionSignal(item.body)) {
        return "";
      }
      const body = toCompactSentence(item.body);
      if (item.title && body) {
        return `${item.title}：${body}`;
      }
      return item.title || body;
    })
    .filter(Boolean);
}

export function selectSignalFromSupplements(items: DiarySupplementEntry[]): string[] {
  return items
    .map((item) => {
      const title = normalizeLineItem(item.title);
      if (title) {
        return title;
      }
      return truncateSentence(toCompactSentence(item.body), 140);
    })
    .filter(Boolean);
}

export function hasFrictionSignal(value: unknown): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return /(偏重|头痛|忘|烦|卡|累|耗|断开|岔开|拖|收不住|重复发送|截断|低电量|羞耻|分心)/u.test(normalized);
}

export function looksLikeCarryForward(value: unknown): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return /^(明天|下周|下个月|后面|下一步|后续)/u.test(normalized);
}

export function dedupeStatements(items: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawItem of items) {
    const item = normalizeLineItem(rawItem);
    if (!item) {
      continue;
    }
    const comparable = item.toLowerCase();
    if (seen.has(comparable)) {
      continue;
    }
    seen.add(comparable);
    result.push(item);
  }
  return result;
}

export function truncateSentence(value: unknown, maxLength: number): string {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/[，。；,;:\s]+$/u, "")}…`;
}

export function toCompactSentence(value: unknown): string {
  return normalizeBody(value).replace(/\s*\n+\s*/gu, " ").replace(/\s{2,}/gu, " ").trim();
}

export function normalizeBody(value: unknown): string {
  return normalizeLineEnding(value).trim();
}

export function normalizeLineItem(value: unknown): string {
  return normalizeBody(value).replace(/\s*\n+\s*/gu, " ").replace(/\s{2,}/gu, " ").trim();
}

export function normalizeLineEnding(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n");
}
export { normalizeText };

