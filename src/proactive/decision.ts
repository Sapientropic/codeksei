import * as crypto from "node:crypto";

import { normalizeText } from "../contracts/text-normalization";
import {
  PROACTIVE_BACKSTAGE_ACTION_KINDS,
  PROACTIVE_BACKSTAGE_ACTION_STATUSES,
  PROACTIVE_INTERVENTION_LEVELS,
  PROACTIVE_NEXT_WAKE_POLICY_MODES,
  PROACTIVE_OUTPUT_MODALITIES,
  PROACTIVE_REASON_CODES,
  type ProactiveBackstageAction,
  type ProactiveDecision,
  type ProactiveInterventionLevel,
  type ProactiveJudgmentConfig,
  type ProactiveJudgmentHost,
  type ProactiveJudgmentInput,
  type ProactiveNextWakePolicy,
  type ProactiveOutputModality,
  type ProactiveReasonCode,
} from "./contracts";
import { resolveActiveProactiveJudgmentHost, resolveProactiveJudgmentHostAdapter } from "./semantic-host";

const DEFAULT_MIN_CONFIDENCE = 0.62;
const DEFAULT_TIMEOUT_MS = 2500;
const MAX_MESSAGE_LENGTH = 180;

export async function buildProactiveDecision(
  config: ProactiveJudgmentConfig = {},
  input: ProactiveJudgmentInput,
): Promise<ProactiveDecision> {
  const deterministic = buildDeterministicProactiveDecision(input);
  if (normalizeText(config.proactiveJudgmentMode).toLowerCase() === "deterministic") {
    return deterministic;
  }

  const generator = config.proactiveJudgmentGenerator;
  const adapter = resolveProactiveJudgmentHostAdapter(config);
  if (typeof generator !== "function" && !adapter) {
    return deterministic;
  }

  try {
    const activeHost = adapter?.host || resolveActiveProactiveJudgmentHost(config);
    const raw = typeof generator === "function"
      ? await generator(input)
      : await adapter!.run(config, input, resolveProactiveJudgmentTimeoutMs(config));
    const normalized = normalizeModelDecision(raw, deterministic, {
      host: activeHost,
      minConfidence: resolveProactiveJudgmentMinConfidence(config),
      model: normalizeText(config.proactiveJudgmentModel),
    });
    return applyHardGuardrails(normalized, input);
  } catch (error) {
    return withFallbackReason(deterministic, formatError(error));
  }
}

export function buildDeterministicProactiveDecision(input: ProactiveJudgmentInput): ProactiveDecision {
  const reasonCode = resolveDeterministicReasonCode(input);
  const interventionLevel = resolveDeterministicInterventionLevel(input, reasonCode);
  const shouldSurface = interventionLevel !== "silent" && interventionLevel !== "backstage_only";
  const outputModality: ProactiveOutputModality = interventionLevel === "silent"
    ? "silent"
    : interventionLevel === "backstage_only"
      ? "backstage_only"
      : "text";
  return {
    backstageActions: resolveDeterministicBackstageActions(input, reasonCode, interventionLevel),
    confidence: resolveDeterministicConfidence(input),
    decisionId: buildDecisionId(input),
    decisionVersion: 1,
    interventionLevel,
    kind: "proactive_decision",
    model: {
      fallbackReason: "",
      host: "deterministic",
      model: "",
      used: false,
    },
    nextWakePolicy: resolveDeterministicNextWakePolicy(input, reasonCode, interventionLevel),
    outputModality,
    reasonCode,
    shouldSurface,
    suggestedMessage: shouldSurface ? buildDeterministicSuggestedMessage(input, reasonCode, interventionLevel) : "",
    userVisibleReason: buildUserVisibleReason(input, reasonCode),
  };
}

function normalizeModelDecision(
  raw: Record<string, unknown>,
  deterministic: ProactiveDecision,
  {
    host,
    minConfidence,
    model,
  }: {
    host: Exclude<ProactiveJudgmentHost, "auto" | "deterministic"> | Exclude<ProactiveJudgmentHost, "auto">;
    minConfidence: number;
    model: string;
  },
): ProactiveDecision {
  const confidence = clampNumber(raw.confidence);
  if (confidence < minConfidence) {
    throw new Error(`model confidence ${confidence.toFixed(2)} below ${minConfidence.toFixed(2)}`);
  }
  const reasonCode = normalizeEnum(raw.reasonCode, PROACTIVE_REASON_CODES) || deterministic.reasonCode;
  const interventionLevel = normalizeEnum(raw.interventionLevel, PROACTIVE_INTERVENTION_LEVELS)
    || deterministic.interventionLevel;
  const outputModality = normalizeEnum(raw.outputModality, PROACTIVE_OUTPUT_MODALITIES)
    || resolveOutputModality(interventionLevel);
  return {
    backstageActions: normalizeBackstageActions(raw.backstageActions, deterministic.backstageActions),
    confidence,
    decisionId: deterministic.decisionId,
    decisionVersion: 1,
    interventionLevel,
    kind: "proactive_decision",
    model: {
      fallbackReason: "",
      host,
      model,
      used: true,
    },
    nextWakePolicy: normalizeNextWakePolicy(raw.nextWakePolicy, deterministic.nextWakePolicy),
    outputModality,
    reasonCode,
    shouldSurface: typeof raw.shouldSurface === "boolean"
      ? raw.shouldSurface
      : interventionLevel !== "silent" && interventionLevel !== "backstage_only",
    suggestedMessage: truncate(normalizeText(raw.suggestedMessage), MAX_MESSAGE_LENGTH),
    userVisibleReason: truncate(normalizeText(raw.userVisibleReason), MAX_MESSAGE_LENGTH) || deterministic.userVisibleReason,
  };
}

function applyHardGuardrails(decision: ProactiveDecision, input: ProactiveJudgmentInput): ProactiveDecision {
  if (isUsableObservation(input) && input.observation?.surfaceRisk === "high" && decision.shouldSurface) {
    return {
      ...decision,
      interventionLevel: "backstage_only",
      outputModality: "backstage_only",
      shouldSurface: false,
      suggestedMessage: "",
      userVisibleReason: "小模型观察认为当前打扰风险偏高，先降到后台整理。",
    };
  }
  if (input.voiceSignal?.energy === "low" && (decision.interventionLevel === "push_forward" || decision.outputModality === "voice")) {
    return {
      ...decision,
      interventionLevel: "backstage_only",
      outputModality: "backstage_only",
      shouldSurface: false,
      suggestedMessage: "",
      reasonCode: "voice_low_energy",
      userVisibleReason: "语音状态偏低能量，先降到后台整理。",
    };
  }
  if (isQuietHour(input) && decision.interventionLevel === "push_forward") {
    return {
      ...decision,
      interventionLevel: "light_nudge",
      outputModality: "text",
      userVisibleReason: "当前处在安静时段，不升级成强推动。",
    };
  }
  if (!decision.suggestedMessage && decision.shouldSurface) {
    return {
      ...decision,
      suggestedMessage: buildDeterministicSuggestedMessage(input, decision.reasonCode, decision.interventionLevel),
    };
  }
  return decision;
}

function resolveDeterministicReasonCode(input: ProactiveJudgmentInput): ProactiveReasonCode {
  if (input.voiceSignal?.energy === "low") {
    return "voice_low_energy";
  }
  if (hasRecentOutcome(input, "annoyed") || hasRecentOutcome(input, "dismissed")) {
    return "no_action";
  }
  if (isUsableObservation(input) && (input.observation?.surfaceRisk === "high" || input.observation?.userEnergy === "low")) {
    return input.observation?.userEnergy === "low" ? "voice_low_energy" : "no_action";
  }
  if (input.contextBriefing.stale || input.stateCard.sourceThickness === "thin") {
    return "context_thin";
  }
  if (hasObservationReentryCandidate(input)) {
    return "project_reentry";
  }
  if (normalizeText(input.contextBriefing.followupContext)) {
    return "scheduled_followup";
  }
  if (isCloseoutWindow(input)) {
    return "closeout_window";
  }
  if (normalizeText(input.stateCard.easiestReentryStep) || normalizeText(input.stateCard.activeThread)) {
    return "project_reentry";
  }
  return "no_action";
}

function resolveDeterministicInterventionLevel(
  input: ProactiveJudgmentInput,
  reasonCode: ProactiveReasonCode,
): ProactiveInterventionLevel {
  if (reasonCode === "voice_low_energy") {
    return "backstage_only";
  }
  if (reasonCode === "context_thin") {
    return "state_check";
  }
  if (reasonCode === "scheduled_followup") {
    return "light_nudge";
  }
  if (reasonCode === "closeout_window") {
    return input.stateCard.sourceThickness === "strong" ? "light_nudge" : "backstage_only";
  }
  if (reasonCode === "project_reentry") {
    return "offer_next_step";
  }
  if (isUsableObservation(input) && input.observation?.memoryCandidates.length) {
    return "backstage_only";
  }
  return "silent";
}

function resolveDeterministicBackstageActions(
  input: ProactiveJudgmentInput,
  reasonCode: ProactiveReasonCode,
  interventionLevel: ProactiveInterventionLevel,
): ProactiveBackstageAction[] {
  const observationMemoryActions = isUsableObservation(input) && input.observation?.memoryCandidates.length
    ? [{
      kind: "companion_memory",
      status: "suggested",
      summary: input.observation.memoryCandidates[0]?.text || "小模型观察到候选长期记忆，需主会话确认后再写入。",
    }] satisfies ProactiveBackstageAction[]
    : [];
  if (reasonCode === "closeout_window") {
    return [...observationMemoryActions, {
      kind: "review",
      status: "suggested",
      summary: "如果用户正在收尾，优先生成 nightly closeout。",
    }];
  }
  if (reasonCode === "project_reentry" || interventionLevel === "offer_next_step") {
    return [...observationMemoryActions, {
      kind: "project_note",
      status: "suggested",
      summary: resolveObservationReentryCandidate(input) || input.stateCard.easiestReentryStep || input.stateCard.activeThread || "记录当前项目重入入口。",
    }];
  }
  if (reasonCode === "voice_low_energy") {
    return [...observationMemoryActions, {
      kind: "diary",
      status: "suggested",
      summary: "语音状态偏低能量，先保留当前线索，避免强提醒。",
    }];
  }
  return observationMemoryActions;
}

function resolveDeterministicNextWakePolicy(
  input: ProactiveJudgmentInput,
  reasonCode: ProactiveReasonCode,
  interventionLevel: ProactiveInterventionLevel,
): ProactiveNextWakePolicy {
  if (reasonCode === "voice_low_energy" || interventionLevel === "backstage_only") {
    return { mode: "sleep_for", reason: "低打扰状态下延后再看。", sleepFor: "4h" };
  }
  if (reasonCode === "context_thin") {
    return { mode: "sleep_for", reason: "先轻问确认，短间隔观察是否接上。", sleepFor: "90m" };
  }
  if (reasonCode === "project_reentry" || reasonCode === "scheduled_followup") {
    return { mode: "sleep_for", reason: "当前线索可接回，适合中等间隔后再判断。", sleepFor: "2h" };
  }
  return input.checkin.nextWakeAt
    ? { mode: "keep_existing", reason: "没有更强主动信号，沿用现有唤醒计划。" }
    : { mode: "sleep_for", reason: "没有明确主动信号，保守延后。", sleepFor: "6h" };
}

function buildDeterministicSuggestedMessage(
  input: ProactiveJudgmentInput,
  reasonCode: ProactiveReasonCode,
  interventionLevel: ProactiveInterventionLevel,
): string {
  if (reasonCode === "context_thin" || interventionLevel === "state_check") {
    return "我有点不确定你现在还在不在这条线，要不要我先帮你接一下？";
  }
  if (reasonCode === "scheduled_followup") {
    return truncate(`我把这条线还留着：${input.contextBriefing.followupContext} 要不要从这里继续？`, MAX_MESSAGE_LENGTH);
  }
  const step = normalizeText(resolveObservationReentryCandidate(input) || input.stateCard.easiestReentryStep || input.stateCard.activeThread);
  if (step) {
    return truncate(`我看这条线可以从这里接：${step}`, MAX_MESSAGE_LENGTH);
  }
  return "我先轻轻接一下这条线。";
}

function buildUserVisibleReason(input: ProactiveJudgmentInput, reasonCode: ProactiveReasonCode): string {
  if (reasonCode === "voice_low_energy") {
    return "语音状态偏低能量，先不强推。";
  }
  if (reasonCode === "context_thin") {
    return "上下文偏薄，适合先确认当前状态。";
  }
  if (reasonCode === "project_reentry") {
    if (resolveObservationReentryCandidate(input)) {
      return "小模型观察到当前有可接回的项目线索。";
    }
    return "当前有可接回的项目线索。";
  }
  if (normalizeText(input.contextBriefing.followupContext)) {
    return "存在上一轮留下的 follow-up。";
  }
  return "当前没有强主动信号。";
}

function resolveDeterministicConfidence(input: ProactiveJudgmentInput): number {
  if (input.stateCard.sourceThickness === "strong") {
    return 0.74;
  }
  if (input.stateCard.sourceThickness === "usable") {
    return 0.66;
  }
  return 0.58;
}

function normalizeBackstageActions(value: unknown, fallback: ProactiveBackstageAction[]): ProactiveBackstageAction[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const actions = value
    .map((entry) => normalizeBackstageAction(entry))
    .filter((entry): entry is ProactiveBackstageAction => Boolean(entry))
    .slice(0, 5);
  return actions.length ? actions : fallback;
}

function normalizeBackstageAction(value: unknown): ProactiveBackstageAction | null {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const kind = normalizeEnum(record.kind, PROACTIVE_BACKSTAGE_ACTION_KINDS);
  const status = normalizeEnum(record.status, PROACTIVE_BACKSTAGE_ACTION_STATUSES);
  const summary = truncate(normalizeText(record.summary), 180);
  return kind && status && summary ? { kind, status, summary } : null;
}

function normalizeNextWakePolicy(value: unknown, fallback: ProactiveNextWakePolicy): ProactiveNextWakePolicy {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const mode = normalizeEnum(record.mode, PROACTIVE_NEXT_WAKE_POLICY_MODES);
  if (!mode) {
    return fallback;
  }
  const reason = truncate(normalizeText(record.reason), 180) || fallback.reason;
  if (mode === "sleep_for") {
    const sleepFor = normalizeText(record.sleepFor);
    return sleepFor ? { mode, reason, sleepFor } : fallback;
  }
  if (mode === "next_wake_at") {
    const nextWakeAt = normalizeText(record.nextWakeAt);
    return nextWakeAt ? { mode, nextWakeAt, reason } : fallback;
  }
  return { mode, reason };
}

function resolveOutputModality(interventionLevel: ProactiveInterventionLevel): ProactiveOutputModality {
  if (interventionLevel === "silent") {
    return "silent";
  }
  if (interventionLevel === "backstage_only") {
    return "backstage_only";
  }
  return "text";
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | "" {
  const normalized = normalizeText(value).toLowerCase();
  return allowed.includes(normalized) ? normalized as T[number] : "";
}

function clampNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(1, numeric));
}

function withFallbackReason(decision: ProactiveDecision, fallbackReason: string): ProactiveDecision {
  return {
    ...decision,
    model: {
      fallbackReason,
      host: "deterministic",
      model: "",
      used: false,
    },
  };
}

function buildDecisionId(input: ProactiveJudgmentInput): string {
  const source = [
    input.target.targetKey,
    input.now,
    input.contextBriefing.followupContext,
    input.stateCard.activeThread,
    input.stateCard.easiestReentryStep,
  ].join("\n");
  return `pd_${crypto.createHash("sha256").update(source).digest("hex").slice(0, 16)}`;
}

function hasRecentOutcome(input: ProactiveJudgmentInput, outcome: string): boolean {
  return input.recentOutcomes.slice(-3).some((entry) => normalizeText(entry.responseOutcome) === outcome);
}

function hasObservationReentryCandidate(input: ProactiveJudgmentInput): boolean {
  return isUsableObservation(input)
    && Boolean(resolveObservationReentryCandidate(input))
    && input.observation?.annoyanceRisk !== "high"
    && input.observation?.surfaceRisk !== "high";
}

function resolveObservationReentryCandidate(input: ProactiveJudgmentInput): string {
  const observation = input.observation;
  if (!observation || !observation.usable || observation.annoyanceRisk === "high" || observation.surfaceRisk === "high") {
    return "";
  }
  return normalizeText(observation.reentryCandidate);
}

function isUsableObservation(input: ProactiveJudgmentInput): boolean {
  return Boolean(input.observation?.usable);
}

function isCloseoutWindow(input: ProactiveJudgmentInput): boolean {
  const hour = parseLocalHour(input);
  return hour >= 22 || hour < 2;
}

function isQuietHour(input: ProactiveJudgmentInput): boolean {
  const hour = parseLocalHour(input);
  return hour >= 23 || hour < 7;
}

function parseLocalHour(input: ProactiveJudgmentInput): number {
  const date = new Date(input.now);
  if (!Number.isFinite(date.getTime())) {
    return 12;
  }
  try {
    const hourText = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone: normalizeText(input.timezone) || "UTC",
    }).format(date);
    return Number.parseInt(hourText, 10);
  } catch {
    return date.getUTCHours();
  }
}

function resolveProactiveJudgmentMinConfidence(config: ProactiveJudgmentConfig): number {
  const configured = Number(config.proactiveJudgmentMinConfidence);
  return Number.isFinite(configured) && configured > 0 ? Math.min(1, configured) : DEFAULT_MIN_CONFIDENCE;
}

function resolveProactiveJudgmentTimeoutMs(config: ProactiveJudgmentConfig): number {
  const configured = Number(config.proactiveJudgmentTimeoutMs);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function truncate(value: string, limit: number): string {
  const normalized = normalizeText(value);
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}
