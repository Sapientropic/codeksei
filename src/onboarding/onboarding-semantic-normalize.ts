import {
  asRecord,
  normalizeText,
  parseSemanticJson,
  type JsonObject,
} from "../core/semantic-json";
import type { OnboardingSlotId } from "./state";
import {
  ONBOARDING_PERSONA_DOMAINS,
  ONBOARDING_SEMANTIC_PRIORITY_VALUES,
  ONBOARDING_STABILITY_VALUES,
  ONBOARDING_TIME_SCOPE_VALUES,
  type OnboardingCompanionKind,
  type OnboardingFactStability,
  type OnboardingPersonaDomain,
  type OnboardingSemanticPriority,
  type OnboardingTimeScope,
} from "./onboarding-contracts";

export interface OnboardingSemanticFact {
  confidence: number;
  domain: OnboardingPersonaDomain;
  evidence: string;
  isCorrection: boolean;
  replaces: string[];
  stability: OnboardingFactStability;
  statement: string;
  suggestedKind: OnboardingCompanionKind | "";
  suggestedSlot: OnboardingSlotId | "";
  timeScope: OnboardingTimeScope;
}

export interface OnboardingSemanticGap {
  domain: OnboardingPersonaDomain | "";
  priority: OnboardingSemanticPriority;
  reason: string;
  slotId: OnboardingSlotId | "";
  toneHint: string;
}

export interface OnboardingUnsafeInference {
  domain: OnboardingPersonaDomain | "";
  reason: string;
  statement: string;
}

export interface OnboardingSemanticResult {
  corrections: OnboardingSemanticFact[];
  facts: OnboardingSemanticFact[];
  gaps: OnboardingSemanticGap[];
  unsafeInferences: OnboardingUnsafeInference[];
}

export function normalizeOnboardingSemanticResult(raw: unknown): OnboardingSemanticResult | null {
  const normalized = asRecord(raw);
  if (!Object.keys(normalized).length) {
    return null;
  }
  return {
    corrections: normalizeSemanticFacts(normalized.corrections, true),
    facts: normalizeSemanticFacts(normalized.facts, false),
    gaps: normalizeSemanticGaps(normalized.gaps),
    unsafeInferences: normalizeUnsafeInferences(normalized.unsafe_inferences || normalized.unsafeInferences),
  };
}

export function hasOnboardingSemanticPayload(result: OnboardingSemanticResult | null): boolean {
  if (!result) {
    return false;
  }
  return Boolean(result.facts.length || result.corrections.length || result.gaps.length);
}

function normalizeSemanticFacts(value: unknown, defaultCorrection: boolean): OnboardingSemanticFact[] {
  const facts: OnboardingSemanticFact[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const record = asRecord(item);
    const statement = truncateSentence(record.statement, 200);
    const domain = normalizeDomain(record.domain);
    if (!statement || !domain) {
      continue;
    }
    const fact: OnboardingSemanticFact = {
      confidence: normalizeConfidence(record.confidence),
      domain,
      evidence: truncateSentence(record.evidence, 220),
      isCorrection: normalizeBoolean(record.is_correction ?? record.isCorrection, defaultCorrection),
      replaces: normalizeStringList(record.replaces, 4, 160),
      stability: normalizeStability(record.stability),
      statement,
      suggestedKind: normalizeSuggestedKind(record.suggested_kind || record.suggestedKind),
      suggestedSlot: normalizeSuggestedSlot(record.suggested_slot || record.suggestedSlot),
      timeScope: normalizeTimeScope(record.time_scope || record.timeScope),
    };
    const signature = [
      fact.domain,
      fact.suggestedSlot,
      fact.statement.toLowerCase(),
      fact.isCorrection ? "correction" : "fact",
    ].join(":");
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    facts.push(fact);
  }
  return facts;
}

function normalizeSemanticGaps(value: unknown): OnboardingSemanticGap[] {
  const gaps: OnboardingSemanticGap[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const record = asRecord(item);
    const reason = truncateSentence(record.reason, 180);
    const slotId = normalizeSuggestedSlot(record.slot_id || record.slotId);
    const domain = normalizeDomain(record.domain);
    if (!reason && !slotId && !domain) {
      continue;
    }
    const gap: OnboardingSemanticGap = {
      domain,
      priority: normalizePriority(record.priority),
      reason,
      slotId,
      toneHint: truncateSentence(record.tone_hint || record.toneHint, 120),
    };
    const signature = [gap.domain, gap.slotId, gap.reason.toLowerCase()].join(":");
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    gaps.push(gap);
  }
  return gaps;
}

function normalizeUnsafeInferences(value: unknown): OnboardingUnsafeInference[] {
  const items: OnboardingUnsafeInference[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const record = asRecord(item);
    const statement = truncateSentence(record.statement, 180);
    const reason = truncateSentence(record.reason, 180);
    const domain = normalizeDomain(record.domain);
    if (!statement || !reason) {
      continue;
    }
    const signature = `${domain}:${statement.toLowerCase()}:${reason.toLowerCase()}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    items.push({ domain, reason, statement });
  }
  return items;
}

function normalizeDomain(value: unknown): OnboardingPersonaDomain | "" {
  const normalized = normalizeText(value).toLowerCase();
  return ONBOARDING_PERSONA_DOMAINS.includes(normalized as OnboardingPersonaDomain)
    ? normalized as OnboardingPersonaDomain
    : "";
}

function normalizePriority(value: unknown): OnboardingSemanticPriority {
  const normalized = normalizeText(value).toLowerCase();
  return ONBOARDING_SEMANTIC_PRIORITY_VALUES.includes(normalized as OnboardingSemanticPriority)
    ? normalized as OnboardingSemanticPriority
    : "medium";
}

function normalizeStability(value: unknown): OnboardingFactStability {
  const normalized = normalizeText(value).toLowerCase();
  return ONBOARDING_STABILITY_VALUES.includes(normalized as OnboardingFactStability)
    ? normalized as OnboardingFactStability
    : "unknown";
}

function normalizeTimeScope(value: unknown): OnboardingTimeScope {
  const normalized = normalizeText(value).toLowerCase();
  return ONBOARDING_TIME_SCOPE_VALUES.includes(normalized as OnboardingTimeScope)
    ? normalized as OnboardingTimeScope
    : "unknown";
}

function normalizeSuggestedKind(value: unknown): OnboardingCompanionKind | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "status" || normalized === "pattern" || normalized === "preference" || normalized === "boundary" || normalized === "next") {
    return normalized;
  }
  return "";
}

function normalizeSuggestedSlot(value: unknown): OnboardingSlotId | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "current_status" || normalized === "rhythm" || normalized === "preference" || normalized === "boundary" || normalized === "next") {
    return normalized;
  }
  return "";
}

function normalizeConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (numeric <= 0) {
    return 0;
  }
  if (numeric >= 1) {
    return 1;
  }
  return Math.round(numeric * 100) / 100;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  return fallback;
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/gu)
      : [];
  for (const raw of rawItems) {
    const normalized = truncateSentence(String(raw || "").replace(/^\s*-\s*/u, ""), maxLength);
    if (!normalized) {
      continue;
    }
    const signature = normalized.toLowerCase();
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    items.push(normalized);
    if (items.length >= maxItems) {
      break;
    }
  }
  return items;
}

function truncateSentence(value: unknown, maxLength: number): string {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/[，。；,;:\s]+$/u, "")}…`;
}

export {
  asRecord,
  normalizeText,
  parseSemanticJson,
  type JsonObject,
};
