import {
  buildSemanticGeneratorInput,
  type SemanticReviewConfig,
  type SemanticReviewInput,
} from "./review-semantic-prompt";
import {
  hasSemanticPayload,
  normalizeSemanticResult,
  normalizeText,
} from "./review-semantic-normalize";
import {
  waitForSemanticTurnCompletion,
} from "./review-semantic-runtime";
import { resolveSemanticReviewHostAdapter } from "./review-semantic-host";

const DEFAULT_TIMEOUT_MS = 120_000;

async function maybeGenerateSemanticReview(config: SemanticReviewConfig = {}, input: SemanticReviewInput = {}) {
  const kind = normalizeText(input?.profile?.kind);
  const mode = normalizeSemanticMode(
    input?.options?.deterministic ? "deterministic" : config.reviewSemanticMode
  );
  const hostAdapter = resolveSemanticReviewHostAdapter(config);
  if (!kind || mode === "deterministic" || !hostAdapter) {
    return {
      used: false,
      source: "deterministic",
      reason: mode === "deterministic"
        ? "disabled"
        : (!kind ? "missing-kind" : "host-disabled"),
      data: null,
    };
  }

  const diaryEntries = Array.isArray(input.diaryEntries) ? input.diaryEntries : [];
  if (!diaryEntries.length) {
    return {
      used: false,
      source: "deterministic",
      reason: "no-diary",
      data: null,
    };
  }

  try {
    const raw = typeof config.reviewSemanticGenerator === "function"
      ? await config.reviewSemanticGenerator(buildSemanticGeneratorInput(config, input))
      : await hostAdapter.run(config, input, normalizeTimeout(config.reviewSemanticTimeoutMs) || DEFAULT_TIMEOUT_MS);
    const data = normalizeSemanticResult(kind, raw);
    if (!data || !hasSemanticPayload(kind, data)) {
      return {
        used: false,
        source: "deterministic",
        reason: "empty-semantic",
        data: null,
      };
    }
    return {
      used: true,
      source: typeof config.reviewSemanticGenerator === "function" ? "injected" : hostAdapter.host,
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

function normalizeSemanticMode(value: unknown): "deterministic" | "hybrid" {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "deterministic" ? "deterministic" : "hybrid";
}

function normalizeTimeout(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

const __testing = {
  waitForSemanticTurnCompletion,
};

export {
  maybeGenerateSemanticReview,
  __testing,
};
