import {
  maybeExtractCompanionMemorySemantic,
  type CompanionMemorySemanticConfig,
  type CompanionMemorySemanticInput,
} from "../companion-memory/semantic";

export type OnboardingSemanticConfig = CompanionMemorySemanticConfig;
export type OnboardingSemanticInput = CompanionMemorySemanticInput;

export function maybeExtractOnboardingSemantic(
  config: OnboardingSemanticConfig = {},
  input: OnboardingSemanticInput = {},
) {
  return maybeExtractCompanionMemorySemantic(config, input, "onboarding");
}
