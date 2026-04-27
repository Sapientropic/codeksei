export const PULSE_CARD_STATUSES = [
  "active",
  "hidden",
  "task",
] as const;

export const PULSE_CARD_TYPES = [
  "focus",
  "task",
  "handoff",
  "project",
  "today",
  "capability",
  "context",
] as const;

export const PULSE_FEEDBACK_KINDS = [
  "like",
  "dislike",
  "hide",
  "save",
  "task",
] as const;

export type PulseCardStatus = typeof PULSE_CARD_STATUSES[number];
export type PulseCardType = typeof PULSE_CARD_TYPES[number];
export type PulseFeedbackKind = typeof PULSE_FEEDBACK_KINDS[number];

export interface PulseScoreBreakdown {
  contextThin: number;
  focus: number;
  negativeFeedback: number;
  pendingHandoff: number;
  positiveFeedback: number;
  projectReentry: number;
  repeatedRecent: number;
  todayFacts: number;
  unfinishedTask: number;
}

export interface PulseSourceRef {
  id: string;
  kind: string;
  title: string;
}

export interface PulseCard {
  date: string;
  detailsMarkdown: string;
  id: string;
  score: number;
  scoreBreakdown: PulseScoreBreakdown;
  sourceRefs: PulseSourceRef[];
  status: PulseCardStatus;
  suggestedPrompt: string;
  summary: string;
  title: string;
  topic: string;
  type: PulseCardType;
  why: string;
}

export interface PulseRun {
  cards: PulseCard[];
  createdAt: string;
  date: string;
  focus: string;
  headline: string;
  kind: "pulse_run";
  version: 1;
}

export interface PulseFeedback {
  cardId: string;
  createdAt: string;
  kind: PulseFeedbackKind;
  text: string;
  topic: string;
}

export interface PulseTask {
  cardId: string;
  createdAt: string;
  status: "open" | "done";
  text: string;
  topic: string;
}
