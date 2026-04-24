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
import { collectProjectRadars } from "../workspace/project-radar";
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
  workspaceBootstrapConfigFile?: string;
  workspaceRoot?: unknown;
}

interface CompanionNoteSnapshot {
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

interface ProjectRadarSnapshot {
  available: boolean;
  branch: string;
  dirty: boolean;
  matchedProject: string;
  notePath: string;
  readFirst: WorkspaceContinuityFile[];
  recentCommit: string;
  reason: string;
}

interface CheckinSnapshot {
  activeWakeStartedAt: string;
  lastCompletionAt: string;
  lastCompletionResult: string;
  nextWakeAt: string;
  pendingHandoff: PendingHandoffSnapshot;
  pendingTriggerCreatedAt: string;
  scheduleSource: string;
  stateFound: boolean;
}

interface PendingHandoffSnapshot {
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

interface OnboardingSnapshot {
  missingSlots: string[];
  status: string;
  updatedAt: string;
}

interface CompanionMemorySnapshot {
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

interface ContextBoardFreshness {
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

function buildObservationSection(observation: ProactiveObservation | null): string {
  if (!observation) {
    return "";
  }
  const lines = [
    `模型：${observation.model.model || "(unknown)"} / ${observation.model.host}`,
    `置信度：${observation.confidence.toFixed(2)} | 打扰风险：${observation.surfaceRisk} | 烦扰风险：${observation.annoyanceRisk} | 能量：${observation.userEnergy}`,
    observation.currentStateHypothesis ? `状态假设：${observation.currentStateHypothesis}` : "",
    observation.reentryCandidate ? `重入候选：${observation.reentryCandidate}` : "",
    observation.likelyBlocker ? `可能卡点：${observation.likelyBlocker}` : "",
    observation.suggestedTone ? `建议语气：${observation.suggestedTone}` : "",
    observation.memoryCandidates.length
      ? `记忆候选：${observation.memoryCandidates.slice(0, 3).map((item) => `${item.slotId}:${item.text}`).join("；")}`
      : "",
    observation.evidence.length ? `证据：${observation.evidence.slice(0, 3).join("；")}` : "",
  ].filter(Boolean);
  return renderBulletBlock(lines, "");
}

function buildCurrentStatusSection({
  checkin,
  companionNote,
  stale,
  staleReasons,
}: {
  checkin: CheckinSnapshot;
  companionNote: CompanionNoteSnapshot;
  stale: boolean;
  staleReasons: string[];
}): string {
  const lines: string[] = [];
  if (stale) {
    lines.push(
      `[⚠️ 需确认] 当前判断上下文偏薄：${staleReasons.map((reason) => formatStaleReason(reason)).join("；")}。`
    );
  }
  if (companionNote.currentLines.length) {
    lines.push(...companionNote.currentLines.slice(0, 3));
  }
  if (checkin.lastCompletionAt) {
    lines.push(
      `最近一次主动收尾：${checkin.lastCompletionAt}${checkin.lastCompletionResult ? `（${checkin.lastCompletionResult}）` : ""}`
    );
  }
  if (checkin.nextWakeAt) {
    lines.push(`下次计划唤醒：${checkin.nextWakeAt}${checkin.scheduleSource ? `（${checkin.scheduleSource}）` : ""}`);
  }
  if (checkin.pendingHandoff.exists) {
    lines.push(
      `待主会话收尾的 proactive handoff：${checkin.pendingHandoff.handoffCreatedAt || "unknown"}`
      + `${checkin.pendingHandoff.outcome ? `（${checkin.pendingHandoff.outcome}）` : ""}`
    );
    if (checkin.pendingHandoff.triggerId) {
      lines.push(`待吸收的 lease：${checkin.pendingHandoff.triggerId}`);
    }
    if (checkin.pendingHandoff.observedCurrentState) {
      lines.push(`子 agent 当前观察：${checkin.pendingHandoff.observedCurrentState}`);
    }
    if (checkin.pendingHandoff.userVisibleMessage) {
      lines.push(`子 agent 对外消息：${checkin.pendingHandoff.userVisibleMessage}`);
    }
    lines.push("主会话默认应先吸收这份 handoff，再决定 continuity 写入与真正的下一次唤醒，并在收尾时执行 host finalize-checkin。");
  }
  if (checkin.activeWakeStartedAt) {
    lines.push(`当前有进行中的 active wake：${checkin.activeWakeStartedAt}`);
  } else if (checkin.pendingTriggerCreatedAt) {
    lines.push(`当前已有待处理 trigger：${checkin.pendingTriggerCreatedAt}`);
  }
  return renderParagraphBlock(lines, "[⚠️ 需确认] 缺少最近的状态 handoff。");
}

function buildTodayFactsSection(
  todayDiaryEntry: ReturnType<typeof collectDiaryEntries>[number] | null,
  todayDate: string,
): string {
  if (!todayDiaryEntry) {
    return `- [⚠️ 需确认] ${todayDate} 的 diary 还不存在，今天事实只能依赖其它薄上下文。`;
  }

  const lines = [
    ...todayDiaryEntry.timeline.slice(0, 4),
    ...(todayDiaryEntry.todo.done.length
      ? [`已完成 Todo：${todayDiaryEntry.todo.done.slice(0, 3).join("；")}`]
      : []),
    ...(todayDiaryEntry.todo.open.length
      ? [`仍挂着 Todo：${todayDiaryEntry.todo.open.slice(0, 3).join("；")}`]
      : []),
    ...todayDiaryEntry.supplement
      .slice(-3)
      .map((entry) => [entry.time, entry.title || entry.body].filter(Boolean).join(" ").trim())
      .filter(Boolean),
  ].filter(Boolean);

  return renderBulletBlock(lines, `[⚠️ 需确认] ${todayDate} diary 已存在，但还没有可用的结构化事实。`);
}

function buildActiveThreadsSection({
  companionNote,
  projectRadar,
}: {
  companionNote: CompanionNoteSnapshot;
  projectRadar: ProjectRadarSnapshot;
}): string {
  const lines = [
    ...companionNote.threadLines.slice(0, 5),
    ...(projectRadar.available
      ? [
        `workspace repo：${projectRadar.matchedProject || "(workspace)"} | branch ${projectRadar.branch || "(unknown)"} | dirty ${projectRadar.dirty ? "yes" : "no"}`,
        ...(projectRadar.recentCommit ? [`最近 commit：${projectRadar.recentCommit}`] : []),
      ]
      : []),
  ].filter(Boolean);

  return renderBulletBlock(lines, "[⚠️ 需确认] 还没有足够清楚的当前项目线索。");
}

function buildCautionsSection(companionNote: CompanionNoteSnapshot, followupContext: string): string {
  const lines = [
    ...(followupContext ? [`待带进下一次主动判断的内部后续：${followupContext}`] : []),
    ...companionNote.cautionLines.slice(0, 5),
  ].filter(Boolean);
  return renderBulletBlock(lines, "[⚠️ 需确认] 还没有明确的注意事项或内部 follow-up。");
}

function buildReentrySection({
  companionNote,
  projectRadar,
  workspaceBootstrap,
}: {
  companionNote: CompanionNoteSnapshot;
  projectRadar: ProjectRadarSnapshot;
  workspaceBootstrap: ContextBoardBriefing["workspaceBootstrap"];
}): string {
  const bootstrapLines = [
    ...workspaceBootstrap.primaryFiles,
    ...workspaceBootstrap.recentFiles,
  ]
    .slice(0, 6)
    .map((file) => `${file.absolutePath} - ${file.role}`);
  const lines = [
    ...bootstrapLines,
    ...companionNote.reentryLines.slice(0, 3),
    ...projectRadar.readFirst.slice(0, 4).map((file) => `${file.absolutePath} - ${file.role}`),
  ].filter(Boolean);
  return renderBulletBlock(lines, "[⚠️ 需确认] 暂时没有稳定的重入入口文件。");
}

function buildSourceStatusSection({
  checkin,
  companionNote,
  freshness,
  companionMemory,
  onboarding,
  projectRadar,
  staleReasons,
  todayDate,
  todayDiaryEntry,
  updatedAt,
  workspaceBootstrap,
}: {
  checkin: CheckinSnapshot;
  companionNote: CompanionNoteSnapshot;
  companionMemory: CompanionMemorySnapshot;
  freshness: ContextBoardFreshness;
  onboarding: OnboardingSnapshot;
  projectRadar: ProjectRadarSnapshot;
  staleReasons: string[];
  todayDate: string;
  todayDiaryEntry: { filePath?: string } | null;
  updatedAt: string;
  workspaceBootstrap: ContextBoardBriefing["workspaceBootstrap"];
}): string {
  const lines = [
    `board 更新时间：${updatedAt}`,
    `today diary：${freshness.diaryCurrent ? "present" : "missing"}${normalizeText(todayDiaryEntry?.filePath) ? ` | ${normalizeText(todayDiaryEntry?.filePath)}` : ` | ${todayDate}`}`,
    `companion note：${companionNote.exists ? "present" : "missing"}${companionNote.updatedAt ? ` | updated ${companionNote.updatedAt}` : ""}`,
    `companion memory：${companionMemory.lastUpdatedAt ? `${companionMemory.lastUpdatedAt}` : "missing"}${companionMemory.lastSource ? ` | source ${companionMemory.lastSource}` : ""}${companionMemory.recentWriteCount ? ` | recent writes ${companionMemory.recentWriteCount}` : ""}`,
    `onboarding：${onboarding.status}${onboarding.updatedAt ? ` | updated ${onboarding.updatedAt}` : ""}${onboarding.missingSlots.length ? ` | missing ${onboarding.missingSlots.join(", ")}` : ""}`,
    `checkin completion：${checkin.lastCompletionAt ? checkin.lastCompletionAt : "missing"}`,
    `pending proactive handoff：${checkin.pendingHandoff.exists ? `${checkin.pendingHandoff.handoffCreatedAt || "present"}${checkin.pendingHandoff.handoffExpiresAt ? ` -> ${checkin.pendingHandoff.handoffExpiresAt}` : ""}${checkin.pendingHandoff.triggerId ? ` | lease ${checkin.pendingHandoff.triggerId}` : ""}` : "missing"}`,
    `project radar：${projectRadar.available ? "available" : `unavailable${projectRadar.reason ? ` (${projectRadar.reason})` : ""}`}`,
    `workspace bootstrap files：${workspaceBootstrap.primaryFiles.length + workspaceBootstrap.recentFiles.length}`,
    ...(staleReasons.length ? [`stale reasons：${staleReasons.map((reason) => formatStaleReason(reason)).join("；")}`] : []),
  ];
  return renderBulletBlock(lines, "[⚠️ 需确认] 还没有可用的上下文来源状态。");
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

function collectCurrentProjectRadar(
  config: Pick<ContextBoardConfig, "projectRadarConfigFile" | "workspaceRoot">,
  workspaceRoot: string,
): ProjectRadarSnapshot {
  try {
    const result = collectProjectRadars(config, {});
    const normalizedWorkspaceRoot = normalizeDisplayPath(workspaceRoot);
    const matched = result.projects.find((project) => (
      normalizeDisplayPath(project.repoRoot) === normalizedWorkspaceRoot
    )) || (result.projects.length === 1 ? result.projects[0] : null);
    if (!matched) {
      const candidates = rankTrackedProjectCandidates(result.projects).slice(0, 3);
      if (candidates.length) {
        return buildTrackedProjectCandidatesSnapshot(candidates);
      }
      return {
        available: false,
        branch: "",
        dirty: false,
        matchedProject: "",
        notePath: "",
        readFirst: [],
        recentCommit: "",
        reason: "workspace_not_tracked",
      };
    }
    return {
      available: matched.git.ok,
      branch: normalizeText(matched.git.branch),
      dirty: Boolean(matched.git.dirty),
      matchedProject: normalizeText(matched.slug),
      notePath: normalizeText(matched.notePath),
      readFirst: matched.readFirst
        .filter(Boolean)
        .map((file) => ({
          absolutePath: normalizeText(file?.path),
          role: normalizeText(file?.kind) || "workspace note",
          when: "",
        }))
        .filter((file) => file.absolutePath),
      recentCommit: matched.git.recentCommits[0]
        ? `${normalizeText(matched.git.recentCommits[0].shortHash)} ${normalizeText(matched.git.recentCommits[0].subject)}`
        : "",
      reason: matched.git.ok ? "" : normalizeText(matched.git.reason) || normalizeText(matched.git.message),
    };
  } catch (error) {
    return {
      available: false,
      branch: "",
      dirty: false,
      matchedProject: "",
      notePath: "",
      readFirst: [],
      recentCommit: "",
      reason: error instanceof Error ? error.message : String(error || "unknown error"),
    };
  }
}

type CollectedProjectRadar = ReturnType<typeof collectProjectRadars>["projects"][number];

function buildTrackedProjectCandidatesSnapshot(projects: CollectedProjectRadar[]): ProjectRadarSnapshot {
  const best = projects[0];
  const firstRecentCommit = projects
    .map((project) => project.git.recentCommits[0])
    .find(Boolean);
  const readFirst = uniqueWorkspaceContinuityFiles(
    projects.flatMap((project) => project.readFirst)
      .filter(Boolean)
      .map((file) => ({
        absolutePath: normalizeText(file?.path),
        role: `${normalizeText(file?.kind) || "workspace note"} (${normalizeText(
          projects.find((project) => project.readFirst.includes(file))?.slug
        ) || "tracked project"})`,
        when: "",
      }))
  );
  const unavailableReasons = projects
    .filter((project) => !project.git.ok)
    .map((project) => `${project.slug}:${normalizeText(project.git.reason) || normalizeText(project.git.message)}`)
    .filter(Boolean);
  return {
    available: projects.some((project) => project.git.ok),
    branch: normalizeText(best?.git.branch),
    dirty: projects.some((project) => Boolean(project.git.dirty)),
    matchedProject: `tracked project candidates: ${projects.map((project) => project.slug).join(", ")}`,
    notePath: normalizeText(best?.notePath),
    readFirst,
    recentCommit: firstRecentCommit
      ? `${normalizeText(firstRecentCommit.shortHash)} ${normalizeText(firstRecentCommit.subject)}`
      : "",
    reason: projects.some((project) => project.git.ok)
      ? ""
      : unavailableReasons.join("; ") || "tracked_project_candidates_unavailable",
  };
}

function rankTrackedProjectCandidates(projects: CollectedProjectRadar[]): CollectedProjectRadar[] {
  return [...projects].sort((left, right) => {
    const leftScore = scoreTrackedProjectCandidate(left);
    const rightScore = scoreTrackedProjectCandidate(right);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return normalizeText(left.slug).localeCompare(normalizeText(right.slug));
  });
}

function scoreTrackedProjectCandidate(project: CollectedProjectRadar): number {
  return (project.git.ok ? 100 : 0)
    + (project.git.dirty ? 50 : 0)
    + (project.git.recentCommits.length ? 10 : 0)
    + (project.readFirst.length ? 1 : 0);
}

function uniqueWorkspaceContinuityFiles(files: WorkspaceContinuityFile[]): WorkspaceContinuityFile[] {
  const seen = new Set<string>();
  const unique: WorkspaceContinuityFile[] = [];
  for (const file of files) {
    const absolutePath = normalizeText(file.absolutePath);
    if (!absolutePath || seen.has(absolutePath)) {
      continue;
    }
    seen.add(absolutePath);
    unique.push({
      absolutePath,
      role: normalizeText(file.role),
      when: normalizeText(file.when),
    });
  }
  return unique.slice(0, 6);
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

function renderBriefingText({
  locale,
  mode,
  sections,
  stateCard,
}: {
  locale: CodekseiLocale;
  mode: ContextBriefingMode;
  sections: {
    activeThreads: string;
    cautions: string;
    currentStatus: string;
    observation?: string;
    reentryPoints: string;
    sourceStatus: string;
    todayFacts: string;
  };
  stateCard: ProactiveStateCard;
}): string {
  const prelude = locale === "en"
    ? buildEnglishBriefingPrelude(mode)
    : mode === "review"
    ? [
      "Codeksei context board (review framing)",
      "这是一份用于复盘 framing 和重入判断的轻量 handoff；真正的日记/复盘产物仍以 codeksei review 命令输出为准。",
      "若看到 [⚠️ 需确认]，说明这块上下文偏薄或偏旧，不能当作确定事实。",
    ]
    : [
      "Codeksei context board (proactive)",
      "这是一份给主动判断使用的轻量 handoff；优先依据这里的事实决定是否沉默、发一句话，或只做 backstage work。",
      "若看到 [⚠️ 需确认]，说明这块上下文偏薄或偏旧，不能当作确定事实。",
    ];
  return [
    ...prelude,
    "",
    `## ${getContextBoardSectionTitle("current-status", locale)}`,
    sections.currentStatus,
    "",
    `## ${locale === "en" ? "Companion State Card" : "伴随状态卡"}`,
    renderStateCardSection(stateCard, locale),
    ...(normalizeText(sections.observation)
      ? [
        "",
        `## ${getContextBoardSectionTitle("model-observation", locale)}`,
        sections.observation,
      ]
      : []),
    "",
    `## ${getContextBoardSectionTitle("today-facts", locale)}`,
    sections.todayFacts,
    "",
    `## ${getContextBoardSectionTitle("active-threads", locale)}`,
    sections.activeThreads,
    "",
    `## ${getContextBoardSectionTitle("cautions", locale)}`,
    sections.cautions,
    "",
    `## ${getContextBoardSectionTitle("reentry-points", locale)}`,
    sections.reentryPoints,
    "",
    `## ${getContextBoardSectionTitle("source-status", locale)}`,
    sections.sourceStatus,
  ].join("\n").trim();
}

function renderStateCardSection(stateCard: ProactiveStateCard, locale: CodekseiLocale): string {
  if (locale === "en") {
    return [
      `- Current likely state: ${stateCard.currentLikelyState || "[⚠️ Needs confirmation] Unknown"}`,
      `- Active thread: ${stateCard.activeThread || "[⚠️ Needs confirmation] Unknown"}`,
      `- Likely blocker: ${stateCard.likelyBlocker || "[⚠️ Needs confirmation] Unknown"}`,
      `- Easiest re-entry step: ${stateCard.easiestReentryStep || "[⚠️ Needs confirmation] Unknown"}`,
      `- Avoid this time: ${stateCard.doNotDo.join("; ") || "Do not nag"}`,
      `- Tone: ${stateCard.toneHint}`,
      `- Context thickness: ${stateCard.sourceThickness}`,
    ].join("\n");
  }
  return [
    `- 现在大概在哪：${stateCard.currentLikelyState || "[⚠️ 需确认] 不确定"}`,
    `- 活跃线头：${stateCard.activeThread || "[⚠️ 需确认] 不确定"}`,
    `- 最可能卡点：${stateCard.likelyBlocker || "[⚠️ 需确认] 不确定"}`,
    `- 最容易接回的一步：${stateCard.easiestReentryStep || "[⚠️ 需确认] 不确定"}`,
    `- 这次别做：${stateCard.doNotDo.join("；") || "不要催债"}`,
    `- 适合语气：${stateCard.toneHint}`,
    `- 上下文厚度：${stateCard.sourceThickness}`,
  ].join("\n");
}

function buildEnglishBriefingPrelude(mode: ContextBriefingMode): string[] {
  return mode === "review"
    ? [
      "Codeksei context board (review framing)",
      "This is a lightweight handoff for review framing and re-entry judgement; the canonical diary/review outputs still come from Codeksei review commands.",
      "Treat any [⚠️ Needs confirmation] block as thin or stale context, not as confirmed fact.",
    ]
    : [
      "Codeksei context board (proactive)",
      "This is a lightweight handoff for proactive judgement; use it to decide whether to stay silent, send one concise message, or do backstage work only.",
      "Treat any [⚠️ Needs confirmation] block as thin or stale context, not as confirmed fact.",
    ];
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

function renderParagraphBlock(lines: string[], fallback: string): string {
  return lines.filter(Boolean).join("\n\n").trim() || fallback;
}

function renderBulletBlock(lines: string[], fallback: string): string {
  const normalized = lines
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .slice(0, 8);
  if (!normalized.length) {
    return `- ${fallback}`;
  }
  return normalized.map((line) => `- ${line}`).join("\n");
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

function formatStaleReason(reason: string): string {
  switch (reason) {
    case "missing_today_diary":
      return "今天 diary 缺失";
    case "stale_companion_and_checkin_handoff":
      return "最近的 companion note / checkin completion 都不够新";
    default:
      return reason;
  }
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
