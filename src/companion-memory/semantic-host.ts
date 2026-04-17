import { normalizeReviewSemanticHost, type ReviewSemanticHost } from "../core/config-value-types";
import { normalizeText } from "../core/semantic-json";
import { resolveHostMode, type HostModeConfigInput } from "../core/host-mode-resolution";
import { runCodexSemanticJson, runHermesSemanticJson } from "../runtime/semantic-json-runtime";
import {
  buildCompanionMemorySemanticPrompt,
  type CompanionMemorySemanticConfig,
  type CompanionMemorySemanticInput,
} from "./semantic-prompt";

export interface CompanionMemorySemanticHostAdapter {
  host: Exclude<ReviewSemanticHost, "auto" | "deterministic">;
  run(
    config: CompanionMemorySemanticConfig,
    input: CompanionMemorySemanticInput,
    timeoutMs: number,
    lane: "companion" | "onboarding",
  ): Promise<Record<string, unknown>>;
}

interface CompanionMemorySemanticHostConfigInput extends HostModeConfigInput {
  companionSemanticHost?: unknown;
  onboardingSemanticHost?: unknown;
  reviewSemanticHost?: unknown;
}

export function resolveCompanionMemorySemanticHostAdapter(
  config: CompanionMemorySemanticConfig = {},
  lane: "companion" | "onboarding" = "companion",
): CompanionMemorySemanticHostAdapter | null {
  const host = resolveActiveCompanionMemorySemanticHost(config, lane);
  if (host === "deterministic") {
    return null;
  }
  if (host === "hermes") {
    return {
      host,
      run: runHermesCompanionMemorySemantic,
    };
  }
  return {
    host: "codex",
    run: runCodexCompanionMemorySemantic,
  };
}

export function resolveActiveCompanionMemorySemanticHost(
  config: CompanionMemorySemanticHostConfigInput = {},
  lane: "companion" | "onboarding" = "companion",
): Exclude<ReviewSemanticHost, "auto"> {
  const requested = resolveRequestedCompanionMemorySemanticHost(config, lane);
  if (requested === "deterministic" || requested === "codex" || requested === "hermes") {
    return requested;
  }
  return resolveHostMode(config).profile === "hosted-hermes-weixin" ? "hermes" : "codex";
}

export async function runCodexCompanionMemorySemantic(
  config: CompanionMemorySemanticConfig = {},
  input: CompanionMemorySemanticInput = {},
  timeoutMs: number,
  lane: "companion" | "onboarding" = "companion",
): Promise<Record<string, unknown>> {
  return runCodexSemanticJson(config, {
    label: lane === "onboarding" ? "onboarding semantic extraction" : "companion memory extraction",
    model: resolveSemanticModel(config, input, lane),
    prompt: buildCompanionMemorySemanticPrompt(input, lane),
    timeoutMs,
    workspaceRoot: input?.profile?.workspaceRoot || config.workspaceRoot || process.cwd(),
  });
}

export async function runHermesCompanionMemorySemantic(
  config: CompanionMemorySemanticConfig = {},
  input: CompanionMemorySemanticInput = {},
  timeoutMs: number,
  lane: "companion" | "onboarding" = "companion",
): Promise<Record<string, unknown>> {
  return runHermesSemanticJson(config, {
    label: lane === "onboarding" ? "onboarding semantic extraction" : "companion memory extraction",
    model: resolveSemanticModel(config, input, lane),
    prompt: buildCompanionMemorySemanticPrompt(input, lane),
    timeoutMs,
    workspaceRoot: input?.profile?.workspaceRoot || config.workspaceRoot || process.cwd(),
  });
}

function resolveRequestedCompanionMemorySemanticHost(
  config: CompanionMemorySemanticHostConfigInput = {},
  lane: "companion" | "onboarding" = "companion",
): ReviewSemanticHost {
  const primary = lane === "onboarding"
    ? normalizeOptionalSemanticHost(config.onboardingSemanticHost)
    : normalizeOptionalSemanticHost(config.companionSemanticHost);
  if (primary) {
    return primary;
  }
  const inherited = lane === "onboarding"
    ? normalizeOptionalSemanticHost(config.companionSemanticHost)
    : "";
  if (inherited) {
    return inherited;
  }
  return normalizeReviewSemanticHost(config.reviewSemanticHost);
}

function normalizeOptionalSemanticHost(value: unknown): ReviewSemanticHost | "" {
  const normalized = normalizeText(value);
  return normalized ? normalizeReviewSemanticHost(normalized) : "";
}

function resolveSemanticModel(
  config: CompanionMemorySemanticConfig = {},
  input: CompanionMemorySemanticInput = {},
  lane: "companion" | "onboarding" = "companion",
): string {
  const explicitModel = normalizeText(input?.options?.model);
  if (explicitModel) {
    return explicitModel;
  }
  if (lane === "onboarding") {
    return normalizeText(config.onboardingSemanticModel || config.companionSemanticModel || config.reviewSemanticModel);
  }
  return normalizeText(config.companionSemanticModel || config.reviewSemanticModel);
}
