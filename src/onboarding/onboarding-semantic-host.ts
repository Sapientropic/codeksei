import { normalizeReviewSemanticHost, type ReviewSemanticHost } from "../core/config-value-types";
import { normalizeText } from "../core/semantic-json";
import { resolveHostMode, type HostModeConfigInput } from "../core/host-mode-resolution";
import { runCodexSemanticJson, runHermesSemanticJson } from "../runtime/semantic-json-runtime";
import {
  buildOnboardingSemanticPrompt,
  type OnboardingSemanticConfig,
  type OnboardingSemanticInput,
} from "./onboarding-semantic-prompt";

export interface OnboardingSemanticHostAdapter {
  host: Exclude<ReviewSemanticHost, "auto" | "deterministic">;
  run(
    config: OnboardingSemanticConfig,
    input: OnboardingSemanticInput,
    timeoutMs: number,
  ): Promise<Record<string, unknown>>;
}

interface OnboardingSemanticHostConfigInput extends HostModeConfigInput {
  onboardingSemanticHost?: unknown;
  reviewSemanticHost?: unknown;
}

export function resolveOnboardingSemanticHostAdapter(
  config: OnboardingSemanticConfig = {},
): OnboardingSemanticHostAdapter | null {
  const host = resolveActiveOnboardingSemanticHost(config);
  if (host === "deterministic") {
    return null;
  }
  if (host === "hermes") {
    return {
      host,
      run: runHermesOnboardingSemantic,
    };
  }
  return {
    host: "codex",
    run: runCodexOnboardingSemantic,
  };
}

export function resolveActiveOnboardingSemanticHost(
  config: OnboardingSemanticHostConfigInput = {},
): Exclude<ReviewSemanticHost, "auto"> {
  const requested = resolveRequestedOnboardingSemanticHost(config);
  if (requested === "deterministic" || requested === "codex" || requested === "hermes") {
    return requested;
  }
  return resolveHostMode(config).profile === "hosted-hermes-weixin" ? "hermes" : "codex";
}

export async function runCodexOnboardingSemantic(
  config: OnboardingSemanticConfig = {},
  input: OnboardingSemanticInput = {},
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return runCodexSemanticJson(config, {
    label: "onboarding semantic extraction",
    model: normalizeText(input?.options?.model || config.onboardingSemanticModel || config.reviewSemanticModel),
    prompt: buildOnboardingSemanticPrompt(input),
    timeoutMs,
    workspaceRoot: input?.profile?.workspaceRoot || config.workspaceRoot || process.cwd(),
  });
}

export async function runHermesOnboardingSemantic(
  config: OnboardingSemanticConfig = {},
  input: OnboardingSemanticInput = {},
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return runHermesSemanticJson(config, {
    label: "onboarding semantic extraction",
    model: normalizeText(input?.options?.model || config.onboardingSemanticModel || config.reviewSemanticModel),
    prompt: buildOnboardingSemanticPrompt(input),
    timeoutMs,
    workspaceRoot: input?.profile?.workspaceRoot || config.workspaceRoot || process.cwd(),
  });
}

function resolveRequestedOnboardingSemanticHost(
  config: OnboardingSemanticHostConfigInput = {},
): ReviewSemanticHost {
  const onboardingHost = normalizeOptionalSemanticHost(config.onboardingSemanticHost);
  if (onboardingHost) {
    return onboardingHost;
  }
  return normalizeReviewSemanticHost(config.reviewSemanticHost);
}

function normalizeOptionalSemanticHost(value: unknown): ReviewSemanticHost | "" {
  const normalized = normalizeText(value);
  return normalized ? normalizeReviewSemanticHost(normalized) : "";
}
