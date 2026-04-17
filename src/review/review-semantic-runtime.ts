import {
  runCodexSemanticJson,
  waitForSemanticJsonTurnCompletion,
  type RuntimeSemanticClient,
} from "../runtime/semantic-json-runtime";
import {
  buildSemanticPrompt,
  type SemanticReviewConfig,
  type SemanticReviewInput,
} from "./review-semantic-prompt";
import { normalizeText } from "./review-semantic-normalize";

export async function runCodexSemanticReview(
  config: SemanticReviewConfig = {},
  input: SemanticReviewInput = {},
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return runCodexSemanticJson(config, {
    label: "semantic review",
    model: normalizeText(input?.options?.model || config.reviewSemanticModel),
    prompt: buildSemanticPrompt(input),
    timeoutMs,
    workspaceRoot: input?.profile?.workspaceRoot || config.workspaceRoot || process.cwd(),
  });
}

export function waitForSemanticTurnCompletion(
  client: RuntimeSemanticClient,
  threadId: string,
  timeoutMs: number,
): Promise<string> {
  return waitForSemanticJsonTurnCompletion(client, threadId, timeoutMs, "semantic review");
}
