import * as path from "node:path";
import { z } from "zod";

import { COMPANION_MEMORY_SLOT_IDS, type CompanionMemorySlotId } from "../companion-memory/contracts";
import { normalizeText } from "../core/text-normalization";
import {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "../state/json-state";
import { type OnboardingPersonaDomain } from "./onboarding-contracts";

export const ONBOARDING_SLOT_IDS = COMPANION_MEMORY_SLOT_IDS;

export const ONBOARDING_STATUS_VALUES = [
  "not_started",
  "in_progress",
  "ready",
  "followup_needed",
] as const;

export type OnboardingSlotId = CompanionMemorySlotId;
export type OnboardingStatus = typeof ONBOARDING_STATUS_VALUES[number];

export interface OnboardingSlotCoverage {
  boundary: number;
  current_status: number;
  next: number;
  preference: number;
  rhythm: number;
}

export type OnboardingDomainCoverage = Record<OnboardingPersonaDomain, number>;

export interface OnboardingCoverage {
  domains: OnboardingDomainCoverage;
  slots: OnboardingSlotCoverage;
}

export interface OnboardingState {
  coverage: OnboardingCoverage;
  missingSlots: OnboardingSlotId[];
  sessionId: string;
  status: OnboardingStatus;
  turnCount: number;
  updatedAt: string;
}

export const onboardingStateSchema = z.object({
  coverage: z.unknown(),
  missingSlots: z.array(z.string()),
  sessionId: z.string(),
  status: z.enum(ONBOARDING_STATUS_VALUES),
  turnCount: z.number().int().min(0),
  updatedAt: z.string(),
});

type RawOnboardingState = z.infer<typeof onboardingStateSchema>;

export interface OnboardingStateConfig {
  stateDir?: unknown;
}

export class OnboardingStateStore {
  readonly filePath: string;

  constructor({ filePath }: { filePath: string }) {
    this.filePath = filePath;
  }

  getState(): OnboardingState {
    const value = readManagedJsonStateFile<RawOnboardingState>({
      filePath: this.filePath,
      fallback: createDefaultOnboardingState(),
      label: "onboarding state",
      schema: onboardingStateSchema,
    });
    return normalizeOnboardingState(value);
  }

  reset(): OnboardingState {
    const next = createDefaultOnboardingState();
    ensureParentDirectory(this.filePath);
    writeManagedJsonStateFile(this.filePath, next);
    return next;
  }

  setState(state: OnboardingState): OnboardingState {
    const normalized = normalizeOnboardingState(state);
    ensureParentDirectory(this.filePath);
    writeManagedJsonStateFile(this.filePath, normalized);
    return normalized;
  }
}

export function createDefaultOnboardingCoverage(): OnboardingCoverage {
  return {
    domains: createDefaultOnboardingDomainCoverage(),
    slots: createDefaultOnboardingSlotCoverage(),
  };
}

export function createDefaultOnboardingSlotCoverage(): OnboardingSlotCoverage {
  return {
    boundary: 0,
    current_status: 0,
    next: 0,
    preference: 0,
    rhythm: 0,
  };
}

export function createDefaultOnboardingDomainCoverage(): OnboardingDomainCoverage {
  return {
    biography: 0,
    experiences: 0,
    preferences: 0,
    psychometrics: 0,
    social_circle: 0,
    work: 0,
  };
}

export function createDefaultOnboardingState(): OnboardingState {
  return {
    coverage: createDefaultOnboardingCoverage(),
    missingSlots: [...ONBOARDING_SLOT_IDS],
    sessionId: "",
    status: "not_started",
    turnCount: 0,
    updatedAt: "",
  };
}

export function normalizeOnboardingState(state: {
  coverage?: unknown;
  missingSlots?: unknown;
  sessionId?: unknown;
  status?: unknown;
  turnCount?: unknown;
  updatedAt?: unknown;
} = {}): OnboardingState {
  const coverage = normalizeOnboardingCoverage(state.coverage);
  return {
    coverage,
    missingSlots: computeMissingSlots(coverage),
    sessionId: normalizeText(state.sessionId),
    status: normalizeOnboardingStatus(state.status),
    turnCount: normalizeCounter(state.turnCount),
    updatedAt: normalizeText(state.updatedAt),
  };
}

export function normalizeOnboardingCoverage(value: unknown): OnboardingCoverage {
  const record = isRecord(value) ? value : {};
  const slotsRecord = isRecord(record.slots) ? record.slots : record;
  const domainsRecord = isRecord(record.domains) ? record.domains : {};
  return {
    domains: {
      biography: normalizeCounter(domainsRecord.biography),
      experiences: normalizeCounter(domainsRecord.experiences),
      preferences: normalizeCounter(domainsRecord.preferences),
      psychometrics: normalizeCounter(domainsRecord.psychometrics),
      social_circle: normalizeCounter(domainsRecord.social_circle),
      work: normalizeCounter(domainsRecord.work),
    },
    slots: {
      boundary: normalizeCounter(slotsRecord.boundary),
      current_status: normalizeCounter(slotsRecord.current_status),
      next: normalizeCounter(slotsRecord.next),
      preference: normalizeCounter(slotsRecord.preference),
      rhythm: normalizeCounter(slotsRecord.rhythm),
    },
  };
}

export function computeMissingSlots(coverage: OnboardingCoverage): OnboardingSlotId[] {
  return ONBOARDING_SLOT_IDS.filter((slotId) => normalizeCounter(coverage.slots[slotId]) < 1);
}

export function isOnboardingReady(coverage: OnboardingCoverage): boolean {
  return computeMissingSlots(coverage).length === 0;
}

export function resolveOnboardingStateFile(
  config: OnboardingStateConfig,
  userId: unknown,
): string {
  const stateDir = normalizeText(config.stateDir);
  if (!stateDir) {
    throw new Error("缺少 stateDir，无法读写 onboarding state");
  }
  const userKey = sanitizeUserKey(userId);
  return path.join(stateDir, "onboarding", `${userKey}.json`);
}

export function createOnboardingStateStore(
  config: OnboardingStateConfig,
  userId: unknown,
): OnboardingStateStore {
  return new OnboardingStateStore({
    filePath: resolveOnboardingStateFile(config, userId),
  });
}

export function sanitizeUserKey(userId: unknown): string {
  return normalizeText(userId).replace(/[\\/:*?"<>|]+/gu, "_") || "default";
}

export function buildOnboardingCheckinPrompt(
  state: OnboardingState,
): string {
  const preferredGap = resolvePromptGapLabel(resolveNextPromptSlot(state, state.status === "followup_needed"));
  switch (state.status) {
    case "not_started":
      return [
        "This is the first real activation. Do not sound like a survey or a checklist.",
        "Stay in your own voice and persona, but make the opening feel gentle, human, and easy to answer.",
        "Start with one warm line that gets to know what life feels like lately and what they most want help with right now.",
        "If this is obviously a bad moment to start that conversation, output exactly SILENT.",
      ].join("\n");
    case "in_progress":
      return [
        "The onboarding conversation is already underway.",
        "Do not restart it, do not dump a questionnaire, and do not mention onboarding explicitly.",
        `If you speak, gently learn only one thing that is still missing, preferably ${preferredGap}.`,
        "A brief empathic line without a question is allowed. If now is not a good moment, output exactly SILENT.",
      ].join("\n");
    case "followup_needed":
      return [
        "Do not turn this into a long intake.",
        `There are still a few missing details, and the highest-value one is ${preferredGap}.`,
        "At most ask for one missing detail, naturally and lightly. If there is no good opening, output exactly SILENT.",
      ].join("\n");
    case "ready":
    default:
      return "";
  }
}

function normalizeCounter(value: unknown): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeOnboardingStatus(value: unknown): OnboardingStatus {
  const normalized = normalizeText(value);
  return ONBOARDING_STATUS_VALUES.includes(normalized as OnboardingStatus)
    ? normalized as OnboardingStatus
    : "not_started";
}

function resolveNextPromptSlot(state: OnboardingState, followupPriority: boolean): OnboardingSlotId {
  const preferredOrder: OnboardingSlotId[] = followupPriority
    ? ["boundary", "preference", "rhythm", "next", "current_status"]
    : ["current_status", "rhythm", "preference", "boundary", "next"];
  const missing = new Set(state.missingSlots);
  return preferredOrder.find((slotId) => missing.has(slotId))
    || state.missingSlots[0]
    || "current_status";
}

function resolvePromptGapLabel(slotId: OnboardingSlotId): string {
  switch (slotId) {
    case "boundary":
      return "what would make the interaction feel intrusive or cross a line";
    case "preference":
      return "how they prefer you to sound and support them";
    case "rhythm":
      return "when they are available or should be left alone";
    case "next":
      return "the next real thing likely to happen soon";
    case "current_status":
    default:
      return "what life feels like lately and what they most want help with";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
