// @ts-check

import {
  LEGACY_TIMELINE_TIMEZONE,
  getCurrentDateStringInTimezone,
} from "../core/timezone";
import type {
  DiaryReviewEntry,
  DiarySupplementEntry,
  NightlyReviewEntry,
  ReviewDatedLines,
  ReviewDraft,
  ReviewKind,
  ReviewProfile,
  ReviewSemanticPatch,
  ReviewSupplementGroup,
  ReviewWindow,
} from "./review-types";

function buildReviewDraft(
  profile: ReviewProfile,
  window: ReviewWindow,
  diaryEntries: DiaryReviewEntry[],
  nightlyEntries: NightlyReviewEntry[] = [],
): ReviewDraft {
  if (profile.kind === "nightly") {
    return buildNightlyDraft(profile, window, diaryEntries);
  }
  return buildPeriodicReviewDraft(profile, window, diaryEntries, nightlyEntries);
}

function buildNightlyDraft(
  profile: ReviewProfile,
  window: ReviewWindow,
  diaryEntries: DiaryReviewEntry[],
): ReviewDraft {
  const entry = diaryEntries[0] || null;
  const openTodos = entry ? entry.todo.open.length : 0;
  const doneTodos = entry ? entry.todo.done.length : 0;
  const timelineCount = entry ? entry.timeline.length : 0;
  const supplementCount = entry ? entry.supplement.length : 0;

  const progress = dedupeStatements(selectProgressFromDiary(entry)).slice(0, 6);
  const friction = dedupeStatements(selectFrictionFromDiary(entry)).slice(0, 6);
  const openLoops = dedupeStatements(entry ? entry.todo.open : []).slice(0, 8);
  const carryForward = dedupeStatements([
    ...(entry ? entry.summary.filter(looksLikeCarryForward) : []),
    ...openLoops,
  ]).slice(0, 5);
  const closeout = dedupeStatements(
    entry && entry.summary.length ? entry.summary : progress,
  ).slice(0, 6);
  const signals = dedupeStatements([
    ...(entry ? entry.fragment : []),
    ...selectSignalFromSupplements(entry ? entry.supplement : []),
    ...carryForward,
  ]).slice(0, 6);
  const windowFacts = [
    `日期：${window.startDate}`,
    `覆盖日记：${diaryEntries.length} 天`,
    `Todo 完成 / 未完成：${doneTodos} / ${openTodos}`,
    `时间线事实条数：${timelineCount}`,
    `补充记录条数：${supplementCount}`,
  ];

  return {
    periodLabel: window.label,
    periodTitle: `${window.label} ${profile.titleSuffix}`,
    sourceDiaryDays: diaryEntries.length,
    sourceNightlyDays: 0,
    windowFacts,
    insights: {
      progress,
      friction,
      openLoops,
      carryForward,
      closeout,
      signals,
    },
    content: {
      window: renderBulletList(windowFacts, "今天还没有可用的日记事实。"),
      progress: renderBulletList(progress, "今天还没有收出可用的推进摘要。"),
      friction: renderBulletList(friction, "今天还没有明显的摩擦摘要。"),
      "open-loops": renderBulletList(openLoops, "今晚没有明显还开着的线头。"),
      "carry-forward": renderBulletList(carryForward, "明天先从最小动作重新接上。"),
      closeout: renderBulletList(closeout, "今天的睡前收口还没有写出来。"),
      signals: renderBulletList(signals, "今天还没有稳定到值得带走的信号。"),
    },
  };
}

function buildPeriodicReviewDraft(
  profile: ReviewProfile,
  window: ReviewWindow,
  diaryEntries: DiaryReviewEntry[],
  nightlyEntries: NightlyReviewEntry[] = [],
): ReviewDraft {
  const latestEntry = diaryEntries[diaryEntries.length - 1] || null;
  const nightlyByDate = new Map(nightlyEntries.map((entry) => [entry.date, entry]));
  const totalOpenTodos = diaryEntries.reduce((sum, entry) => sum + entry.todo.open.length, 0);
  const totalDoneTodos = diaryEntries.reduce((sum, entry) => sum + entry.todo.done.length, 0);
  const totalTimelineFacts = diaryEntries.reduce((sum, entry) => sum + entry.timeline.length, 0);

  const progress = dedupeStatements(
    diaryEntries.flatMap((entry) => selectPeriodicProgress(entry, nightlyByDate.get(entry.date))),
  ).slice(0, 8);

  const friction = dedupeStatements(
    diaryEntries.flatMap((entry) => selectPeriodicFriction(entry, nightlyByDate.get(entry.date))),
  ).slice(0, 8);

  const latestNightly = latestEntry ? nightlyByDate.get(latestEntry.date) || null : null;
  const openLoops = dedupeStatements(
    latestNightly?.openLoops?.length
      ? latestNightly.openLoops
      : (latestEntry ? latestEntry.todo.open : []),
  ).slice(0, 8);

  const carryForward = dedupeStatements([
    ...(latestNightly?.carryForward || []),
    ...(latestEntry ? latestEntry.summary.filter(looksLikeCarryForward) : []),
    ...openLoops,
  ]).slice(0, 5);

  const dailySummaries = diaryEntries
    .map((entry): ReviewDatedLines => ({
      date: entry.date,
      lines: dedupeStatements(
        selectPeriodicCloseout(entry, nightlyByDate.get(entry.date)),
      ).slice(0, 6),
    }))
    .filter((entry) => entry.lines.length);

  const supplements = diaryEntries
    .flatMap((entry) => selectPeriodicSupplementGroups(entry, nightlyByDate.get(entry.date)))
    .slice(-8);
  const windowFacts = [
    `时间范围：${window.startDate} ~ ${window.endDate}`,
    `覆盖日记：${diaryEntries.length} 天`,
    `夜间收口：${nightlyEntries.length} 天`,
    `Todo 完成 / 未完成：${totalDoneTodos} / ${totalOpenTodos}`,
    `时间线事实条数：${totalTimelineFacts}`,
    `周期末尾仍开着的线头：${openLoops.length}`,
  ];

  return {
    periodLabel: window.label,
    periodTitle: `${window.label} ${profile.titleSuffix}`,
    sourceDiaryDays: diaryEntries.length,
    sourceNightlyDays: nightlyEntries.length,
    windowFacts,
    insights: {
      progress,
      friction,
      openLoops,
      carryForward,
      dailySummaries,
      supplements,
    },
    content: {
      window: renderBulletList(windowFacts, "这一段时间还没有可用日记事实。"),
      progress: renderBulletList(progress, "这段时间还没有收出可用的推进摘要。"),
      friction: renderBulletList(friction, "这段时间还没有明显的摩擦摘要。"),
      "open-loops": renderBulletList(openLoops, "这一周期末尾没有明显还开着的线头。"),
      "carry-forward": renderBulletList(carryForward, "下一次先从最小动作重新接上。"),
      "daily-summaries": renderDatedGroups(dailySummaries, "这段时间没有可引用的每日总结。"),
      supplements: renderSupplementGroups(supplements, "这段时间没有值得回看的补充记录。"),
    },
  };
}

function mergeReviewDraft(
  kind: ReviewKind,
  deterministicDraft: ReviewDraft,
  semanticData: ReviewSemanticPatch | null | undefined,
): ReviewDraft {
  if (!semanticData || typeof semanticData !== "object") {
    return deterministicDraft;
  }

  const mergedInsights = {
    ...deterministicDraft.insights,
  };
  const semanticEntries = Object.entries(semanticData) as Array<
    [keyof ReviewSemanticPatch, ReviewSemanticPatch[keyof ReviewSemanticPatch]]
  >;
  for (const [key, value] of semanticEntries) {
    if (Array.isArray(value) && value.length) {
      (mergedInsights as Record<string, unknown>)[key] = value;
    }
  }

  const mergedDraft: ReviewDraft = {
    ...deterministicDraft,
    insights: mergedInsights,
    content: {
      ...deterministicDraft.content,
    },
  };

  if (kind === "nightly") {
    mergedDraft.content.progress = renderBulletList(mergedInsights.progress, "今天还没有收出可用的推进摘要。");
    mergedDraft.content.friction = renderBulletList(mergedInsights.friction, "今天还没有明显的摩擦摘要。");
    mergedDraft.content["open-loops"] = renderBulletList(mergedInsights.openLoops, "今晚没有明显还开着的线头。");
    mergedDraft.content["carry-forward"] = renderBulletList(mergedInsights.carryForward, "明天先从最小动作重新接上。");
    mergedDraft.content.closeout = renderBulletList(mergedInsights.closeout || [], "今天的睡前收口还没有写出来。");
    mergedDraft.content.signals = renderBulletList(mergedInsights.signals || [], "今天还没有稳定到值得带走的信号。");
    return mergedDraft;
  }

  mergedDraft.content.progress = renderBulletList(mergedInsights.progress, "这段时间还没有收出可用的推进摘要。");
  mergedDraft.content.friction = renderBulletList(mergedInsights.friction, "这段时间还没有明显的摩擦摘要。");
  mergedDraft.content["open-loops"] = renderBulletList(mergedInsights.openLoops, "这一周期末尾没有明显还开着的线头。");
  mergedDraft.content["carry-forward"] = renderBulletList(mergedInsights.carryForward, "下一次先从最小动作重新接上。");
  mergedDraft.content["daily-summaries"] = renderDatedGroups(mergedInsights.dailySummaries || [], "这段时间没有可引用的每日总结。");
  mergedDraft.content.supplements = renderSupplementGroups(mergedInsights.supplements || [], "这段时间没有值得回看的补充记录。");
  return mergedDraft;
}

function resolveReviewWindow(kind: ReviewKind, options: { week?: unknown; month?: unknown; date?: unknown; timezone?: unknown } = {}): ReviewWindow {
  const normalizedKind = normalizeText(kind).toLowerCase();
  if (normalizedKind === "nightly") {
    return resolveNightlyWindow(options);
  }
  if (normalizedKind === "weekly") {
    return resolveWeeklyWindow(options);
  }
  return resolveMonthlyWindow(options);
}

function resolveNightlyWindow(options: { date?: unknown; timezone?: unknown } = {}): ReviewWindow {
  const timezone = normalizeText(options.timezone) || LEGACY_TIMELINE_TIMEZONE;
  const baseDate = normalizeText(options.date)
    ? parseDateString(normalizeText(options.date))
    : parseDateString(getCurrentDateStringInTimezone(timezone));
  const label = formatUtcDate(baseDate);
  return {
    label,
    startDate: label,
    endDate: label,
    timezone,
  };
}

function resolveWeeklyWindow(options: { week?: unknown; date?: unknown; timezone?: unknown } = {}): ReviewWindow {
  const timezone = normalizeText(options.timezone) || LEGACY_TIMELINE_TIMEZONE;
  if (normalizeText(options.week)) {
    const match = /^(\d{4})-W(\d{2})$/u.exec(normalizeText(options.week));
    if (!match) {
      throw new Error(`--week 格式应为 YYYY-Www: ${options.week}`);
    }
    const year = Number.parseInt(match[1], 10);
    const week = Number.parseInt(match[2], 10);
    const weekOneStart = startOfIsoWeek(createUtcDate(year, 1, 4));
    const start = addDays(weekOneStart, (week - 1) * 7);
    const end = addDays(start, 6);
    return {
      label: `${year}-W${String(week).padStart(2, "0")}`,
      startDate: formatUtcDate(start),
      endDate: formatUtcDate(end),
      timezone,
    };
  }

  const baseDate = normalizeText(options.date)
    ? parseDateString(normalizeText(options.date))
    : parseDateString(getCurrentDateStringInTimezone(timezone));
  const start = startOfIsoWeek(baseDate);
  const end = addDays(start, 6);
  const week = isoWeekNumber(baseDate);
  return {
    label: `${baseDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    startDate: formatUtcDate(start),
    endDate: formatUtcDate(end),
    timezone,
  };
}

function resolveMonthlyWindow(options: { month?: unknown; date?: unknown; timezone?: unknown } = {}): ReviewWindow {
  let year = 0;
  let month = 0;
  if (normalizeText(options.month)) {
    const match = /^(\d{4})-(\d{2})$/u.exec(normalizeText(options.month));
    if (!match) {
      throw new Error(`--month 格式应为 YYYY-MM: ${options.month}`);
    }
    year = Number.parseInt(match[1], 10);
    month = Number.parseInt(match[2], 10);
  } else {
    const timezone = normalizeText(options.timezone) || LEGACY_TIMELINE_TIMEZONE;
    const baseDate = normalizeText(options.date)
      ? parseDateString(normalizeText(options.date))
      : parseDateString(getCurrentDateStringInTimezone(timezone));
    year = baseDate.getUTCFullYear();
    month = baseDate.getUTCMonth() + 1;
  }
  const start = createUtcDate(year, month, 1);
  const end = addDays(createUtcDate(year, month + 1, 1), -1);
  return {
    label: `${year}-${String(month).padStart(2, "0")}`,
    startDate: formatUtcDate(start),
    endDate: formatUtcDate(end),
    timezone: normalizeText(options.timezone) || LEGACY_TIMELINE_TIMEZONE,
  };
}

function selectProgressFromDiary(entry: DiaryReviewEntry | null): string[] {
  if (!entry) {
    return [];
  }
  const progressFromSummary = entry.summary.filter(
    (line) => !looksLikeCarryForward(line) && !hasFrictionSignal(line),
  );
  return progressFromSummary.length ? progressFromSummary : entry.timeline;
}

function selectFrictionFromDiary(entry: DiaryReviewEntry | null): string[] {
  if (!entry) {
    return [];
  }
  return [
    ...entry.fragment.filter(hasFrictionSignal),
    ...selectFrictionFromSupplements(entry.supplement),
    ...entry.summary.filter(hasFrictionSignal),
  ];
}

function selectPeriodicProgress(entry: DiaryReviewEntry, nightlyEntry: NightlyReviewEntry | null | undefined): string[] {
  if (nightlyEntry?.progress?.length) {
    return nightlyEntry.progress;
  }
  return selectProgressFromDiary(entry);
}

function selectPeriodicFriction(entry: DiaryReviewEntry, nightlyEntry: NightlyReviewEntry | null | undefined): string[] {
  if (nightlyEntry?.friction?.length) {
    return nightlyEntry.friction;
  }
  return selectFrictionFromDiary(entry);
}

function selectPeriodicCloseout(entry: DiaryReviewEntry, nightlyEntry: NightlyReviewEntry | null | undefined): string[] {
  if (nightlyEntry?.closeout?.length) {
    return nightlyEntry.closeout;
  }
  if (entry.summary.length) {
    return entry.summary;
  }
  return selectProgressFromDiary(entry);
}

function selectPeriodicSupplementGroups(
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

function selectFrictionFromSupplements(items: DiarySupplementEntry[]): string[] {
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

function selectSignalFromSupplements(items: DiarySupplementEntry[]): string[] {
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

function renderBulletList(items: string[], fallbackText: string): string {
  const lines = items.length
    ? items.map((item) => `- ${normalizeLineItem(item)}`)
    : [`- ${fallbackText}`];
  return lines.join("\n");
}

function renderDatedGroups(groups: ReviewDatedLines[], fallbackText: string): string {
  if (!groups.length) {
    return `- ${fallbackText}`;
  }
  const parts: string[] = [];
  for (const group of groups) {
    parts.push(`### ${group.date}`);
    for (const line of group.lines) {
      parts.push(`- ${normalizeLineItem(line)}`);
    }
  }
  return parts.join("\n");
}

function renderSupplementGroups(items: ReviewSupplementGroup[], fallbackText: string): string {
  if (!items.length) {
    return `- ${fallbackText}`;
  }
  const parts: string[] = [];
  for (const item of items) {
    const heading = item.title
      ? `### ${item.date} ${item.title}`
      : `### ${item.date}`;
    parts.push(heading);
    parts.push(item.body || "-");
  }
  return parts.join("\n\n");
}

function hasFrictionSignal(value: unknown): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return /(偏重|头痛|忘|烦|卡|累|耗|断开|岔开|拖|收不住|重复发送|截断|低电量|羞耻|分心)/u.test(normalized);
}

function looksLikeCarryForward(value: unknown): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return /^(明天|下周|下个月|后面|下一步|后续)/u.test(normalized);
}

function dedupeStatements(items: unknown[]): string[] {
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

function truncateSentence(value: unknown, maxLength: number): string {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/[，。；,;:\s]+$/u, "")}…`;
}

function toCompactSentence(value: unknown): string {
  return normalizeBody(value).replace(/\s*\n+\s*/gu, " ").replace(/\s{2,}/gu, " ").trim();
}

function createUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, offset: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + offset);
  return next;
}

function parseDateString(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    throw new Error(`日期格式应为 YYYY-MM-DD: ${value}`);
  }
  return createUtcDate(
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10),
  );
}

function startOfIsoWeek(date: Date): Date {
  const day = date.getUTCDay() || 7;
  return addDays(date, 1 - day);
}

function isoWeekNumber(date: Date): number {
  const thursday = addDays(startOfIsoWeek(date), 3);
  const firstThursday = addDays(startOfIsoWeek(createUtcDate(thursday.getUTCFullYear(), 1, 4)), 3);
  return Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000) + 1;
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeBody(value: unknown): string {
  return normalizeLineEnding(value).trim();
}

function normalizeLineItem(value: unknown): string {
  return normalizeBody(value).replace(/\s*\n+\s*/gu, " ").replace(/\s{2,}/gu, " ").trim();
}

function normalizeLineEnding(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n");
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  buildReviewDraft,
  mergeReviewDraft,
  resolveReviewWindow,
};
