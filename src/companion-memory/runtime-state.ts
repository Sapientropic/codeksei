import * as path from "node:path";
import { z } from "zod";

import { normalizeText } from "../core/text-normalization";
import {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "../state/json-state";
import { COMPANION_MEMORY_SLOT_IDS, type CompanionMemorySlotId } from "./contracts";

const companionMemoryCandidateSchema = z.object({
  count: z.number().int().min(0),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  text: z.string(),
});

const companionMemoryRecentWriteSchema = z.object({
  source: z.string(),
  slotId: z.string(),
  text: z.string(),
  updatedAt: z.string(),
});

export interface CompanionMemoryPatternCandidate {
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  text: string;
}

export interface CompanionMemoryRecentWrite {
  source: string;
  slotId: CompanionMemorySlotId;
  text: string;
  updatedAt: string;
}

export interface CompanionMemoryRuntimeState {
  lastProcessedHashes: string[];
  recentWrites: CompanionMemoryRecentWrite[];
  slotFreshness: Record<CompanionMemorySlotId, string>;
  pendingPatternCandidates: Record<CompanionMemorySlotId, CompanionMemoryPatternCandidate[]>;
  lastSource: string;
  lastUpdatedAt: string;
}

const companionMemoryRuntimeStateSchema = z.object({
  lastProcessedHashes: z.array(z.string()),
  recentWrites: z.array(companionMemoryRecentWriteSchema),
  slotFreshness: z.record(z.string()),
  pendingPatternCandidates: z.record(z.array(companionMemoryCandidateSchema)),
  lastSource: z.string(),
  lastUpdatedAt: z.string(),
});

type RawCompanionMemoryRuntimeState = z.infer<typeof companionMemoryRuntimeStateSchema>;

export interface CompanionMemoryRuntimeStateConfig {
  stateDir?: unknown;
}

export class CompanionMemoryRuntimeStateStore {
  readonly filePath: string;

  constructor({ filePath }: { filePath: string }) {
    this.filePath = filePath;
  }

  getState(): CompanionMemoryRuntimeState {
    const value = readManagedJsonStateFile<RawCompanionMemoryRuntimeState>({
      filePath: this.filePath,
      fallback: createDefaultCompanionMemoryRuntimeState(),
      label: "companion memory state",
      schema: companionMemoryRuntimeStateSchema,
    });
    return normalizeCompanionMemoryRuntimeState(value);
  }

  setState(state: CompanionMemoryRuntimeState): CompanionMemoryRuntimeState {
    const normalized = normalizeCompanionMemoryRuntimeState(state);
    ensureParentDirectory(this.filePath);
    writeManagedJsonStateFile(this.filePath, normalized);
    return normalized;
  }

  reset(): CompanionMemoryRuntimeState {
    const next = createDefaultCompanionMemoryRuntimeState();
    ensureParentDirectory(this.filePath);
    writeManagedJsonStateFile(this.filePath, next);
    return next;
  }
}

export function createDefaultCompanionMemoryRuntimeState(): CompanionMemoryRuntimeState {
  return {
    lastProcessedHashes: [],
    recentWrites: [],
    slotFreshness: createEmptySlotFreshness(),
    pendingPatternCandidates: createEmptyPatternCandidateMap(),
    lastSource: "",
    lastUpdatedAt: "",
  };
}

export function createCompanionMemoryRuntimeStateStore(
  config: CompanionMemoryRuntimeStateConfig,
  userId: unknown,
): CompanionMemoryRuntimeStateStore {
  return new CompanionMemoryRuntimeStateStore({
    filePath: resolveCompanionMemoryRuntimeStateFile(config, userId),
  });
}

export function resolveCompanionMemoryRuntimeStateFile(
  config: CompanionMemoryRuntimeStateConfig,
  userId: unknown,
): string {
  const stateDir = normalizeText(config.stateDir);
  if (!stateDir) {
    throw new Error("缺少 stateDir，无法读写 companion memory state");
  }
  return path.join(stateDir, "companion-memory", `${sanitizeCompanionMemoryUserKey(userId)}.json`);
}

export function sanitizeCompanionMemoryUserKey(userId: unknown): string {
  return normalizeText(userId).replace(/[\\/:*?"<>|]+/gu, "_") || "default";
}

export function normalizeCompanionMemoryRuntimeState(
  value: Partial<CompanionMemoryRuntimeState> | RawCompanionMemoryRuntimeState | Record<string, unknown> = {},
): CompanionMemoryRuntimeState {
  const record = (value && typeof value === "object" && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};
  return {
    lastProcessedHashes: normalizeStringList(record.lastProcessedHashes, 64, 128),
    recentWrites: normalizeRecentWrites(record.recentWrites),
    slotFreshness: normalizeSlotFreshness(record.slotFreshness),
    pendingPatternCandidates: normalizePatternCandidateMap(record.pendingPatternCandidates),
    lastSource: normalizeText(record.lastSource),
    lastUpdatedAt: normalizeText(record.lastUpdatedAt),
  };
}

function normalizeRecentWrites(value: unknown): CompanionMemoryRecentWrite[] {
  const result: CompanionMemoryRecentWrite[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const record = item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    const slotId = normalizeSlotId(record.slotId);
    const text = normalizeText(record.text);
    if (!slotId || !text) {
      continue;
    }
    result.push({
      source: normalizeText(record.source),
      slotId,
      text,
      updatedAt: normalizeText(record.updatedAt),
    });
    if (result.length >= 20) {
      break;
    }
  }
  return result;
}

function normalizeSlotFreshness(value: unknown): Record<CompanionMemorySlotId, string> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const freshness = createEmptySlotFreshness();
  for (const slotId of COMPANION_MEMORY_SLOT_IDS) {
    freshness[slotId] = normalizeText(record[slotId]);
  }
  return freshness;
}

function normalizePatternCandidateMap(value: unknown): Record<CompanionMemorySlotId, CompanionMemoryPatternCandidate[]> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const next = createEmptyPatternCandidateMap();
  for (const slotId of COMPANION_MEMORY_SLOT_IDS) {
    const items: CompanionMemoryPatternCandidate[] = [];
    for (const item of Array.isArray(record[slotId]) ? record[slotId] as unknown[] : []) {
      const candidate = item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const text = normalizeText(candidate.text);
      if (!text) {
        continue;
      }
      items.push({
        count: normalizeCounter(candidate.count),
        firstSeenAt: normalizeText(candidate.firstSeenAt),
        lastSeenAt: normalizeText(candidate.lastSeenAt),
        text,
      });
      if (items.length >= 12) {
        break;
      }
    }
    next[slotId] = items;
  }
  return next;
}

function createEmptySlotFreshness(): Record<CompanionMemorySlotId, string> {
  return {
    boundary: "",
    current_status: "",
    next: "",
    preference: "",
    rhythm: "",
  };
}

function createEmptyPatternCandidateMap(): Record<CompanionMemorySlotId, CompanionMemoryPatternCandidate[]> {
  return {
    boundary: [],
    current_status: [],
    next: [],
    preference: [],
    rhythm: [],
  };
}

function normalizeSlotId(value: unknown): CompanionMemorySlotId | "" {
  const normalized = normalizeText(value);
  return COMPANION_MEMORY_SLOT_IDS.includes(normalized as CompanionMemorySlotId)
    ? normalized as CompanionMemorySlotId
    : "";
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value) ? value : []) {
    const normalized = normalizeText(entry).slice(0, maxLength);
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

function normalizeCounter(value: unknown): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
