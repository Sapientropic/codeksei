export const COMPANION_MEMORY_SLOT_IDS = [
  "current_status",
  "rhythm",
  "preference",
  "boundary",
  "next",
] as const;

export const COMPANION_MEMORY_SOURCE_VALUES = [
  "host_user_turn",
  "onboarding_turn",
  "checkin_followup",
  "review_summary",
  "diary_supplement",
  "reminder_proactive",
] as const;

export type CompanionMemorySlotId = typeof COMPANION_MEMORY_SLOT_IDS[number];
export type CompanionMemorySource = typeof COMPANION_MEMORY_SOURCE_VALUES[number];

export type CompanionMemoryKind = "boundary" | "next" | "pattern" | "preference" | "status";

export const COMPANION_PERSONA_DOMAINS = [
  "biography",
  "experiences",
  "preferences",
  "social_circle",
  "work",
  "psychometrics",
] as const;

export const COMPANION_SEMANTIC_PRIORITY_VALUES = [
  "high",
  "medium",
  "low",
] as const;

export const COMPANION_TIME_SCOPE_VALUES = [
  "current",
  "ongoing",
  "near_term",
  "stable",
  "unknown",
] as const;

export const COMPANION_STABILITY_VALUES = [
  "fleeting",
  "current",
  "stable",
  "unknown",
] as const;

export type CompanionPersonaDomain = typeof COMPANION_PERSONA_DOMAINS[number];
export type CompanionSemanticPriority = typeof COMPANION_SEMANTIC_PRIORITY_VALUES[number];
export type CompanionTimeScope = typeof COMPANION_TIME_SCOPE_VALUES[number];
export type CompanionFactStability = typeof COMPANION_STABILITY_VALUES[number];
