export type OnboardingCompanionKind = "boundary" | "next" | "pattern" | "preference" | "status";

export const ONBOARDING_PERSONA_DOMAINS = [
  "biography",
  "experiences",
  "preferences",
  "social_circle",
  "work",
  "psychometrics",
] as const;

export const ONBOARDING_SEMANTIC_PRIORITY_VALUES = [
  "high",
  "medium",
  "low",
] as const;

export const ONBOARDING_TIME_SCOPE_VALUES = [
  "current",
  "ongoing",
  "near_term",
  "stable",
  "unknown",
] as const;

export const ONBOARDING_STABILITY_VALUES = [
  "fleeting",
  "current",
  "stable",
  "unknown",
] as const;

export type OnboardingPersonaDomain = typeof ONBOARDING_PERSONA_DOMAINS[number];
export type OnboardingSemanticPriority = typeof ONBOARDING_SEMANTIC_PRIORITY_VALUES[number];
export type OnboardingTimeScope = typeof ONBOARDING_TIME_SCOPE_VALUES[number];
export type OnboardingFactStability = typeof ONBOARDING_STABILITY_VALUES[number];
