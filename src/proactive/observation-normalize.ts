import * as crypto from "node:crypto";

import { normalizeText } from "../contracts/text-normalization";
import {
  PROACTIVE_OBSERVATION_MODALITY_HINTS,
  PROACTIVE_OBSERVATION_RISK_VALUES,
  PROACTIVE_OBSERVATION_STATE_SIGNALS,
  PROACTIVE_OBSERVATION_USER_ENERGY_VALUES,
  type ProactiveJudgmentHost,
  type ProactiveObservation,
  type ProactiveObservationMemoryCandidate,
} from "./contracts";

interface NormalizeObservationContext {
  host: ProactiveJudgmentHost;
  minConfidence: number;
  model: string;
  now: Date;
  sourceHash: string;
}

const MAX_TEXT_LENGTH = 220;
const MAX_SHORT_TEXT_LENGTH = 120;
const MAX_EVIDENCE_ITEMS = 6;
const MAX_SIGNAL_ITEMS = 8;
const MAX_MEMORY_CANDIDATES = 5;

const MEMORY_SLOT_IDS = ["boundary", "current_status", "next", "preference", "rhythm"] as const;
const MEMORY_KINDS = ["boundary", "next", "pattern", "preference", "status"] as const;

export function normalizeProactiveObservation(
  raw: unknown,
  context: NormalizeObservationContext,
): ProactiveObservation | null {
  const record = asRecord(raw);
  const confidence = normalizeConfidence(record.confidence);
  const evidence = normalizeStringList(record.evidence, MAX_EVIDENCE_ITEMS, MAX_TEXT_LENGTH);
  const discardReasons = [
    confidence < context.minConfidence ? `confidence ${confidence.toFixed(2)} below ${context.minConfidence.toFixed(2)}` : "",
    evidence.length ? "" : "missing evidence",
  ].filter(Boolean);
  const stateSignals = normalizeEnumList(record.stateSignals || record.state_signals, PROACTIVE_OBSERVATION_STATE_SIGNALS, MAX_SIGNAL_ITEMS);
  const modalityHints = normalizeEnumList(record.modalityHints || record.modality_hints, PROACTIVE_OBSERVATION_MODALITY_HINTS, MAX_SIGNAL_ITEMS);
  const observationCore = {
    confidence,
    currentStateHypothesis: truncate(record.currentStateHypothesis || record.current_state_hypothesis, MAX_TEXT_LENGTH),
    discardReason: discardReasons.join("; "),
    evidence,
    likelyBlocker: truncate(record.likelyBlocker || record.likely_blocker, MAX_TEXT_LENGTH),
    memoryCandidates: normalizeMemoryCandidates(record.memoryCandidates || record.memory_candidates),
    modalityHints,
    reentryCandidate: truncate(record.reentryCandidate || record.reentry_candidate, MAX_TEXT_LENGTH),
    stateSignals,
    suggestedTone: truncate(record.suggestedTone || record.suggested_tone, MAX_SHORT_TEXT_LENGTH),
    surfaceRisk: normalizeEnum(record.surfaceRisk || record.surface_risk, PROACTIVE_OBSERVATION_RISK_VALUES) || "unknown",
    annoyanceRisk: normalizeEnum(record.annoyanceRisk || record.annoyance_risk, PROACTIVE_OBSERVATION_RISK_VALUES) || "unknown",
    usable: discardReasons.length === 0,
    userEnergy: normalizeEnum(record.userEnergy || record.user_energy, PROACTIVE_OBSERVATION_USER_ENERGY_VALUES) || "unknown",
  };
  const createdAt = context.now.toISOString();
  return {
    ...observationCore,
    createdAt,
    id: buildObservationId(context.sourceHash, createdAt, observationCore),
    kind: "proactive_observation",
    model: {
      fallbackReason: "",
      host: context.host,
      model: normalizeText(context.model),
      used: true,
    },
    sourceHash: normalizeText(context.sourceHash),
    version: 1,
  };
}

function normalizeMemoryCandidates(value: unknown): ProactiveObservationMemoryCandidate[] {
  const candidates: ProactiveObservationMemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const record = asRecord(item);
    const slotId = normalizeEnum(record.slotId || record.slot_id, MEMORY_SLOT_IDS);
    const kind = normalizeEnum(record.kind, MEMORY_KINDS);
    const text = truncate(record.text, MAX_TEXT_LENGTH);
    const evidence = truncate(record.evidence, MAX_TEXT_LENGTH);
    const confidence = normalizeConfidence(record.confidence);
    if (!slotId || !kind || !text || !evidence || confidence <= 0) {
      continue;
    }
    const signature = `${slotId}:${kind}:${text.toLowerCase()}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    candidates.push({ confidence, evidence, kind, slotId, text });
    if (candidates.length >= MAX_MEMORY_CANDIDATES) {
      break;
    }
  }
  return candidates;
}

function normalizeEnumList<T extends readonly string[]>(value: unknown, allowed: T, maxItems: number): T[number][] {
  const items: T[number][] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(value) ? value : []) {
    const normalized = normalizeEnum(raw, allowed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    items.push(normalized);
    if (items.length >= maxItems) {
      break;
    }
  }
  return items;
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | "" {
  const normalized = normalizeText(value).toLowerCase();
  return allowed.includes(normalized) ? normalized as T[number] : "";
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/gu) : []) {
    const normalized = truncate(raw, maxLength);
    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    items.push(normalized);
    if (items.length >= maxItems) {
      break;
    }
  }
  return items;
}

function truncate(value: unknown, limit: number): string {
  const normalized = normalizeText(value);
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1)).replace(/[，。；,;:\s]+$/u, "")}…` : normalized;
}

function normalizeConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  if (numeric >= 1) {
    return 1;
  }
  return Math.round(numeric * 100) / 100;
}

function buildObservationId(sourceHash: string, createdAt: string, core: Record<string, unknown>): string {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({ sourceHash, createdAt, core }))
    .digest("hex")
    .slice(0, 16);
  return `po_${digest}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
