import * as crypto from "node:crypto";

import { normalizeText } from "../contracts/text-normalization";
import type { PulseCandidate } from "./candidate-contracts";
import type { PulseCard, PulseFeedback, PulseRun, PulseScoreBreakdown, PulseTask } from "./contracts";

const PULSE_FOCUS_STOPWORDS = new Set([
  "continue",
  "today",
  "继续",
  "处理",
  "推进",
  "一下",
  "先",
  "先把",
  "今天",
]);

export function selectPulseCards(
  candidates: PulseCandidate[],
  context: {
    date: string;
    feedback: PulseFeedback[];
    focus: string;
    inspection: {
      staleReasons: string[];
      pendingHandoff: { exists: boolean };
      sourceHealth?: { thin: boolean };
    };
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
    inspection: {
      staleReasons: string[];
      pendingHandoff: { exists: boolean };
      sourceHealth?: { thin: boolean };
    };
    previousRuns: PulseRun[];
    tasks: PulseTask[];
  },
): PulseCard {
  const text = `${candidate.title}\n${candidate.why}\n${candidate.summary}\n${candidate.detailsMarkdown}`;
  const focusSurface = `${candidate.title}\n${candidate.topic}`;
  const contextThin = Boolean(context.inspection.sourceHealth?.thin || context.inspection.staleReasons.length);
  const breakdown: PulseScoreBreakdown = {
    activationRepair: candidate.type === "onboarding" ? 6 : 0,
    contextThin: candidate.type === "context" && contextThin ? 5 : 0,
    focus: matchesTopic(focusSurface, context.focus) ? 4 : 0,
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

function buildPulseCardId(date: string, candidate: PulseCandidate): string {
  const hash = crypto.createHash("sha1")
    .update([date, candidate.type, candidate.topic, candidate.title].join("\n"))
    .digest("hex")
    .slice(0, 12);
  return `pulse:${date}:${candidate.type}:${hash}`;
}

function matchesTopic(text: string, topic: string): boolean {
  const normalizedText = normalizeTopicKey(text);
  const normalizedTopicTokens = tokenizePulseTopic(topic).filter((token) => !PULSE_FOCUS_STOPWORDS.has(token));
  if (!normalizedText || !normalizedTopicTokens.length) {
    return false;
  }
  return normalizedTopicTokens.some((token) => normalizedText.includes(token));
}

function tokenizePulseTopic(value: unknown): string[] {
  return normalizeTopicKey(value)
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizeTopicKey(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}
