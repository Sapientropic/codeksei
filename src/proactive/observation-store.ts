import * as path from "node:path";

import { buildCheckinTargetKey } from "../checkin";
import { normalizeText } from "../contracts/text-normalization";
import { readManagedJsonStateFile, writeManagedJsonStateFile } from "../state/json-state";
import {
  PROACTIVE_JUDGMENT_HOSTS,
  PROACTIVE_OBSERVATION_MODALITY_HINTS,
  PROACTIVE_OBSERVATION_RISK_VALUES,
  PROACTIVE_OBSERVATION_STATE_SIGNALS,
  PROACTIVE_OBSERVATION_USER_ENERGY_VALUES,
  type ProactiveObservation,
} from "./contracts";

interface ObservationStoreConfig {
  stateDir?: unknown;
}

interface ObservationStoreTarget {
  senderId: string;
  targetKey?: string;
  workspaceRoot: string;
}

interface ReuseObservationOptions {
  maxAgeMs: number;
  now: Date;
  sourceHash: string;
}

interface ProactiveObservationState {
  latest: ProactiveObservation | null;
  recent: ProactiveObservation[];
}

const MAX_RECENT_OBSERVATIONS = 20;

export function readReusableProactiveObservation(
  config: ObservationStoreConfig,
  target: ObservationStoreTarget,
  options: ReuseObservationOptions,
): ProactiveObservation | null {
  const state = readObservationState(config, target);
  const latest = state.latest;
  if (!latest || !latest.usable || latest.sourceHash !== options.sourceHash) {
    return null;
  }
  const createdAtMs = Date.parse(latest.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return null;
  }
  const ageMs = options.now.getTime() - createdAtMs;
  return ageMs >= 0 && ageMs <= options.maxAgeMs ? latest : null;
}

export function writeProactiveObservation(
  config: ObservationStoreConfig,
  target: ObservationStoreTarget,
  observation: ProactiveObservation,
): void {
  const current = readObservationState(config, target);
  const recent = [
    observation,
    ...current.recent.filter((entry) => entry.id !== observation.id),
  ].slice(0, MAX_RECENT_OBSERVATIONS);
  writeManagedJsonStateFile(resolveProactiveObservationStorePath(config, target), {
    latest: observation,
    recent,
  });
}

export function readObservationState(
  config: ObservationStoreConfig,
  target: ObservationStoreTarget,
): ProactiveObservationState {
  const fallback: ProactiveObservationState = { latest: null, recent: [] };
  const raw = readManagedJsonStateFile({
    fallback,
    filePath: resolveProactiveObservationStorePath(config, target),
    label: "proactive observation state",
  });
  return {
    latest: normalizeObservationShape(raw.latest),
    recent: Array.isArray(raw.recent)
      ? raw.recent.map(normalizeObservationShape).filter((entry): entry is ProactiveObservation => Boolean(entry))
      : [],
  };
}

export function resolveProactiveObservationStorePath(
  config: ObservationStoreConfig,
  target: ObservationStoreTarget,
): string {
  const stateDir = normalizeText(config.stateDir);
  if (!stateDir) {
    throw new Error("缺少 stateDir，无法读写 proactive observation");
  }
  return path.join(stateDir, "proactive", "observations", `${sanitizeTargetKey(resolveTargetKey(target))}.json`);
}

function normalizeObservationShape(value: unknown): ProactiveObservation | null {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (record.kind !== "proactive_observation" || record.version !== 1) {
    return null;
  }
  const id = normalizeText(record.id);
  const createdAt = normalizeText(record.createdAt);
  const sourceHash = normalizeText(record.sourceHash);
  const model = normalizeModel(record.model);
  const confidence = normalizeNumber(record.confidence);
  const evidence = normalizeStringList(record.evidence, 6);
  if (!id || !createdAt || !sourceHash || !model || confidence < 0 || !evidence.length) {
    return null;
  }
  const surfaceRisk = normalizeEnum(record.surfaceRisk, PROACTIVE_OBSERVATION_RISK_VALUES);
  const annoyanceRisk = normalizeEnum(record.annoyanceRisk, PROACTIVE_OBSERVATION_RISK_VALUES);
  const userEnergy = normalizeEnum(record.userEnergy, PROACTIVE_OBSERVATION_USER_ENERGY_VALUES);
  return {
    annoyanceRisk: annoyanceRisk || "unknown",
    confidence,
    createdAt,
    currentStateHypothesis: normalizeText(record.currentStateHypothesis),
    discardReason: normalizeText(record.discardReason),
    evidence,
    id,
    kind: "proactive_observation",
    likelyBlocker: normalizeText(record.likelyBlocker),
    memoryCandidates: normalizeMemoryCandidates(record.memoryCandidates),
    modalityHints: normalizeEnumList(record.modalityHints, PROACTIVE_OBSERVATION_MODALITY_HINTS),
    model,
    reentryCandidate: normalizeText(record.reentryCandidate),
    sourceHash,
    stateSignals: normalizeEnumList(record.stateSignals, PROACTIVE_OBSERVATION_STATE_SIGNALS),
    suggestedTone: normalizeText(record.suggestedTone),
    surfaceRisk: surfaceRisk || "unknown",
    usable: record.usable === true,
    userEnergy: userEnergy || "unknown",
    version: 1,
  };
}

function normalizeModel(value: unknown): ProactiveObservation["model"] | null {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const host = normalizeEnum(record.host, PROACTIVE_JUDGMENT_HOSTS);
  const model = normalizeText(record.model);
  if (!host) {
    return null;
  }
  return {
    fallbackReason: normalizeText(record.fallbackReason),
    host,
    model,
    used: record.used === true,
  };
}

function normalizeMemoryCandidates(value: unknown): ProactiveObservation["memoryCandidates"] {
  const candidates: ProactiveObservation["memoryCandidates"] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const record = item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    const slotId = normalizeText(record.slotId);
    const kind = normalizeText(record.kind);
    const text = normalizeText(record.text);
    const evidence = normalizeText(record.evidence);
    const confidence = normalizeNumber(record.confidence);
    if (
      confidence >= 0
      && evidence
      && text
      && (kind === "boundary" || kind === "next" || kind === "pattern" || kind === "preference" || kind === "status")
      && (slotId === "boundary" || slotId === "current_status" || slotId === "next" || slotId === "preference" || slotId === "rhythm")
    ) {
      candidates.push({ confidence, evidence, kind, slotId, text });
    }
  }
  return candidates.slice(0, 5);
}

function normalizeEnumList<T extends readonly string[]>(value: unknown, allowed: T): T[number][] {
  const items: T[number][] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const normalized = normalizeEnum(item, allowed);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      items.push(normalized);
    }
  }
  return items;
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | "" {
  const normalized = normalizeText(value).toLowerCase();
  return allowed.includes(normalized) ? normalized as T[number] : "";
}

function normalizeStringList(value: unknown, maxItems: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : -1;
}

function resolveTargetKey(target: ObservationStoreTarget): string {
  return normalizeText(target.targetKey) || buildCheckinTargetKey({
    senderId: target.senderId,
    workspaceRoot: target.workspaceRoot,
  });
}

function sanitizeTargetKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 120) || "default";
}
