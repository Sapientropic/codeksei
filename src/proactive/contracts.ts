export const PROACTIVE_JUDGMENT_HOSTS = [
  "auto",
  "local",
  "openai-compatible",
  "codex",
  "hermes",
  "deterministic",
] as const;

export const PROACTIVE_INTERVENTION_LEVELS = [
  "silent",
  "backstage_only",
  "light_nudge",
  "state_check",
  "offer_next_step",
  "push_forward",
] as const;

export const PROACTIVE_REASON_CODES = [
  "context_thin",
  "open_loop_stale",
  "project_reentry",
  "scheduled_followup",
  "reminder_due",
  "closeout_window",
  "user_scattered",
  "voice_low_energy",
  "quiet_hours",
  "no_action",
] as const;

export const PROACTIVE_BACKSTAGE_ACTION_KINDS = [
  "timeline",
  "diary",
  "project_note",
  "companion_memory",
  "review",
] as const;

export const PROACTIVE_BACKSTAGE_ACTION_STATUSES = [
  "done",
  "suggested",
  "skipped",
] as const;

export const PROACTIVE_OUTPUT_MODALITIES = [
  "text",
  "voice",
  "silent",
  "backstage_only",
] as const;

export const PROACTIVE_NEXT_WAKE_POLICY_MODES = [
  "sleep_for",
  "next_wake_at",
  "keep_existing",
] as const;

export const PROACTIVE_SOURCE_THICKNESS_VALUES = [
  "thin",
  "usable",
  "strong",
] as const;

export const PROACTIVE_VOICE_ENERGY_VALUES = [
  "low",
  "medium",
  "high",
  "unknown",
] as const;

export const PROACTIVE_VOICE_SIGNAL_SOURCES = [
  "sensevoice",
  "voice_insight",
  "unknown",
] as const;

export const PROACTIVE_RESPONSE_OUTCOMES = [
  "engaged",
  "ignored",
  "dismissed",
  "annoyed",
  "corrected",
  "continued",
] as const;

export const PROACTIVE_OBSERVATION_STATE_SIGNALS = [
  "context_thin",
  "project_reentry",
  "memory_candidate",
  "user_low_energy",
  "quiet_hour",
  "open_loop",
  "life_record",
  "media_signal",
  "no_action",
] as const;

export const PROACTIVE_OBSERVATION_RISK_VALUES = [
  "low",
  "medium",
  "high",
  "unknown",
] as const;

export const PROACTIVE_OBSERVATION_USER_ENERGY_VALUES = [
  "low",
  "medium",
  "high",
  "unknown",
] as const;

export const PROACTIVE_OBSERVATION_MODALITY_HINTS = [
  "text",
  "voice",
  "silent",
  "backstage_only",
  "image",
  "audio",
] as const;

export type ProactiveJudgmentHost = typeof PROACTIVE_JUDGMENT_HOSTS[number];
export type ProactiveInterventionLevel = typeof PROACTIVE_INTERVENTION_LEVELS[number];
export type ProactiveReasonCode = typeof PROACTIVE_REASON_CODES[number];
export type ProactiveBackstageActionKind = typeof PROACTIVE_BACKSTAGE_ACTION_KINDS[number];
export type ProactiveBackstageActionStatus = typeof PROACTIVE_BACKSTAGE_ACTION_STATUSES[number];
export type ProactiveOutputModality = typeof PROACTIVE_OUTPUT_MODALITIES[number];
export type ProactiveNextWakePolicyMode = typeof PROACTIVE_NEXT_WAKE_POLICY_MODES[number];
export type ProactiveSourceThickness = typeof PROACTIVE_SOURCE_THICKNESS_VALUES[number];
export type ProactiveVoiceEnergy = typeof PROACTIVE_VOICE_ENERGY_VALUES[number];
export type ProactiveVoiceSignalSource = typeof PROACTIVE_VOICE_SIGNAL_SOURCES[number];
export type ProactiveResponseOutcome = typeof PROACTIVE_RESPONSE_OUTCOMES[number];
export type ProactiveObservationStateSignal = typeof PROACTIVE_OBSERVATION_STATE_SIGNALS[number];
export type ProactiveObservationRisk = typeof PROACTIVE_OBSERVATION_RISK_VALUES[number];
export type ProactiveObservationUserEnergy = typeof PROACTIVE_OBSERVATION_USER_ENERGY_VALUES[number];
export type ProactiveObservationModalityHint = typeof PROACTIVE_OBSERVATION_MODALITY_HINTS[number];

export interface ProactiveStateCard {
  activeThread: string;
  currentLikelyState: string;
  doNotDo: string[];
  easiestReentryStep: string;
  likelyBlocker: string;
  sourceThickness: ProactiveSourceThickness;
  toneHint: string;
}

export interface ProactiveVoiceSignal {
  confidence: number;
  durationMs: number;
  emotion: string;
  energy: ProactiveVoiceEnergy;
  source: ProactiveVoiceSignalSource;
  transcript: string;
}

export interface ProactiveRecentOutcome {
  createdAt: string;
  interventionLevel: string;
  reasonCode: string;
  responseOutcome: string;
}

export interface ProactiveObservationModelRef {
  fallbackReason: string;
  host: ProactiveJudgmentHost;
  model: string;
  used: boolean;
}

export interface ProactiveObservationMemoryCandidate {
  confidence: number;
  evidence: string;
  kind: "boundary" | "next" | "pattern" | "preference" | "status";
  slotId: "boundary" | "current_status" | "next" | "preference" | "rhythm";
  text: string;
}

export interface ProactiveObservation {
  annoyanceRisk: ProactiveObservationRisk;
  confidence: number;
  createdAt: string;
  currentStateHypothesis: string;
  discardReason: string;
  evidence: string[];
  id: string;
  kind: "proactive_observation";
  likelyBlocker: string;
  memoryCandidates: ProactiveObservationMemoryCandidate[];
  modalityHints: ProactiveObservationModalityHint[];
  model: ProactiveObservationModelRef;
  reentryCandidate: string;
  sourceHash: string;
  stateSignals: ProactiveObservationStateSignal[];
  suggestedTone: string;
  surfaceRisk: ProactiveObservationRisk;
  usable: boolean;
  userEnergy: ProactiveObservationUserEnergy;
  version: 1;
}

export interface ProactiveJudgmentInput {
  checkin: {
    lastCompletionAt: string;
    lastCompletionResult: string;
    nextWakeAt: string;
    pendingHandoffExists: boolean;
  };
  contextBriefing: {
    followupContext: string;
    stale: boolean;
    staleReasons: string[];
  };
  now: string;
  observation?: ProactiveObservation | undefined;
  recentOutcomes: ProactiveRecentOutcome[];
  stateCard: ProactiveStateCard;
  target: {
    senderId: string;
    targetKey: string;
    workspaceRoot: string;
  };
  timezone: string;
  voiceSignal?: ProactiveVoiceSignal | undefined;
}

export interface ProactiveBackstageAction {
  kind: ProactiveBackstageActionKind;
  status: ProactiveBackstageActionStatus;
  summary: string;
}

export interface ProactiveNextWakePolicy {
  mode: ProactiveNextWakePolicyMode;
  nextWakeAt?: string | undefined;
  reason: string;
  sleepFor?: string | undefined;
}

export interface ProactiveDecision {
  backstageActions: ProactiveBackstageAction[];
  confidence: number;
  decisionId: string;
  decisionVersion: 1;
  interventionLevel: ProactiveInterventionLevel;
  kind: "proactive_decision";
  model: {
    fallbackReason: string;
    host: ProactiveJudgmentHost;
    model: string;
    used: boolean;
  };
  nextWakePolicy: ProactiveNextWakePolicy;
  outputModality: ProactiveOutputModality;
  reasonCode: ProactiveReasonCode;
  shouldSurface: boolean;
  suggestedMessage: string;
  userVisibleReason: string;
}

export interface ProactiveOutcomeLogEntry {
  actualResult: string;
  createdAt: string;
  decisionId: string;
  feedbackText: string;
  interventionLevel: ProactiveInterventionLevel | string;
  model: ProactiveDecision["model"];
  nextWakePolicy: ProactiveNextWakePolicy;
  reasonCode: ProactiveReasonCode | string;
  responseOutcome: ProactiveResponseOutcome | "";
  suggestedMessage: string;
  targetKey: string;
}

export interface ProactiveJudgmentConfig {
  stateDir?: unknown;
  timezone?: unknown;
  proactiveJudgmentApiKey?: string;
  proactiveJudgmentEndpoint?: string;
  proactiveJudgmentGenerator?: ((input: ProactiveJudgmentInput) => Promise<Record<string, unknown>> | Record<string, unknown>) | null;
  proactiveJudgmentHost?: ProactiveJudgmentHost | string;
  proactiveJudgmentMinConfidence?: number;
  proactiveJudgmentMode?: string;
  proactiveJudgmentModel?: string;
  proactiveJudgmentTimeoutMs?: number;
  proactiveObservationApiKey?: string;
  proactiveObservationEndpoint?: string;
  proactiveObservationGenerator?: ((input: ProactiveJudgmentInput) => Promise<Record<string, unknown>> | Record<string, unknown>) | null;
  proactiveObservationHost?: ProactiveJudgmentHost | string;
  proactiveObservationMinConfidence?: number;
  proactiveObservationMode?: string;
  proactiveObservationModel?: string;
  proactiveObservationTimeoutMs?: number;
}

export function normalizeProactiveJudgmentHost(value: unknown): ProactiveJudgmentHost | "" {
  const normalized = String(value || "").trim().toLowerCase();
  if (PROACTIVE_JUDGMENT_HOSTS.includes(normalized as ProactiveJudgmentHost)) {
    return normalized as ProactiveJudgmentHost;
  }
  return "";
}
