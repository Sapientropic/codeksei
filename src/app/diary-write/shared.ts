import {
  LEGACY_TIMELINE_TIMEZONE,
  formatDateInTimezone,
  formatDateTimeInTimezone,
  formatTimeInTimezone,
} from "../../core/timezone";

export const DEFAULT_SECTION = "supplement" as const;
export const SECTION_HEADINGS = Object.freeze({
  todo: "Todo",
  timeline: "时间线事实",
  fragment: "今日碎片",
  supplement: "补充记录",
  summary: "总结",
});
export const TODO_STATE_MARKERS = Object.freeze({
  open: " ",
  done: "x",
});
export const TODO_LINE_RE = /^- \[( |x|X)\] (.*)$/u;
export const TODO_START_MARKER_RE = /\s*<!--\s*codeksei-todo:start=(\d{2}:\d{2})\s*-->\s*$/u;

export type DiarySection = keyof typeof SECTION_HEADINGS;
export type TodoState = keyof typeof TODO_STATE_MARKERS;
export type DiaryEntryTodoState = TodoState | "";
export type TodoTimelineResolutionMode = "explicit" | "none" | "range_from_todo" | "point_in_time";

export function normalizeSection(value: unknown): DiarySection {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case "":
    case "supplement":
      return "supplement";
    case "todo":
      return "todo";
    case "timeline":
      return "timeline";
    case "fragment":
      return "fragment";
    case "summary":
      return "summary";
    default:
      throw new Error(`不支持的日记 section: ${value}`);
  }
}

export function normalizeTodoState(value: unknown, section: unknown = DEFAULT_SECTION): TodoState {
  const normalizedSection = normalizeSection(section);
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedSection !== "todo") {
    if (normalizedValue) {
      throw new Error("--state 只支持和 --section todo 一起使用");
    }
    return "open";
  }
  if (!normalizedValue) {
    return "open";
  }
  if (normalizedValue === "open" || normalizedValue === "done") {
    return normalizedValue;
  }
  throw new Error(`不支持的 Todo state: ${value}`);
}

export function normalizeBody(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

export function normalizeLineItem(value: unknown): string {
  return normalizeBody(value).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function normalizeTodoClock(value: unknown): string {
  const normalized = normalizeLineItem(value);
  return /^\d{2}:\d{2}$/u.test(normalized) ? normalized : "";
}

export function normalizeFileEnding(content: unknown): string {
  return String(content || "").replace(/\r\n/g, "\n");
}

export function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSectionLineText({ title, body }: { title?: unknown; body?: unknown }): string {
  const normalizedTitle = normalizeLineItem(title);
  const normalizedBody = normalizeLineItem(body);
  if (normalizedTitle && normalizedBody) {
    return `${normalizedTitle}: ${normalizedBody}`;
  }
  return normalizedTitle || normalizedBody;
}

export function stripTodoMetadata(value: unknown): string {
  return String(value || "").replace(TODO_START_MARKER_RE, "").trim();
}

export function formatDate(date: unknown, timezone: unknown = LEGACY_TIMELINE_TIMEZONE): string {
  return formatDateInTimezone(date, timezone);
}

export function formatTime(date: unknown, timezone: unknown = LEGACY_TIMELINE_TIMEZONE): string {
  return formatTimeInTimezone(date, timezone);
}

export function formatDateTime(date: unknown, timezone: unknown = LEGACY_TIMELINE_TIMEZONE): string {
  return formatDateTimeInTimezone(date, timezone);
}
