import { normalizeText } from "../contracts/text-normalization";
import { runCodexSemanticJson, runHermesSemanticJson, runOpenAICompatibleSemanticJson } from "../runtime/semantic-json-runtime";
import { buildProactiveJudgmentPrompt } from "./prompt";
import {
  normalizeProactiveJudgmentHost,
  type ProactiveJudgmentConfig,
  type ProactiveJudgmentHost,
  type ProactiveJudgmentInput,
} from "./contracts";

export interface ProactiveJudgmentHostAdapter {
  host: Exclude<ProactiveJudgmentHost, "auto" | "deterministic">;
  run(
    config: ProactiveJudgmentConfig,
    input: ProactiveJudgmentInput,
    timeoutMs: number,
  ): Promise<Record<string, unknown>>;
}

export function resolveProactiveJudgmentHostAdapter(
  config: ProactiveJudgmentConfig = {},
): ProactiveJudgmentHostAdapter | null {
  const host = resolveActiveProactiveJudgmentHost(config);
  if (host === "deterministic") {
    return null;
  }
  if (host === "codex") {
    return { host, run: runCodexProactiveJudgment };
  }
  if (host === "hermes") {
    return { host, run: runHermesProactiveJudgment };
  }
  return { host, run: runOpenAICompatibleProactiveJudgment };
}

export function resolveActiveProactiveJudgmentHost(
  config: ProactiveJudgmentConfig = {},
): Exclude<ProactiveJudgmentHost, "auto"> {
  const mode = normalizeText(config.proactiveJudgmentMode).toLowerCase();
  if (mode === "deterministic") {
    return "deterministic";
  }
  const requested = normalizeProactiveJudgmentHost(config.proactiveJudgmentHost);
  if (requested && requested !== "auto") {
    return requested;
  }
  const endpoint = normalizeText(config.proactiveJudgmentEndpoint);
  if (endpoint) {
    return isLocalEndpoint(endpoint) ? "local" : "openai-compatible";
  }
  return "deterministic";
}

async function runOpenAICompatibleProactiveJudgment(
  config: ProactiveJudgmentConfig = {},
  input: ProactiveJudgmentInput,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return runOpenAICompatibleSemanticJson(config, {
    label: "proactive judgment",
    model: normalizeText(config.proactiveJudgmentModel),
    prompt: buildProactiveJudgmentPrompt(input),
    timeoutMs,
    workspaceRoot: input.target.workspaceRoot,
  });
}

async function runCodexProactiveJudgment(
  config: ProactiveJudgmentConfig = {},
  input: ProactiveJudgmentInput,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return runCodexSemanticJson(config, {
    label: "proactive judgment",
    model: normalizeText(config.proactiveJudgmentModel),
    prompt: buildProactiveJudgmentPrompt(input),
    timeoutMs,
    workspaceRoot: input.target.workspaceRoot,
  });
}

async function runHermesProactiveJudgment(
  config: ProactiveJudgmentConfig = {},
  input: ProactiveJudgmentInput,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return runHermesSemanticJson(config, {
    label: "proactive judgment",
    model: normalizeText(config.proactiveJudgmentModel),
    prompt: buildProactiveJudgmentPrompt(input),
    timeoutMs,
    workspaceRoot: input.target.workspaceRoot,
  });
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  } catch {
    return false;
  }
}
