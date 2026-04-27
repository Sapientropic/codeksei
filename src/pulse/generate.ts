import * as crypto from "node:crypto";

import { buildContextInspectReport, type ContextInspectConfig } from "../context/inspect";
import { getCurrentDateStringInTimezone } from "../core/timezone";
import { normalizeText } from "../contracts/text-normalization";
import { collectDiaryEntries } from "../review/review-sources";
import {
  appendPulseFeedback,
  readPulseFeedback,
  readPulseRun,
  readPulseTasks,
  upsertPulseTask,
  writePulseRun,
  type PulseStateConfig,
} from "./store";
import { PULSE_FEEDBACK_KINDS } from "./contracts";
import type {
  PulseCard,
  PulseCardType,
  PulseFeedback,
  PulseFeedbackKind,
  PulseRun,
  PulseScoreBreakdown,
  PulseSourceRef,
  PulseTask,
} from "./contracts";

export interface PulseConfig extends ContextInspectConfig, PulseStateConfig {
  diaryDir?: string;
  timezone?: unknown;
}

export interface PulseGenerateOptions {
  date?: string;
  focus?: string;
  user?: string;
  workspace?: string;
}

export interface PulseFeedbackOptions {
  cardId: string;
  kind: string;
  text?: string;
  topic?: string;
}

interface PulseCandidate {
  date: string;
  detailsMarkdown: string;
  sourceRefs: PulseSourceRef[];
  suggestedPrompt: string;
  summary: string;
  title: string;
  topic: string;
  type: PulseCardType;
  why: string;
}

export function generatePulseRun(
  config: PulseConfig,
  options: PulseGenerateOptions = {},
): PulseRun {
  const date = normalizeText(options.date) || getCurrentDateStringInTimezone(normalizeText(config.timezone) || "Asia/Shanghai");
  const focus = normalizeText(options.focus);
  const inspectOptions: {
    mode: string;
    recordContextPackMatches: boolean;
    text: string;
    user?: string;
    workspace?: string;
  } = {
    mode: "proactive",
    recordContextPackMatches: true,
    text: focus,
  };
  const user = normalizeText(options.user);
  if (user) {
    inspectOptions.user = user;
  }
  const workspace = normalizeText(options.workspace);
  if (workspace) {
    inspectOptions.workspace = workspace;
  }
  const inspection = buildContextInspectReport(config, inspectOptions);
  const diaryEntry = collectDiaryEntries(normalizeText(config.diaryDir), date, date)[0] || null;
  const feedback = readPulseFeedback(config);
  const tasks = readPulseTasks(config).filter((task) => task.status === "open");
  const previousRuns = collectRecentPulseRuns(config, date);
  const candidates = buildPulseCandidates({
    date,
    diaryEntry,
    focus,
    inspection: inspection.report,
    tasks,
  });
  const cards = selectPulseCards(candidates, {
    date,
    feedback,
    focus,
    inspection: inspection.report,
    previousRuns,
    tasks,
  });
  const run: PulseRun = {
    cards,
    createdAt: new Date().toISOString(),
    date,
    focus,
    headline: "今天值得继续的 3 张卡片",
    kind: "pulse_run",
    version: 1,
  };
  writePulseRun(config, run);
  return run;
}

export function readOrGeneratePulseRun(
  config: PulseConfig,
  options: PulseGenerateOptions = {},
): PulseRun {
  const date = normalizeText(options.date) || getCurrentDateStringInTimezone(normalizeText(config.timezone) || "Asia/Shanghai");
  return readPulseRun(config, date) || generatePulseRun(config, { ...options, date });
}

export function recordPulseFeedback(
  config: PulseConfig,
  options: PulseFeedbackOptions,
): {
  feedback: PulseFeedback;
  tasks: PulseTask[];
} {
  const kind = normalizePulseFeedbackKind(options.kind);
  const cardId = normalizeText(options.cardId);
  if (!cardId) {
    throw new Error("缺少 --card <pulseCardId>。");
  }
  const feedback: PulseFeedback = {
    cardId,
    createdAt: new Date().toISOString(),
    kind,
    text: normalizeText(options.text),
    topic: normalizeText(options.topic) || normalizeText(options.text) || normalizeText(options.cardId),
  };
  appendPulseFeedback(config, feedback);
  const tasks = kind === "task"
    ? upsertPulseTask(config, {
      cardId: feedback.cardId,
      createdAt: feedback.createdAt,
      status: "open",
      text: feedback.text || feedback.topic,
      topic: feedback.topic,
    })
    : readPulseTasks(config);
  return { feedback, tasks };
}

function buildPulseCandidates({
  date,
  diaryEntry,
  focus,
  inspection,
  tasks,
}: {
  date: string;
  diaryEntry: ReturnType<typeof collectDiaryEntries>[number] | null;
  focus: string;
  inspection: ReturnType<typeof buildContextInspectReport>["report"];
  tasks: PulseTask[];
}): PulseCandidate[] {
  const candidates: PulseCandidate[] = [];
  if (focus) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: `今天的显式 focus 是：${focus}\n\n建议先把它收成一个可执行的 25 分钟推进块。`,
      sourceRefs: [{ id: "focus", kind: "user_focus", title: "Pulse focus" }],
      suggestedPrompt: `围绕「${focus}」给我一个最小下一步。`,
      summary: "把今天主动给出的重点变成可以马上继续的一步。",
      title: `继续：${focus}`,
      topic: focus,
      type: "focus",
      why: "你刚刚明确给了今天的关注焦点。",
    }));
  }
  for (const task of tasks.slice(-3)) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: task.text,
      sourceRefs: [{ id: task.cardId, kind: "pulse_task", title: task.topic }],
      suggestedPrompt: `继续推进这张 Pulse 任务：${task.text}`,
      summary: task.text,
      title: `接回 Pulse 任务：${task.topic}`,
      topic: task.topic,
      type: "task",
      why: "这张卡片之前被转成了未完成任务，应该跨天继续参与策展。",
    }));
  }
  if (inspection.pendingHandoff.exists) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: [
        inspection.pendingHandoff.observedCurrentState,
        inspection.pendingHandoff.followupContext,
        ...inspection.pendingHandoff.bookkeepingActions,
      ].filter(Boolean).join("\n"),
      sourceRefs: [{ id: inspection.pendingHandoff.triggerId || "pending-handoff", kind: "proactive_handoff", title: "Pending proactive handoff" }],
      suggestedPrompt: "先吸收 pending proactive handoff，再决定今天第一步。",
      summary: inspection.pendingHandoff.observedCurrentState || inspection.pendingHandoff.followupContext,
      title: "吸收待收尾的主动 handoff",
      topic: "proactive handoff",
      type: "handoff",
      why: "当前有子会话留下的 proactive handoff，主会话应先处理它。",
    }));
  }
  if (normalizeText(inspection.stateCard.easiestReentryStep) || normalizeText(inspection.stateCard.activeThread)) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: [
        inspection.stateCard.activeThread,
        inspection.stateCard.easiestReentryStep,
        inspection.stateCard.likelyBlocker,
      ].filter(Boolean).join("\n"),
      sourceRefs: [{ id: "state-card", kind: "context_board", title: "Companion state card" }],
      suggestedPrompt: "按当前 state card 给我一个不超过 10 分钟的重入动作。",
      summary: inspection.stateCard.easiestReentryStep || inspection.stateCard.activeThread,
      title: "从当前重入入口继续",
      topic: inspection.stateCard.activeThread || inspection.stateCard.easiestReentryStep,
      type: "project",
      why: "context board 已经有可用的项目线头或重入入口。",
    }));
  }
  if (diaryEntry) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: [
        ...diaryEntry.timeline.slice(0, 4),
        ...diaryEntry.todo.open.slice(0, 3).map((item) => `未完成：${item}`),
        ...diaryEntry.supplement.slice(-2).map((item) => `${item.time} ${item.title || item.body}`),
      ].join("\n"),
      sourceRefs: [{ id: date, kind: "diary", title: "Today diary" }],
      suggestedPrompt: "根据今天已经发生的事实，帮我选一件最值得继续的小事。",
      summary: "今天已有 diary/timeline 事实，可以从真实发生的内容继续。",
      title: "从今天已经留下的事实继续",
      topic: "today facts",
      type: "today",
      why: "今天的 diary 已经有结构化事实，适合变成可继续推进的卡片。",
    }));
  }
  candidates.push(createCandidate({
    date,
    detailsMarkdown: "先看 capabilities status，确认哪些能力只是配置存在，哪些在当前 host/session 里真的可用。",
    sourceRefs: [{ id: "capabilities.status", kind: "capability", title: "Capability Governance" }],
    suggestedPrompt: "检查当前 Codeksei 能力状态，并解释最值得修的 blocked 能力。",
    summary: "把工具和宿主能力从“开关列表”升级成可解释的当前可用状态。",
    title: "检查当前能力治理状态",
    topic: "capability governance",
    type: "capability",
    why: "这能防止把“配置启用”误判成“当前会话可用”。",
  }));
  if (inspection.staleReasons.length) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: inspection.staleReasons.map((reason) => `- ${reason}`).join("\n"),
      sourceRefs: [{ id: "context.inspect", kind: "context_inspector", title: "Context Inspector" }],
      suggestedPrompt: "帮我补齐当前 context board 里最薄的一块来源。",
      summary: "[⚠️ 需确认] 当前上下文偏薄，先补来源比继续推进更稳。",
      title: "补齐偏薄的上下文来源",
      topic: "context thin",
      type: "context",
      why: "context inspect 标记了 stale reasons，继续前应先确认事实。",
    }));
  }
  return candidates;
}

function createCandidate(candidate: PulseCandidate): PulseCandidate {
  return candidate;
}

function selectPulseCards(
  candidates: PulseCandidate[],
  context: {
    date: string;
    feedback: PulseFeedback[];
    focus: string;
    inspection: ReturnType<typeof buildContextInspectReport>["report"];
    previousRuns: PulseRun[];
    tasks: PulseTask[];
  },
): PulseCard[] {
  const seenTopics = new Set<string>();
  const scored = candidates
    .map((candidate) => scorePulseCandidate(candidate, context))
    .filter((card) => card.score > 0 && card.scoreBreakdown.negativeFeedback > -6)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
  const selected: PulseCard[] = [];
  for (const card of scored) {
    const topicKey = normalizeTopicKey(card.topic || card.title);
    if (!topicKey || seenTopics.has(topicKey)) {
      continue;
    }
    seenTopics.add(topicKey);
    selected.push(card);
    if (selected.length >= 3) {
      break;
    }
  }
  return selected;
}

function scorePulseCandidate(
  candidate: PulseCandidate,
  context: {
    date: string;
    feedback: PulseFeedback[];
    focus: string;
    inspection: ReturnType<typeof buildContextInspectReport>["report"];
    previousRuns: PulseRun[];
    tasks: PulseTask[];
  },
): PulseCard {
  const text = `${candidate.title}\n${candidate.why}\n${candidate.summary}\n${candidate.detailsMarkdown}`;
  const breakdown: PulseScoreBreakdown = {
    contextThin: context.inspection.staleReasons.length ? -2 : 0,
    focus: matchesTopic(text, context.focus) ? 4 : 0,
    negativeFeedback: resolveNegativeFeedbackScore(text, context.feedback),
    pendingHandoff: candidate.type === "handoff" || context.inspection.pendingHandoff.exists && matchesTopic(text, "handoff") ? 3 : 0,
    positiveFeedback: resolvePositiveFeedbackScore(text, context.feedback),
    projectReentry: candidate.type === "project" ? 3 : 0,
    repeatedRecent: wasRecentlyShown(candidate, context.previousRuns) ? -2 : 0,
    todayFacts: candidate.type === "today" ? 2 : 0,
    unfinishedTask: candidate.type === "task" || context.tasks.some((task) => matchesTopic(text, task.topic)) ? 3 : 0,
  };
  const score = Object.values(breakdown).reduce((total, value) => total + value, 0);
  return {
    ...candidate,
    id: buildPulseCardId(context.date, candidate),
    score,
    scoreBreakdown: breakdown,
    status: "active",
  };
}

function resolveNegativeFeedbackScore(text: string, feedback: PulseFeedback[]): number {
  return feedback.some((entry) => (
    (entry.kind === "dislike" || entry.kind === "hide")
    && (matchesTopic(text, entry.topic) || matchesTopic(text, entry.text))
  )) ? -6 : 0;
}

function resolvePositiveFeedbackScore(text: string, feedback: PulseFeedback[]): number {
  if (feedback.some((entry) => (
    entry.kind === "save"
    && (matchesTopic(text, entry.topic) || matchesTopic(text, entry.text))
  ))) {
    return 3;
  }
  return feedback.some((entry) => (
    entry.kind === "like"
    && (matchesTopic(text, entry.topic) || matchesTopic(text, entry.text))
  )) ? 2 : 0;
}

function wasRecentlyShown(candidate: PulseCandidate, runs: PulseRun[]): boolean {
  return runs.some((run) => run.cards.some((card) => normalizeTopicKey(card.topic) === normalizeTopicKey(candidate.topic)));
}

function collectRecentPulseRuns(config: PulseConfig, date: string): PulseRun[] {
  const candidates = [-1, -2, -3]
    .map((offset) => offsetDate(date, offset))
    .map((candidateDate) => readPulseRun(config, candidateDate))
    .filter((run): run is PulseRun => Boolean(run));
  return candidates;
}

function offsetDate(date: string, offsetDays: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(base.getTime())) {
    return date;
  }
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

function buildPulseCardId(date: string, candidate: PulseCandidate): string {
  const hash = crypto.createHash("sha1")
    .update([date, candidate.type, candidate.topic, candidate.title].join("\n"))
    .digest("hex")
    .slice(0, 12);
  return `pulse:${date}:${candidate.type}:${hash}`;
}

function matchesTopic(text: string, topic: string): boolean {
  const normalizedText = normalizeTopicKey(text);
  const normalizedTopic = normalizeTopicKey(topic);
  if (!normalizedText || !normalizedTopic) {
    return false;
  }
  return normalizedTopic
    .split(/\s+/u)
    .filter((token) => token.length >= 2)
    .some((token) => normalizedText.includes(token));
}

function normalizeTopicKey(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function normalizePulseFeedbackKind(value: unknown): PulseFeedbackKind {
  const normalized = normalizeText(value).toLowerCase();
  if (PULSE_FEEDBACK_KINDS.includes(normalized as PulseFeedbackKind)) {
    return normalized as PulseFeedbackKind;
  }
  throw new Error(`不支持的 Pulse feedback kind: ${normalized || "(empty)"}`);
}
