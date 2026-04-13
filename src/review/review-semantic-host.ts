import { spawnSync } from "node:child_process";
import { resolveActiveSemanticReviewHost, type ReviewSemanticHost } from "../core/host-mode";
import { normalizeText, parseSemanticJson } from "./review-semantic-normalize";
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
  const prompt = buildSemanticPrompt(input);
  const model = normalizeText(input?.options?.model || config.reviewSemanticModel);
  const hermesCommand = normalizeText(config.hermesCommand) || "hermes";
  const workspaceRoot = normalizeText(input?.profile?.workspaceRoot || config.workspaceRoot || process.cwd());

  // Hermes currently exposes one-shot semantic generation through `chat -q`.
  // On Windows, very large argv payloads are brittle across shells, so fail
  // closed and let review fall back to deterministic instead of risking a
  // truncated prompt that silently changes the semantic result.
  if (process.platform === "win32" && prompt.length > 6_000) {
    throw new Error("Hermes semantic review prompt is too large for safe Windows CLI argument transport");
  }

  const args = ["chat", "-Q", "-q", prompt];
  if (model) {
    args.push("--model", model);
  }

  const useShell = process.platform === "win32" && /\.(cmd|bat)$/iu.test(hermesCommand);
  const result = spawnSync(hermesCommand, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    shell: useShell,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error instanceof Error) {
    throw new Error(`Hermes semantic review failed: ${result.error.message}`);
  }
  if (result.signal === "SIGTERM" || result.signal === "SIGKILL") {
    throw new Error(`Hermes semantic review timed out after ${timeoutMs}ms`);
  }
  if (result.status !== 0) {
    const detail = normalizeText(result.stderr) || normalizeText(result.stdout) || `exit ${String(result.status)}`;
    throw new Error(`Hermes semantic review failed: ${detail}`);
  }

  const output = normalizeText(result.stdout);
  if (!output) {
    throw new Error("Hermes semantic review returned empty text");
  }
  return parseSemanticJson(output);
}
