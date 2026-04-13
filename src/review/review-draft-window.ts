import {
  LEGACY_TIMELINE_TIMEZONE,
  getCurrentDateStringInTimezone,
} from "../core/timezone";
import type { ReviewKind, ReviewWindow } from "./review-types";
import { normalizeText } from "./review-draft-heuristics";

export function resolveReviewWindow(
  kind: ReviewKind,
  options: { week?: unknown; month?: unknown; date?: unknown; timezone?: unknown } = {},
): ReviewWindow {
  const normalizedKind = normalizeText(kind).toLowerCase();
  if (normalizedKind === "nightly") {
    return resolveNightlyWindow(options);
  }
  if (normalizedKind === "weekly") {
    return resolveWeeklyWindow(options);
  }
  return resolveMonthlyWindow(options);
}

export function resolveNightlyWindow(options: { date?: unknown; timezone?: unknown } = {}): ReviewWindow {
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

export function resolveWeeklyWindow(options: { week?: unknown; date?: unknown; timezone?: unknown } = {}): ReviewWindow {
  const timezone = normalizeText(options.timezone) || LEGACY_TIMELINE_TIMEZONE;
  if (normalizeText(options.week)) {
    const match = /^(\d{4})-W(\d{2})$/u.exec(normalizeText(options.week));
    if (!match) {
      throw new Error(`--week 格式应为 YYYY-Www: ${options.week}`);
    }
    const year = Number.parseInt(match[1] || "", 10);
    const week = Number.parseInt(match[2] || "", 10);
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

export function resolveMonthlyWindow(options: { month?: unknown; date?: unknown; timezone?: unknown } = {}): ReviewWindow {
  let year = 0;
  let month = 0;
  if (normalizeText(options.month)) {
    const match = /^(\d{4})-(\d{2})$/u.exec(normalizeText(options.month));
    if (!match) {
      throw new Error(`--month 格式应为 YYYY-MM: ${options.month}`);
    }
    year = Number.parseInt(match[1] || "", 10);
    month = Number.parseInt(match[2] || "", 10);
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
    Number.parseInt(match[1] || "", 10),
    Number.parseInt(match[2] || "", 10),
    Number.parseInt(match[3] || "", 10),
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
