import { normalizeText } from "../core/semantic-json";
import { resolveCompanionMemorySemanticHostAdapter } from "./semantic-host";
import {
  buildCompanionMemorySemanticGeneratorInput,
  type CompanionMemorySemanticConfig,
  type CompanionMemorySemanticInput,
} from "./semantic-prompt";
import {
  hasCompanionMemorySemanticPayload,
  normalizeCompanionMemorySemanticResult,
} from "./semantic-normalize";

const DEFAULT_TIMEOUT_MS = 15_000;

export type {
  CompanionMemorySemanticConfig,
  CompanionMemorySemanticInput,
} from "./semantic-prompt";

export async function maybeExtractCompanionMemorySemantic(
  config: CompanionMemorySemanticConfig = {},
  input: CompanionMemorySemanticInput = {},
  lane: "companion" | "onboarding" = "companion",
) {
  const currentMessage = normalizeText(input.currentMessage);
  const mode = resolveCompanionMemorySemanticMode(config, lane);
  const hostAdapter = resolveCompanionMemorySemanticHostAdapter(config, lane);
  const injectedGenerator = lane === "onboarding"
    ? (config.onboardingSemanticGenerator || config.companionSemanticGenerator)
    : config.companionSemanticGenerator;
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
    const timeoutMs = resolveCompanionMemorySemanticTimeoutMs(config, lane);
    const raw = hasInjectedGenerator
      ? await withCompanionSemanticTimeout(
        injectedGenerator(buildCompanionMemorySemanticGeneratorInput(config, input, lane)),
        timeoutMs,
        lane,
      )
      : await withCompanionSemanticTimeout(
        hostAdapter!.run(config, input, timeoutMs, lane),
        timeoutMs,
        lane,
      );
    const data = normalizeCompanionMemorySemanticResult(raw);
    if (!data || !hasCompanionMemorySemanticPayload(data)) {
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

function resolveCompanionMemorySemanticMode(
  config: CompanionMemorySemanticConfig = {},
  lane: "companion" | "onboarding" = "companion",
): "deterministic" | "hybrid" {
  const primary = lane === "onboarding"
    ? normalizeText(config.onboardingSemanticMode).toLowerCase()
    : normalizeText(config.companionSemanticMode).toLowerCase();
  if (primary === "deterministic" || primary === "hybrid") {
    return primary;
  }
  const fallback = lane === "onboarding"
    ? normalizeText(config.companionSemanticMode).toLowerCase()
    : "";
  if (fallback === "deterministic" || fallback === "hybrid") {
    return fallback;
  }
  const inherited = normalizeText(config.reviewSemanticMode).toLowerCase();
  return inherited === "deterministic" ? "deterministic" : "hybrid";
}

function resolveCompanionMemorySemanticTimeoutMs(
  config: CompanionMemorySemanticConfig = {},
  lane: "companion" | "onboarding" = "companion",
): number {
  const primary = Number(lane === "onboarding" ? config.onboardingSemanticTimeoutMs : config.companionSemanticTimeoutMs);
  if (Number.isFinite(primary) && primary > 0) {
    return primary;
  }
  const fallback = Number(config.companionSemanticTimeoutMs);
  if (lane === "onboarding" && Number.isFinite(fallback) && fallback > 0) {
    return fallback;
  }
  return DEFAULT_TIMEOUT_MS;
}

function withCompanionSemanticTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  lane: "companion" | "onboarding",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${lane} semantic extraction timed out after ${timeoutMs}ms`));
    }, Math.max(1, timeoutMs));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}
