import { resolveActiveSemanticReviewHost, type ReviewSemanticHost } from "../core/host-mode";
import { runHermesSemanticJson } from "../runtime/semantic-json-runtime";
import { normalizeText } from "./review-semantic-normalize";
import {
  buildSemanticPrompt,
  type SemanticReviewConfig,
  type SemanticReviewInput,
} from "./review-semantic-prompt";
import { runCodexSemanticReview } from "./review-semantic-runtime";

export interface SemanticReviewHostAdapter {
  host: Exclude<ReviewSemanticHost, "auto" | "deterministic">;
  run(
    config: SemanticReviewConfig,
    input: SemanticReviewInput,
    timeoutMs: number,
  ): Promise<Record<string, unknown>>;
}

export function resolveSemanticReviewHostAdapter(
  config: SemanticReviewConfig = {},
): SemanticReviewHostAdapter | null {
  const host = resolveActiveSemanticReviewHost(config);
  if (host === "deterministic") {
    return null;
  }
  if (host === "hermes") {
    return {
      host,
      run: runHermesSemanticReview,
    };
  }
  return {
    host: "codex",
    run: runCodexSemanticReview,
  };
}

export async function runHermesSemanticReview(
  config: SemanticReviewConfig = {},
  input: SemanticReviewInput = {},
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return runHermesSemanticJson(config, {
    label: "semantic review",
    model: normalizeText(input?.options?.model || config.reviewSemanticModel),
    prompt: buildSemanticPrompt(input),
    timeoutMs,
    workspaceRoot: normalizeText(input?.profile?.workspaceRoot || config.workspaceRoot || process.cwd()),
  });
}
