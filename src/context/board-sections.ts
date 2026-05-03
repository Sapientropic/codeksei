import type { ProactiveObservation, ProactiveStateCard } from "../proactive/contracts";
import { normalizeText } from "../core/text-normalization";
import type { CodekseiLocale } from "../core/locale";
import { collectDiaryEntries } from "../review/review-sources";
import type {
  CheckinSnapshot,
  CompanionMemorySnapshot,
  CompanionNoteSnapshot,
  ContextBoardBriefing,
  ContextBoardFreshness,
  ContextBriefingMode,
  OnboardingSnapshot,
  ProjectRadarSnapshot,
  WhereaboutsContextSnapshot,
} from "./board";

export function buildObservationSection(observation: ProactiveObservation | null): string {
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

export function buildCurrentStatusSection({
  checkin,
  companionNote,
  stale,
  staleReasons,
  whereabouts,
}: {
  checkin: CheckinSnapshot;
  companionNote: CompanionNoteSnapshot;
  stale: boolean;
  staleReasons: string[];
  whereabouts: WhereaboutsContextSnapshot;
}): string {
  const lines: string[] = [];
  if (stale) {
    lines.push(
      `[⚠️ 需确认] 当前判断上下文偏薄：${staleReasons.map((reason) => formatStaleReason(reason)).join("；")}。`
    );
  }
  if (whereabouts.statusLine) {
    lines.push(whereabouts.statusLine);
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

export function buildTodayFactsSection(
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

export function buildActiveThreadsSection({
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

export function buildCautionsSection(companionNote: CompanionNoteSnapshot, followupContext: string): string {
  const lines = [
    ...(followupContext ? [`待带进下一次主动判断的内部后续：${followupContext}`] : []),
    ...companionNote.cautionLines.slice(0, 5),
  ].filter(Boolean);
  return renderBulletBlock(lines, "[⚠️ 需确认] 还没有明确的注意事项或内部 follow-up。");
}

export function buildReentrySection({
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

export function buildSourceStatusSection({
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
  whereabouts,
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
  whereabouts: WhereaboutsContextSnapshot;
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
    `whereabouts：${whereabouts.reason || "missing"}`,
    `workspace bootstrap files：${workspaceBootstrap.primaryFiles.length + workspaceBootstrap.recentFiles.length}`,
    ...(staleReasons.length ? [`stale reasons：${staleReasons.map((reason) => formatStaleReason(reason)).join("；")}`] : []),
  ];
  return renderBulletBlock(lines, "[⚠️ 需确认] 还没有可用的上下文来源状态。");
}

export function renderBriefingText({
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

export function renderStateCardSection(stateCard: ProactiveStateCard, locale: CodekseiLocale): string {
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

export function renderParagraphBlock(lines: string[], fallback: string): string {
  return lines.filter(Boolean).join("\n\n").trim() || fallback;
}

export function renderBulletBlock(lines: string[], fallback: string): string {
  const normalized = lines
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .slice(0, 8);
  if (!normalized.length) {
    return `- ${fallback}`;
  }
  return normalized.map((line) => `- ${line}`).join("\n");
}

export function formatStaleReason(reason: string): string {
  switch (reason) {
    case "missing_today_diary":
      return "今天 diary 缺失";
    case "stale_companion_and_checkin_handoff":
      return "最近的 companion note / checkin completion 都不够新";
    default:
      return reason;
  }
}

function getContextBoardSectionTitle(slot: string, locale: CodekseiLocale): string {
  const sectionTitles: Record<string, Record<CodekseiLocale, string>> = {
    "current-status": { "zh-CN": "当前状态", en: "Current Status" },
    "model-observation": { "zh-CN": "小模型观察", en: "Model Observation" },
    "today-facts": { "zh-CN": "今天事实", en: "Today Facts" },
    "active-threads": { "zh-CN": "活跃线头", en: "Active Threads" },
    cautions: { "zh-CN": "注意事项", en: "Cautions" },
    "reentry-points": { "zh-CN": "重入入口", en: "Re-entry Points" },
    "source-status": { "zh-CN": "上下文来源", en: "Context Sources" },
  };
  return sectionTitles[slot]?.[locale] || slot;
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
