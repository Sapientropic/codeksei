import { normalizeText } from "../core/semantic-json";
import { resolveOnboardingSemanticHostAdapter } from "./onboarding-semantic-host";
import {
  buildOnboardingSemanticGeneratorInput,
  type OnboardingSemanticConfig,
  type OnboardingSemanticInput,
} from "./onboarding-semantic-prompt";
import {
  hasOnboardingSemanticPayload,
  normalizeOnboardingSemanticResult,
} from "./onboarding-semantic-normalize";

const DEFAULT_TIMEOUT_MS = 15_000;

export async function maybeExtractOnboardingSemantic(
  config: OnboardingSemanticConfig = {},
  input: OnboardingSemanticInput = {},
) {
  const currentMessage = normalizeText(input.currentMessage);
  const mode = resolveOnboardingSemanticMode(config);
  const hostAdapter = resolveOnboardingSemanticHostAdapter(config);
  const injectedGenerator = config.onboardingSemanticGenerator;
  const hasInjectedGenerator = typeof injectedGenerator === "function";
  if (!currentMessage || (!hasInjectedGenerator && mode === "deterministic") || (!hasInjectedGenerator && !hostAdapter)) {
    return {
      used: false,
      source: "deterministic",
      reason: mode === "deterministic" ? "disabled" : (!currentMessage ? "missing-text" : "host-disabled"),
      data: null,
    };
  }

  try {
    const raw = hasInjectedGenerator
      ? await injectedGenerator(buildOnboardingSemanticGeneratorInput(config, input))
      : await hostAdapter!.run(config, input, resolveOnboardingSemanticTimeoutMs(config));
    const data = normalizeOnboardingSemanticResult(raw);
    if (!data || !hasOnboardingSemanticPayload(data)) {
      return {
        used: false,
        source: "deterministic",
        reason: "empty-semantic",
        data: null,
      };
    }
    return {
      used: true,
      source: hasInjectedGenerator ? "injected" : hostAdapter!.host,
      reason: "",
      data,
    };
  } catch (error) {
    return {
      used: false,
      source: "deterministic",
      reason: formatErrorMessage(error),
      data: null,
    };
  }
}

function resolveOnboardingSemanticMode(config: OnboardingSemanticConfig = {}): "deterministic" | "hybrid" {
  const explicit = normalizeText(config.onboardingSemanticMode).toLowerCase();
  if (explicit === "deterministic" || explicit === "hybrid") {
    return explicit;
  }
  const inherited = normalizeText(config.reviewSemanticMode).toLowerCase();
  return inherited === "deterministic" ? "deterministic" : "hybrid";
}

function resolveOnboardingSemanticTimeoutMs(config: OnboardingSemanticConfig = {}): number {
  const explicit = Number(config.onboardingSemanticTimeoutMs);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  return DEFAULT_TIMEOUT_MS;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}
