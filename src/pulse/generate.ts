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
  PulseFeedback,
  PulseFeedbackKind,
  PulseRun,
  PulseTask,
} from "./contracts";
import { buildPulseCandidates } from "./candidates";
import { selectPulseCards } from "./score";
import { collectPulseLocalPaths } from "./sanitize";

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
    localPaths: collectPulseLocalPaths(config, inspection.report),
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
    headline: buildPulseHeadline(cards.length),
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

function collectRecentPulseRuns(config: PulseConfig, date: string): PulseRun[] {
  const candidates = [-1, -2, -3]
    .map((offset) => offsetDate(date, offset))
    .map((candidateDate) => readPulseRun(config, candidateDate))
    .filter((run): run is PulseRun => Boolean(run));
  return candidates;
}

function buildPulseHeadline(cardCount: number): string {
  return `今天值得继续的 ${Math.max(0, cardCount)} 张卡片`;
}

function offsetDate(date: string, offsetDays: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(base.getTime())) {
    return date;
  }
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

function normalizePulseFeedbackKind(value: unknown): PulseFeedbackKind {
  const normalized = normalizeText(value).toLowerCase();
  if (PULSE_FEEDBACK_KINDS.includes(normalized as PulseFeedbackKind)) {
    return normalized as PulseFeedbackKind;
  }
  throw new Error(`不支持的 Pulse feedback kind: ${normalized || "(empty)"}`);
}
