import * as fs from "node:fs";
import * as path from "node:path";

import type { AppRuntimeConfig } from "../../../../core/app-service-contract";
import { formatDateInTimezone, formatTimeInTimezone, normalizeTimezone } from "../../../../core/timezone";
import { normalizeText } from "../../../../contracts/text-normalization";
import { resolveTimelineRuntimeConfig } from "../../../../timeline/runtime-config";
import { createTimelineStore } from "../../../../timeline/runtime/application/timeline/shared";
import type { TimelineCategory, TimelineEvent, TimelineState } from "../../../../timeline/runtime/contracts";
import { ReminderQueueStore } from "../../../../state/reminder-queue-store";
import { CheckinScheduleStateStore } from "../../../../state/checkin-schedule-state-store";
import { collectProjectRadars } from "../../../../workspace/project-radar";
import { extractSectionLines, findSectionRange } from "../../../../app/diary-write/document";
import { SECTION_HEADINGS, normalizeLineItem } from "../../../../app/diary-write/shared";
import type {
  FrameCheckin,
  FrameDiaryFragment,
  FrameProjectLine,
  FrameReminder,
  FrameState,
  FrameTimelineSlot,
} from "../../contracts";

type FrameStateConfig = Partial<Pick<
  AppRuntimeConfig,
  | "checkinScheduleStateFile"
  | "diaryDir"
  | "projectRadarConfigFile"
  | "reminderQueueFile"
  | "stateDir"
  | "timelineStateDir"
  | "timezone"
  | "workspaceRoot"
>> & {
  timelineLocale?: unknown;
};

const FALLBACK_TIMELINE_COLORS: Record<string, string> = {
  entertainment: "#CE5D97",
  exercise: "#879A39",
  health: "#3AA99F",
  life: "#DA702C",
  rest: "#8B7EC8",
  study: "#D0A215",
  work: "#4385BE",
};

function buildFrameState(config: FrameStateConfig = {}, now = new Date()): FrameState {
  const warnings: string[] = [];
  const timezone = normalizeTimezone(config.timezone) || "Asia/Shanghai";
  const nowIso = now.toISOString();
  const today = formatDateInTimezone(now, timezone);
  const timeline = readTimelineSlots(config, today, timezone, now, warnings);
  const diary = readDiaryFragments(config, today, warnings);
  const reminders = readReminders(config, now, timezone, warnings);
  const projects = readProjectLines(config, warnings);
  const checkIn = readCheckinState(config, timezone, warnings);
  return {
    now: nowIso,
    timezone,
    timeline: { slots: timeline },
    diary,
    reminders,
    projects,
    checkIn,
    character: {
      greeting: buildGreeting(now, timezone),
    },
    actionAvailability: buildActionAvailability(),
    freshness: {
      updatedAt: nowIso,
      stale: warnings.length > 0,
      warnings,
    },
  };
}

function buildActionAvailability(): FrameState["actionAvailability"] {
  return {
    checkinActions: {
      available: false,
      endpoint: "/frame/checkin/action",
      reason: "not wired: endpoint is present but currently returns 501",
    },
    reminderActions: {
      available: false,
      endpoint: "/frame/reminder/action",
      reason: "not wired: endpoint is present but currently returns 501",
    },
  };
}

function readTimelineSlots(
  config: FrameStateConfig,
  today: string,
  timezone: string,
  now: Date,
  warnings: string[],
): FrameTimelineSlot[] {
  try {
    const timelineConfig = resolveTimelineRuntimeConfig(config);
    const state = createTimelineStore(timelineConfig).getState();
    const day = state.facts?.[today];
    if (!day || !Array.isArray(day.events) || !day.events.length) {
      return [];
    }
    const categories = buildCategoryLookup(state);
    return day.events
      .slice()
      .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))
      .map((event) => mapTimelineEvent(event, categories, timezone, now));
  } catch (error) {
    warnings.push(`timeline_unavailable: ${formatError(error)}`);
    return [];
  }
}

function buildCategoryLookup(state: TimelineState): Map<string, { categoryId: string; color: string }> {
  const lookup = new Map<string, { categoryId: string; color: string }>();
  for (const category of Array.isArray(state.taxonomy?.categories) ? state.taxonomy.categories : []) {
    addCategoryLookup(lookup, category);
  }
  return lookup;
}

function addCategoryLookup(lookup: Map<string, { categoryId: string; color: string }>, category: TimelineCategory): void {
  const color = normalizeText(category.color) || FALLBACK_TIMELINE_COLORS[category.id] || "#4385BE";
  lookup.set(category.id, { categoryId: category.id, color });
  for (const child of Array.isArray(category.children) ? category.children : []) {
    lookup.set(child.id, { categoryId: category.id, color });
  }
}

function mapTimelineEvent(
  event: TimelineEvent,
  categories: Map<string, { categoryId: string; color: string }>,
  timezone: string,
  now: Date,
): FrameTimelineSlot {
  const category = categories.get(event.subcategoryId) || categories.get(event.categoryId);
  const startMs = Date.parse(event.startAt);
  const endMs = Date.parse(event.endAt);
  const nowMs = now.getTime();
  const state = nowMs >= startMs && nowMs <= endMs
    ? "current"
    : (nowMs < startMs ? "future" : "confirmed");
  return {
    id: normalizeText(event.id) || `${event.startAt}:${event.title}`,
    start: formatTimeInTimezone(new Date(startMs), timezone),
    end: formatTimeInTimezone(new Date(endMs), timezone),
    title: normalizeText(event.title) || "未命名时间块",
    category: category?.categoryId || normalizeText(event.categoryId) || "life",
    color: category?.color || FALLBACK_TIMELINE_COLORS[event.categoryId] || "#4385BE",
    state,
  };
}

function readDiaryFragments(config: FrameStateConfig, today: string, warnings: string[]): FrameState["diary"] {
  const diaryDir = normalizeText(config.diaryDir);
  if (!diaryDir) {
    warnings.push("diary_dir_missing");
    return { fragments: [], todaySummary: "" };
  }
  const filePath = path.join(diaryDir, `${today}.md`);
  if (!fs.existsSync(filePath)) {
    return { fragments: [], todaySummary: "" };
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return {
      fragments: extractDiaryFragments(content).slice(0, 5),
      todaySummary: extractDiarySummary(content),
    };
  } catch (error) {
    warnings.push(`diary_unavailable: ${formatError(error)}`);
    return { fragments: [], todaySummary: "" };
  }
}

function extractDiaryFragments(content: string): FrameDiaryFragment[] {
  const normalizedContent = String(content || "").replace(/\r\n/g, "\n");
  const fragmentRange = findSectionRange(normalizedContent, SECTION_HEADINGS.fragment);
  const lines = fragmentRange
    ? extractSectionLines(normalizedContent.slice(fragmentRange.contentStart, fragmentRange.end), "fragment")
    : extractLegacyDiaryFragmentLines(normalizedContent);

  return lines
    .map((line, index) => parseDiaryFragmentLine(line, index))
    .filter((fragment): fragment is FrameDiaryFragment => Boolean(fragment))
    .reverse();
}

function extractLegacyDiaryFragmentLines(content: string): string[] {
  const lines: string[] = [];
  let inFrontmatter = false;
  for (const rawLine of content.split("\n")) {
    const trimmed = normalizeLineItem(rawLine);
    if (!trimmed) {
      continue;
    }
    if (trimmed === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) {
      continue;
    }
    if (/^#{1,6}\s*(总结|summary)\s*$/iu.test(trimmed)) {
      break;
    }
    if (trimmed.startsWith("#")) {
      continue;
    }
    lines.push(trimmed);
  }
  return lines;
}

function parseDiaryFragmentLine(line: string, index: number): FrameDiaryFragment | null {
  const normalized = normalizeText(line.replace(/^[-*]\s*/u, ""));
  if (!normalized || normalized.startsWith("#") || normalized.startsWith("---")) {
    return null;
  }
  const timeMatch = normalized.match(/^(\d{1,2}:\d{2})\s+(.+)$/u);
  return {
    id: `diary-${index + 1}`,
    time: timeMatch?.[1] || "",
    text: timeMatch?.[2] || normalized,
  };
}

function extractDiarySummary(content: string): string {
  const lines = content.split(/\r?\n/u).map((line) => normalizeText(line)).filter(Boolean);
  const summaryIndex = lines.findIndex((line) => /^#{1,6}\s*(总结|summary)/iu.test(line));
  if (summaryIndex < 0) {
    return "";
  }
  return normalizeText(lines.slice(summaryIndex + 1).find((line) => !line.startsWith("#")) || "");
}

function readReminders(
  config: FrameStateConfig,
  now: Date,
  timezone: string,
  warnings: string[],
): FrameReminder[] {
  const reminderQueueFile = normalizeText(config.reminderQueueFile);
  if (!reminderQueueFile) {
    warnings.push("reminder_queue_missing");
    return [];
  }
  try {
    const queue = new ReminderQueueStore({ filePath: reminderQueueFile });
    return queue.state.reminders.slice(0, 3).map((reminder, index) => ({
      id: reminder.id,
      text: reminder.text,
      due: formatReminderDue(reminder.dueAtMs, now, timezone),
      priority: index === 0 ? "primary" : "minor",
    }));
  } catch (error) {
    warnings.push(`reminders_unavailable: ${formatError(error)}`);
    return [];
  }
}

function formatReminderDue(dueAtMs: number, now: Date, timezone: string): string {
  const due = new Date(dueAtMs);
  const dueDate = formatDateInTimezone(due, timezone);
  const today = formatDateInTimezone(now, timezone);
  return dueDate === today ? formatTimeInTimezone(due, timezone) : dueDate;
}

function readProjectLines(config: FrameStateConfig, warnings: string[]): FrameProjectLine[] {
  if (!normalizeText(config.projectRadarConfigFile)) {
    warnings.push("project_radar_config_missing");
    return [];
  }
  try {
    const radar = collectProjectRadars(config, { changes: 5, commits: 3 });
    return radar.projects.slice(0, 3).map((project: Record<string, unknown>) => {
      const git = isRecord(project.git) ? project.git : {};
      const recentCommits = Array.isArray(git.recentCommits) ? git.recentCommits : [];
      const statusEntries = Array.isArray(git.statusEntries) ? git.statusEntries : [];
      const firstCommit = isRecord(recentCommits[0]) ? recentCommits[0] : {};
      const firstChange = isRecord(statusEntries[0]) ? statusEntries[0] : {};
      return {
        id: normalizeText(project.slug) || normalizeText(project.title) || "project",
        name: normalizeText(project.title) || normalizeText(project.slug) || "项目",
        stopped: normalizeText(firstCommit.subject) || normalizeText(git.message) || "暂无最近提交",
        next: statusEntries.length ? `处理 ${statusEntries.length} 个工作区变更` : "回看最近上下文",
        action: normalizeText(firstChange.path) || "打开项目笔记",
      };
    });
  } catch (error) {
    warnings.push(`project_radar_unavailable: ${formatError(error)}`);
    return [];
  }
}

function readCheckinState(config: FrameStateConfig, timezone: string, warnings: string[]): FrameCheckin {
  const checkinScheduleStateFile = normalizeText(config.checkinScheduleStateFile);
  if (!checkinScheduleStateFile) {
    warnings.push("checkin_state_missing");
    return { status: "scheduled" };
  }
  try {
    const state = new CheckinScheduleStateStore({ filePath: checkinScheduleStateFile }).getState();
    if (!state) {
      return { status: "scheduled" };
    }
    if (state.activeWake) {
      return { status: "in_progress", triggerId: state.activeWake.triggerId };
    }
    if (state.pendingTrigger) {
      return {
        status: "due",
        triggerId: state.pendingTrigger.triggerId,
        scheduledAt: formatTimeInTimezone(new Date(Date.parse(state.pendingTrigger.dueAt)), timezone),
      };
    }
    if (state.nextWakeAt) {
      return {
        status: "scheduled",
        scheduledAt: formatTimeInTimezone(new Date(Date.parse(state.nextWakeAt)), timezone),
      };
    }
    return { status: "scheduled" };
  } catch (error) {
    warnings.push(`checkin_unavailable: ${formatError(error)}`);
    return { status: "scheduled" };
  }
}

function buildGreeting(now: Date, timezone: string): string {
  const hourText = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(now);
  const hour = Number.parseInt(hourText, 10);
  if (hour >= 5 && hour < 9) {
    return "早上好，新的一天";
  }
  if (hour >= 9 && hour < 12) {
    return "上午好，状态不错";
  }
  if (hour >= 12 && hour < 14) {
    return "中午好，记得休息";
  }
  if (hour >= 14 && hour < 18) {
    return "下午好，今天过得很稳";
  }
  if (hour >= 18 && hour < 22) {
    return "晚上好，放慢节奏";
  }
  return "深夜了，早些休息";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

export { buildFrameState };
