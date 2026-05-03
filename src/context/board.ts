import * as fs from "node:fs";
import * as path from "node:path";

import type { AppRuntimeConfig } from "../core/app-service-contract";
import { PRIMARY_NOTE_SYNC_MARKER_PREFIX } from "../core/branding";
import { logWarn } from "../core/logging";
import {
  formatDateTimeInTimezone,
  getCurrentDateStringInTimezone,
} from "../core/timezone";
import { normalizeText } from "../core/text-normalization";
import {
  buildCheckinTargetKey,
  resolveCheckinTarget,
  type CheckinResolvedTarget,
} from "../checkin";
import { writeForeignTextDocument } from "../state/json-state";
import { CheckinScheduleStateStore } from "../state/checkin-schedule-state-store";
import { inspectDurableNoteRouting } from "../notes/durable-note-schema";
import { findSectionRange, syncNoteContent } from "../notes/note-sync";
import { collectDiaryEntries } from "../review/review-sources";
import {
  collectWorkspaceContinuitySnapshot,
  type WorkspaceContinuityFile,
} from "../workspace/workspace-bootstrap";
import { normalizeDisplayPath } from "../core/path-utils";
import { createCompanionMemoryRuntimeStateStore } from "../companion-memory/runtime-state";
import { createOnboardingStateStore } from "../onboarding/state";
import { createSessionStore } from "../session/session-store-factory";
import { buildProactiveStateCard } from "../proactive/state-card";
import type { ProactiveObservation, ProactiveStateCard } from "../proactive/contracts";
import { resolveCodekseiLocale, type CodekseiLocale } from "../core/locale";
import type { WhereaboutsSummary } from "../whereabouts/contracts";
import {
  buildActiveThreadsSection,
  buildCautionsSection,
  buildCurrentStatusSection,
  buildObservationSection,
  buildReentrySection,
  buildSourceStatusSection,
  buildTodayFactsSection,
  renderBriefingText,
} from "./board-sections";
import { collectCurrentProjectRadar } from "./board-project-radar";
import { collectWhereaboutsContextSnapshot } from "./board-whereabouts";

export type ContextBriefingMode = "proactive" | "review";

export interface ContextBoardConfig {
  accountId?: string;
  allowedUserIds?: unknown;
  checkinScheduleStateFile?: string;
  diaryDir?: string;
  durableNoteSchemaConfigFile?: string;
  locale?: unknown;
  projectRadarConfigFile?: string;
  sessionsFile?: string;
  stateDir?: string;
  timezone?: unknown;
  userGender?: unknown;
  userLanguage?: unknown;
  whereaboutsHost?: unknown;
  whereaboutsPlacesFile?: unknown;
  whereaboutsPort?: unknown;
  whereaboutsRetentionDays?: unknown;
  whereaboutsToken?: unknown;
  workspaceBootstrapConfigFile?: string;
  workspaceRoot?: unknown;
}

export interface CompanionNoteSnapshot {
  cautionLines: string[];
  currentLines: string[];
  exists: boolean;
  filePath: string;
  hasCurrentContext: boolean;
  lineCount: number;
  reentryLines: string[];
  sections: string[];
  threadLines: string[];
  updatedAt: string;
}

export interface ProjectRadarSnapshot {
  available: boolean;
  branch: string;
  dirty: boolean;
  matchedProject: string;
  notePath: string;
  readFirst: WorkspaceContinuityFile[];
  recentCommit: string;
  reason: string;
}

export interface CheckinSnapshot {
  activeWakeStartedAt: string;
  lastCompletionAt: string;
  lastCompletionResult: string;
  nextWakeAt: string;
  pendingHandoff: PendingHandoffSnapshot;
  pendingTriggerCreatedAt: string;
  scheduleSource: string;
  stateFound: boolean;
}

export interface PendingHandoffSnapshot {
  bookkeepingActions: string[];
  exists: boolean;
  followupContext: string;
  handoffCreatedAt: string;
  handoffExpiresAt: string;
  observedCurrentState: string;
  outcome: string;
  triggerId: string;
  userVisibleMessage: string;
}

export interface OnboardingSnapshot {
  missingSlots: string[];
  status: string;
  updatedAt: string;
}

export interface CompanionMemorySnapshot {
  lastSource: string;
  lastUpdatedAt: string;
  recentWriteCount: number;
  slotFreshness: Record<string, string>;
}

interface ContextBoardState {
  followupContext: string;
}

interface ContextBoardSectionData {
  slot: string;
  text: string;
  title: string;
}

export interface ContextBoardFreshness {
  checkinRecent: boolean;
  companionRecent: boolean;
  diaryCurrent: boolean;
}

interface ContextBoardRenderedSections {
  activeThreads: string;
  cautions: string;
  currentStatus: string;
  observation: string;
  reentryPoints: string;
  sourceStatus: string;
  todayFacts: string;
}

export interface WhereaboutsContextSnapshot {
  available: boolean;
  reason: string;
  statusLine: string;
  summary: WhereaboutsSummary | null;
}

export interface ContextBoardBriefing {
  boardPath: string;
  boardText: string;
  briefingText: string;
  checkin: CheckinSnapshot;
  companionNote: CompanionNoteSnapshot;
  followupContext: string;
  freshness: ContextBoardFreshness;
  locale: CodekseiLocale;
  mode: ContextBriefingMode;
  observation: ProactiveObservation | null;
  onboarding: OnboardingSnapshot;
  companionMemory: CompanionMemorySnapshot;
  projectRadar: ProjectRadarSnapshot;
  whereabouts: WhereaboutsContextSnapshot;
  stale: boolean;
  staleReasons: string[];
  sections: ContextBoardRenderedSections;
  stateCard: ProactiveStateCard;
  target: {
    senderId: string;
    targetKey: string;
    workspaceRoot: string;
  };
  todayDiary: {
    date: string;
    doneTodoCount: number;
    exists: boolean;
    filePath: string;
    openTodoCount: number;
    supplementCount: number;
    timelineCount: number;
  };
  updatedAt: string;
  workspaceBootstrap: {
    conditionalFiles: WorkspaceContinuityFile[];
    primaryFiles: WorkspaceContinuityFile[];
    recentFiles: WorkspaceContinuityFile[];
  };
}

interface RefreshContextBoardOptions {
  clearFollowupContext?: boolean;
  followupContext?: string;
  mode?: ContextBriefingMode;
  now?: Date;
  observation?: ProactiveObservation | null;
}

interface BestEffortRefreshOptions extends RefreshContextBoardOptions {
  user?: string;
  workspace?: string;
}

const CONTEXT_BOARD_SECTIONS = Object.freeze([
  { slot: "current-status", title: { "zh-CN": "当前状态", en: "Current Status" } },
  { slot: "model-observation", title: { "zh-CN": "小模型观察", en: "Model Observation" } },
  { slot: "today-facts", title: { "zh-CN": "今天事实", en: "Today Facts" } },
  { slot: "active-threads", title: { "zh-CN": "活跃线头", en: "Active Threads" } },
  { slot: "cautions", title: { "zh-CN": "注意事项", en: "Cautions" } },
  { slot: "reentry-points", title: { "zh-CN": "重入入口", en: "Re-entry Points" } },
  { slot: "source-status", title: { "zh-CN": "上下文来源", en: "Context Sources" } },
] as const satisfies Array<{ slot: string; title: Record<CodekseiLocale, string> }>);

const COMPANION_CURRENT_SECTION_RE = /(当前状态|当前定位|当前焦点|协作节奏)/u;
const COMPANION_THREAD_SECTION_RE = /(最近动作|当前实验|下一步|最近灵感|当前焦点|当前定位)/u;
const COMPANION_CAUTION_SECTION_RE = /(支持偏好|能力边界|注意事项|决策与约束)/u;
const COMPANION_REENTRY_SECTION_RE = /(下一步|重入|进入|当前实验|最近动作)/u;
const COMPANION_RECENT_WINDOW_MS = 72 * 60 * 60_000;
const CHECKIN_RECENT_WINDOW_MS = 24 * 60 * 60_000;

export function refreshContextBoard(
  config: ContextBoardConfig,
  target: CheckinResolvedTarget,
  options: RefreshContextBoardOptions = {},
): ContextBoardBriefing {
  const briefing = buildContextBoardBriefing(config, target, options);
  ensureContextBoardFile(briefing.boardPath, briefing.target, briefing.locale);

  let content = fs.readFileSync(briefing.boardPath, "utf8");
  for (const section of buildManagedSections(briefing)) {
    content = syncNoteContent(content, {
      filePath: briefing.boardPath,
      section: section.title,
      slot: section.slot,
      style: "paragraph",
      text: section.text,
    }).content;
  }
  writeForeignTextDocument(briefing.boardPath, ensureTrailingNewline(content), { encoding: "utf8" });
  return {
    ...briefing,
    boardText: ensureTrailingNewline(fs.readFileSync(briefing.boardPath, "utf8")),
  };
}

export function buildContextBoardBriefing(
  config: ContextBoardConfig,
  target: CheckinResolvedTarget,
  {
    clearFollowupContext = false,
    followupContext = "",
    mode = "proactive",
    now = new Date(),
    observation = null,
  }: RefreshContextBoardOptions = {},
): ContextBoardBriefing {
  const updatedAt = now.toISOString();
  const locale = resolveCodekseiLocale(config.locale, config.userLanguage);
  const targetKey = buildCheckinTargetKey(target);
  const boardPath = resolveContextBoardPath(config, target);
  const storedState = readStoredContextBoardState(boardPath);
  const effectiveFollowupContext = clearFollowupContext
    ? ""
    : normalizeText(followupContext) || storedState.followupContext;
  const todayDate = getCurrentDateStringInTimezone(normalizeTimezone(config.timezone), now);
  const todayDiaryEntry = collectDiaryEntries(
    normalizeText(config.diaryDir),
    todayDate,
    todayDate,
  )[0] || null;
  const companionNote = collectCompanionNoteSnapshot(config, target.senderId);
  const checkin = collectCheckinSnapshot(config, target);
  const onboarding = collectOnboardingSnapshot(config, target.senderId);
  const companionMemory = collectCompanionMemorySnapshot(config, target.senderId);
  const projectRadar = collectCurrentProjectRadar(config, target.workspaceRoot);
  const whereabouts = collectWhereaboutsContextSnapshot(config, updatedAt);
  const workspaceBootstrap = collectWorkspaceContinuitySnapshot(target.workspaceRoot, {
    workspaceBootstrapConfigFile: config.workspaceBootstrapConfigFile,
  });
  const freshness = resolveFreshness({
    checkin,
    companionNote,
    now,
    todayDiaryExists: Boolean(todayDiaryEntry),
  });
  const staleReasons = collectStaleReasons(freshness);
  const stale = staleReasons.length > 0;
  const sections = {
    cautions: buildCautionsSection(companionNote, effectiveFollowupContext),
    currentStatus: buildCurrentStatusSection({
      checkin,
      companionNote,
      stale,
      staleReasons,
      whereabouts,
    }),
    reentryPoints: buildReentrySection({
      companionNote,
      projectRadar,
      workspaceBootstrap,
    }),
    sourceStatus: buildSourceStatusSection({
      checkin,
      companionMemory,
      companionNote,
      freshness,
      onboarding,
      projectRadar,
      staleReasons,
      todayDate,
      todayDiaryEntry,
      updatedAt,
      whereabouts,
      workspaceBootstrap,
    }),
    activeThreads: buildActiveThreadsSection({
      companionNote,
      projectRadar,
    }),
    observation: buildObservationSection(observation),
    todayFacts: buildTodayFactsSection(todayDiaryEntry, todayDate),
  };
  const stateCard = buildProactiveStateCard({
    sections,
    stale,
    staleReasons,
  });

  return {
    boardPath,
    boardText: "",
    briefingText: renderBriefingText({
      locale,
      mode,
      sections,
      stateCard,
    }),
    checkin,
    companionNote,
    followupContext: effectiveFollowupContext,
    freshness,
    locale,
    mode,
    observation,
    onboarding,
    companionMemory,
    projectRadar,
    whereabouts,
    sections,
    stale,
    staleReasons,
    stateCard,
    target: {
      senderId: target.senderId,
      targetKey,
      workspaceRoot: target.workspaceRoot,
    },
    todayDiary: {
      date: todayDate,
      doneTodoCount: todayDiaryEntry?.todo.done.length || 0,
      exists: Boolean(todayDiaryEntry),
      filePath: normalizeText(todayDiaryEntry?.filePath),
      openTodoCount: todayDiaryEntry?.todo.open.length || 0,
      supplementCount: todayDiaryEntry?.supplement.length || 0,
      timelineCount: todayDiaryEntry?.timeline.length || 0,
    },
    updatedAt,
    workspaceBootstrap,
  };
}

export function bestEffortRefreshContextBoard(
  config: ContextBoardConfig,
  options: BestEffortRefreshOptions = {},
): ContextBoardBriefing | null {
  try {
    const resolution = resolveCheckinTarget({
      accountId: normalizeText(config.accountId),
      config: config as Partial<Pick<AppRuntimeConfig, "allowedUserIds" | "workspaceRoot">>,
      explicitUser: normalizeText(options.user),
      explicitWorkspace: normalizeText(options.workspace),
      sessionStore: createSessionStore(config.sessionsFile),
    });
    if (!resolution.ok || !resolution.value) {
      return null;
    }
    return refreshContextBoard(config, resolution.value, options);
  } catch (error) {
    logWarn("[codeksei] context board refresh skipped:", error);
    return null;
  }
}

export function tryRefreshContextBoard(
  config: ContextBoardConfig,
  target: CheckinResolvedTarget,
  options: RefreshContextBoardOptions = {},
): ContextBoardBriefing | null {
  try {
    return refreshContextBoard(config, target, options);
  } catch (error) {
    logWarn("[codeksei] context board refresh skipped:", error);
    return null;
  }
}

export function resolveContextBoardPath(
  config: Pick<ContextBoardConfig, "stateDir">,
  target: Pick<CheckinResolvedTarget, "senderId" | "workspaceRoot">,
): string {
  const stateDir = normalizeText(config.stateDir);
  if (!stateDir) {
    throw new Error("缺少 stateDir，无法生成 context board");
  }
  const targetKey = buildCheckinTargetKey(target as CheckinResolvedTarget);
  return normalizeDisplayPath(path.join(stateDir, "context", "boards", `${sanitizeTargetKey(targetKey)}.md`));
}

function buildManagedSections(briefing: ContextBoardBriefing): ContextBoardSectionData[] {
  return [
    {
      slot: "current-status",
      text: briefing.sections.currentStatus,
      title: getContextBoardSectionTitle("current-status", briefing.locale),
    },
    {
      slot: "model-observation",
      text: briefing.sections.observation,
      title: getContextBoardSectionTitle("model-observation", briefing.locale),
    },
    {
      slot: "today-facts",
      text: briefing.sections.todayFacts,
      title: getContextBoardSectionTitle("today-facts", briefing.locale),
    },
    {
      slot: "active-threads",
      text: briefing.sections.activeThreads,
      title: getContextBoardSectionTitle("active-threads", briefing.locale),
    },
    {
      slot: "cautions",
      text: briefing.sections.cautions,
      title: getContextBoardSectionTitle("cautions", briefing.locale),
    },
    {
      slot: "reentry-points",
      text: briefing.sections.reentryPoints,
      title: getContextBoardSectionTitle("reentry-points", briefing.locale),
    },
    {
      slot: "source-status",
      text: briefing.sections.sourceStatus,
      title: getContextBoardSectionTitle("source-status", briefing.locale),
    },
  ].filter((section) => section.slot !== "model-observation" || normalizeText(section.text));
}

function getContextBoardSectionTitle(slot: string, locale: CodekseiLocale): string {
  const section = CONTEXT_BOARD_SECTIONS.find((entry) => entry.slot === slot);
  return section?.title[locale] || slot;
}

function collectCompanionNoteSnapshot(config: ContextBoardConfig, senderId: string): CompanionNoteSnapshot {
  try {
    const inspection = inspectDurableNoteRouting({
      ...config,
      allowedUserIds: [senderId],
      senderId,
    }, {
      scope: "companion",
    });
    if (!("filePath" in inspection) || !normalizeText(inspection.filePath) || !fs.existsSync(inspection.filePath)) {
      return emptyCompanionNoteSnapshot();
    }

    const filePath = normalizeText(inspection.filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const sectionTitles = "sections" in inspection && Array.isArray(inspection.sections)
      ? inspection.sections
      : [];
    const sections = Object.fromEntries(
      sectionTitles.map((title) => [title, normalizeSectionBody(readSectionBody(content, title))])
    );
    const currentLines = collectSectionGroupLines(sections, COMPANION_CURRENT_SECTION_RE);
    const threadLines = collectSectionGroupLines(sections, COMPANION_THREAD_SECTION_RE);
    const cautionLines = collectSectionGroupLines(sections, COMPANION_CAUTION_SECTION_RE);
    const reentryLines = collectSectionGroupLines(sections, COMPANION_REENTRY_SECTION_RE);
    const updatedAt = formatDateTimeInTimezone(fs.statSync(filePath).mtime, normalizeTimezone(config.timezone));
    const updatedAtMs = fs.statSync(filePath).mtimeMs;
    return {
      cautionLines,
      currentLines,
      exists: true,
      filePath,
      hasCurrentContext: currentLines.length > 0,
      lineCount: Object.values(sections).flat().length,
      reentryLines,
      sections: sectionTitles,
      threadLines,
      updatedAt: updatedAtMs > 0 ? updatedAt : "",
    };
  } catch {
    return emptyCompanionNoteSnapshot();
  }
}

function collectOnboardingSnapshot(config: ContextBoardConfig, senderId: string): OnboardingSnapshot {
  try {
    if (!normalizeText(config.stateDir)) {
      return {
        missingSlots: [],
        status: "not_started",
        updatedAt: "",
      };
    }
    const state = createOnboardingStateStore(config, senderId).getState();
    return {
      missingSlots: [...state.missingSlots],
      status: state.status,
      updatedAt: normalizeText(state.updatedAt),
    };
  } catch {
    return {
      missingSlots: [],
      status: "not_started",
      updatedAt: "",
    };
  }
}

function collectCompanionMemorySnapshot(config: ContextBoardConfig, senderId: string): CompanionMemorySnapshot {
  try {
    if (!normalizeText(config.stateDir)) {
      return emptyCompanionMemorySnapshot();
    }
    const state = createCompanionMemoryRuntimeStateStore(config, senderId).getState();
    return {
      lastSource: normalizeText(state.lastSource),
      lastUpdatedAt: normalizeText(state.lastUpdatedAt),
      recentWriteCount: state.recentWrites.length,
      slotFreshness: { ...state.slotFreshness },
    };
  } catch {
    return emptyCompanionMemorySnapshot();
  }
}

function collectCheckinSnapshot(
  config: Pick<ContextBoardConfig, "checkinScheduleStateFile" | "timezone">,
  target: CheckinResolvedTarget,
): CheckinSnapshot {
  const filePath = normalizeText(config.checkinScheduleStateFile);
  if (!filePath) {
    return emptyCheckinSnapshot();
  }
  const state = new CheckinScheduleStateStore({ filePath }).getState();
  if (!state || state.targetKey !== buildCheckinTargetKey(target)) {
    return emptyCheckinSnapshot();
  }
  return {
    activeWakeStartedAt: formatMaybeZonedDate(state.activeWake?.startedAt, config.timezone),
    lastCompletionAt: formatMaybeZonedDate(state.lastCompletion?.completedAt, config.timezone),
    lastCompletionResult: normalizeText(state.lastCompletion?.result),
    nextWakeAt: formatMaybeZonedDate(state.nextWakeAt, config.timezone),
    pendingHandoff: state.pendingHandoff
      ? {
        bookkeepingActions: state.pendingHandoff.bookkeepingActions
          .map((entry) => `${entry.kind}:${entry.status}:${entry.summary}`),
        exists: true,
        followupContext: normalizeText(state.pendingHandoff.followupContext),
        handoffCreatedAt: formatMaybeZonedDate(state.pendingHandoff.handoffCreatedAt, config.timezone),
        handoffExpiresAt: formatMaybeZonedDate(state.pendingHandoff.handoffExpiresAt, config.timezone),
        observedCurrentState: normalizeText(state.pendingHandoff.observedCurrentState),
        outcome: normalizeText(state.pendingHandoff.outcome),
        triggerId: normalizeText(state.pendingHandoff.triggerId),
        userVisibleMessage: normalizeText(state.pendingHandoff.userVisibleMessage),
      }
      : emptyPendingHandoffSnapshot(),
    pendingTriggerCreatedAt: formatMaybeZonedDate(state.pendingTrigger?.createdAt, config.timezone),
    scheduleSource: normalizeText(state.scheduleSource),
    stateFound: true,
  };
}

function resolveFreshness({
  checkin,
  companionNote,
  now,
  todayDiaryExists,
}: {
  checkin: CheckinSnapshot;
  companionNote: CompanionNoteSnapshot;
  now: Date;
  todayDiaryExists: boolean;
}): ContextBoardFreshness {
  const nowMs = now.getTime();
  const companionUpdatedMs = Date.parse(normalizeText(companionNote.updatedAt));
  const checkinCompletionMs = Date.parse(normalizeText(checkin.lastCompletionAt));
  return {
    checkinRecent: Number.isFinite(checkinCompletionMs) && checkinCompletionMs >= nowMs - CHECKIN_RECENT_WINDOW_MS,
    companionRecent: Number.isFinite(companionUpdatedMs) && companionUpdatedMs >= nowMs - COMPANION_RECENT_WINDOW_MS,
    diaryCurrent: todayDiaryExists,
  };
}

function collectStaleReasons(freshness: ContextBoardFreshness): string[] {
  const reasons: string[] = [];
  if (!freshness.diaryCurrent) {
    reasons.push("missing_today_diary");
  }
  // Companion note and checkin completion are complementary handoff surfaces:
  // if both are stale, proactive judgement falls back to thin repo facts only.
  if (!freshness.companionRecent && !freshness.checkinRecent) {
    reasons.push("stale_companion_and_checkin_handoff");
  }
  return reasons;
}

function ensureContextBoardFile(
  filePath: string,
  target: ContextBoardBriefing["target"],
  locale: CodekseiLocale,
): void {
  if (fs.existsSync(filePath)) {
    return;
  }
  const header = [
    "# Codeksei Context Board",
    "",
    locale === "en"
      ? "This board recomputes proactive context through managed slots. Put manual notes after the managed block inside a section."
      : "这份 board 用 managed slots 重算主动判断上下文；如需手工补充，请写在各 section 的 managed block 之后。",
    "",
    `- target: ${target.senderId}`,
    `- workspace: ${target.workspaceRoot}`,
    `- targetKey: ${target.targetKey}`,
    "",
    ...CONTEXT_BOARD_SECTIONS.flatMap((section) => [`## ${section.title[locale]}`, ""]),
  ].join("\n");
  writeForeignTextDocument(filePath, ensureTrailingNewline(header), { encoding: "utf8" });
}

function readStoredContextBoardState(filePath: string): ContextBoardState {
  if (!fs.existsSync(filePath)) {
    return { followupContext: "" };
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return {
      followupContext: extractManagedSlotText(content, "cautions")?.match(/待带进下一次主动判断的内部后续：(.*)$/mu)?.[1]?.trim() || "",
    };
  } catch {
    return { followupContext: "" };
  }
}

function extractManagedSlotText(content: string, slot: string): string {
  const escapedSlot = escapeRegExp(slot);
  const escapedPrefix = escapeRegExp(PRIMARY_NOTE_SYNC_MARKER_PREFIX);
  const pattern = new RegExp(
    `<!--\\s*${escapedPrefix}:${escapedSlot}:start\\s*-->\\n([\\s\\S]*?)\\n<!--\\s*${escapedPrefix}:${escapedSlot}:end\\s*-->`,
    "u",
  );
  return pattern.exec(content)?.[1]?.trim() || "";
}

function readSectionBody(content: string, sectionTitle: string): string {
  const range = findSectionRange(content, sectionTitle);
  if (!range) {
    return "";
  }
  return content.slice(range.contentStart, range.end).trim();
}

function normalizeSectionBody(body: string): string[] {
  return body
    .replace(/<!--[\s\S]*?-->/gu, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/u, "").trim())
    .filter(Boolean);
}

function collectSectionGroupLines(
  sections: Record<string, string[]>,
  matcher: RegExp,
): string[] {
  return Object.entries(sections)
    .filter(([title]) => matcher.test(title))
    .flatMap(([, lines]) => lines)
    .filter(Boolean);
}

function emptyCompanionNoteSnapshot(): CompanionNoteSnapshot {
  return {
    cautionLines: [],
    currentLines: [],
    exists: false,
    filePath: "",
    hasCurrentContext: false,
    lineCount: 0,
    reentryLines: [],
    sections: [],
    threadLines: [],
    updatedAt: "",
  };
}

function emptyCheckinSnapshot(): CheckinSnapshot {
  return {
    activeWakeStartedAt: "",
    lastCompletionAt: "",
    lastCompletionResult: "",
    nextWakeAt: "",
    pendingHandoff: emptyPendingHandoffSnapshot(),
    pendingTriggerCreatedAt: "",
    scheduleSource: "",
    stateFound: false,
  };
}

function emptyPendingHandoffSnapshot(): PendingHandoffSnapshot {
  return {
    bookkeepingActions: [],
    exists: false,
    followupContext: "",
    handoffCreatedAt: "",
    handoffExpiresAt: "",
    observedCurrentState: "",
    outcome: "",
    triggerId: "",
    userVisibleMessage: "",
  };
}

function emptyCompanionMemorySnapshot(): CompanionMemorySnapshot {
  return {
    lastSource: "",
    lastUpdatedAt: "",
    recentWriteCount: 0,
    slotFreshness: {},
  };
}

function formatMaybeZonedDate(value: unknown, timezone: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? formatDateTimeInTimezone(new Date(parsed), normalizeTimezone(timezone)) : normalized;
}

function normalizeTimezone(value: unknown): string {
  return normalizeText(value) || "Asia/Shanghai";
}

function sanitizeTargetKey(targetKey: string): string {
  return normalizeText(targetKey).replace(/[\\/:*?"<>|]+/gu, "_");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
