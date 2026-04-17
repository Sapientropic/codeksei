import {
  asRecord,
  normalizeText,
  parseSemanticJson,
  type JsonObject,
} from "../core/semantic-json";
import type { CompanionMemorySlotId, CompanionMemoryKind, CompanionFactStability, CompanionPersonaDomain, CompanionSemanticPriority, CompanionTimeScope } from "./contracts";
import {
  COMPANION_PERSONA_DOMAINS,
  COMPANION_SEMANTIC_PRIORITY_VALUES,
  COMPANION_STABILITY_VALUES,
  COMPANION_TIME_SCOPE_VALUES,
} from "./contracts";

export interface CompanionMemorySemanticFact {
  confidence: number;
  domain: CompanionPersonaDomain;
  evidence: string;
  isCorrection: boolean;
  replaces: string[];
  stability: CompanionFactStability;
  statement: string;
  suggestedKind: CompanionMemoryKind | "";
  suggestedSlot: CompanionMemorySlotId | "";
  timeScope: CompanionTimeScope;
}

export interface CompanionMemorySemanticGap {
  domain: CompanionPersonaDomain | "";
  priority: CompanionSemanticPriority;
  reason: string;
  slotId: CompanionMemorySlotId | "";
  toneHint: string;
}

export interface CompanionMemoryUnsafeInference {
  domain: CompanionPersonaDomain | "";
  reason: string;
  statement: string;
}

export interface CompanionMemorySemanticResult {
  corrections: CompanionMemorySemanticFact[];
  facts: CompanionMemorySemanticFact[];
  gaps: CompanionMemorySemanticGap[];
  unsafeInferences: CompanionMemoryUnsafeInference[];
}

export function normalizeCompanionMemorySemanticResult(raw: unknown): CompanionMemorySemanticResult | null {
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

export function hasCompanionMemorySemanticPayload(result: CompanionMemorySemanticResult | null): boolean {
  if (!result) {
    return false;
  }
  return Boolean(result.facts.length || result.corrections.length || result.gaps.length);
}

function normalizeSemanticFacts(value: unknown, defaultCorrection: boolean): CompanionMemorySemanticFact[] {
  const facts: CompanionMemorySemanticFact[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const record = asRecord(item);
    const statement = truncateSentence(record.statement, 200);
    const domain = normalizeDomain(record.domain);
    if (!statement || !domain) {
      continue;
    }
    const fact: CompanionMemorySemanticFact = {
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

function normalizeSemanticGaps(value: unknown): CompanionMemorySemanticGap[] {
  const gaps: CompanionMemorySemanticGap[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const record = asRecord(item);
    const reason = truncateSentence(record.reason, 180);
    const slotId = normalizeSuggestedSlot(record.slot_id || record.slotId);
    const domain = normalizeDomain(record.domain);
    if (!reason && !slotId && !domain) {
      continue;
    }
    const gap: CompanionMemorySemanticGap = {
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

function normalizeUnsafeInferences(value: unknown): CompanionMemoryUnsafeInference[] {
  const items: CompanionMemoryUnsafeInference[] = [];
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

function normalizeDomain(value: unknown): CompanionPersonaDomain | "" {
  const normalized = normalizeText(value).toLowerCase();
  return COMPANION_PERSONA_DOMAINS.includes(normalized as CompanionPersonaDomain)
    ? normalized as CompanionPersonaDomain
    : "";
}

function normalizePriority(value: unknown): CompanionSemanticPriority {
  const normalized = normalizeText(value).toLowerCase();
  return COMPANION_SEMANTIC_PRIORITY_VALUES.includes(normalized as CompanionSemanticPriority)
    ? normalized as CompanionSemanticPriority
    : "medium";
}

function normalizeStability(value: unknown): CompanionFactStability {
  const normalized = normalizeText(value).toLowerCase();
  return COMPANION_STABILITY_VALUES.includes(normalized as CompanionFactStability)
    ? normalized as CompanionFactStability
    : "unknown";
}

function normalizeTimeScope(value: unknown): CompanionTimeScope {
  const normalized = normalizeText(value).toLowerCase();
  return COMPANION_TIME_SCOPE_VALUES.includes(normalized as CompanionTimeScope)
    ? normalized as CompanionTimeScope
    : "unknown";
}

function normalizeSuggestedKind(value: unknown): CompanionMemoryKind | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "status" || normalized === "pattern" || normalized === "preference" || normalized === "boundary" || normalized === "next") {
    return normalized;
  }
  return "";
}

function normalizeSuggestedSlot(value: unknown): CompanionMemorySlotId | "" {
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
