import * as crypto from "node:crypto";

import { buildCheckinTargetKey, type CheckinResolvedTarget } from "../checkin";
import type { ContextBoardBriefing } from "../context/board";
import { normalizeText } from "../contracts/text-normalization";
import { runCodexSemanticJson, runHermesSemanticJson, runOpenAICompatibleSemanticJson } from "../runtime/semantic-json-runtime";
import { buildProactiveObservationPrompt, buildRedactedObservationSourcePack } from "./observation-prompt";
import { normalizeProactiveObservation } from "./observation-normalize";
import { readReusableProactiveObservation, writeProactiveObservation } from "./observation-store";
import { readRecentProactiveOutcomes } from "./outcome-log";
import {
  normalizeProactiveJudgmentHost,
  type ProactiveJudgmentConfig,
  type ProactiveJudgmentHost,
  type ProactiveJudgmentInput,
  type ProactiveObservation,
} from "./contracts";

export interface ProactiveObservationResult {
  data: ProactiveObservation | null;
  reason: string;
  source: "codex" | "deterministic" | "hermes" | "injected" | "local" | "openai-compatible" | "store";
  used: boolean;
}

interface ProactiveObservationOptions {
  now?: Date;
  reuseMaxAgeMs?: number;
  write?: boolean;
}

interface ObservationHostAdapter {
  host: Exclude<ProactiveJudgmentHost, "auto" | "deterministic">;
  run(
    config: ProactiveJudgmentConfig,
    input: ProactiveJudgmentInput,
    timeoutMs: number,
  ): Promise<Record<string, unknown>>;
}

const DEFAULT_MIN_CONFIDENCE = 0.55;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_REUSE_MAX_AGE_MS = 30 * 60_000;
const DEFAULT_OBSERVATION_ENDPOINT = "http://127.0.0.1:8080/v1";
const DEFAULT_OBSERVATION_MODEL = "gemma-4-E2B-it";

export async function maybeGenerateProactiveObservation(
  config: ProactiveJudgmentConfig = {},
  input: ProactiveJudgmentInput,
  options: ProactiveObservationOptions = {},
): Promise<ProactiveObservationResult> {
  const mode = normalizeText(config.proactiveObservationMode).toLowerCase() || "hybrid";
  if (mode === "deterministic") {
    return { data: null, reason: "disabled", source: "deterministic", used: false };
  }

  const now = options.now || new Date();
  const sourceHash = buildProactiveObservationSourceHash(input);
  const shouldWrite = options.write !== false;
  if (shouldWrite && normalizeText(config.stateDir)) {
    const reusable = readReusableProactiveObservation(config, input.target, {
      maxAgeMs: options.reuseMaxAgeMs || DEFAULT_REUSE_MAX_AGE_MS,
      now,
      sourceHash,
    });
    if (reusable) {
      return {
        data: reusable,
        reason: reusable.usable ? "" : reusable.discardReason,
        source: "store",
        used: reusable.usable,
      };
    }
  }

  const generator = config.proactiveObservationGenerator;
  const adapter = resolveProactiveObservationHostAdapter(config);
  if (typeof generator !== "function" && !adapter) {
    return { data: null, reason: "host-disabled", source: "deterministic", used: false };
  }

  try {
    const activeHost = adapter?.host || resolveActiveProactiveObservationHost(config);
    const raw = typeof generator === "function"
      ? await generator(input)
      : await adapter!.run(config, input, resolveProactiveObservationTimeoutMs(config));
    const data = normalizeProactiveObservation(raw, {
      host: activeHost,
      minConfidence: resolveProactiveObservationMinConfidence(config),
      model: resolveProactiveObservationModel(config),
      now,
      sourceHash,
    });
    if (!data) {
      return { data: null, reason: "empty-or-low-confidence", source: "deterministic", used: false };
    }
    if (shouldWrite && normalizeText(config.stateDir)) {
      writeProactiveObservation(config, input.target, data);
    }
    return {
      data,
      reason: data.usable ? "" : data.discardReason,
      source: typeof generator === "function" ? "injected" : activeHost,
      used: data.usable,
    };
  } catch (error) {
    return {
      data: null,
      reason: error instanceof Error ? error.message : String(error || "unknown error"),
      source: "deterministic",
      used: false,
    };
  }
}

export function buildProactiveObservationSourceHash(input: ProactiveJudgmentInput): string {
  const pack = {
    ...buildRedactedObservationSourcePack(input),
    now: "",
  };
  return crypto.createHash("sha256").update(JSON.stringify(pack)).digest("hex").slice(0, 24);
}

export function buildProactiveObservationInputFromBriefing(
  config: ProactiveJudgmentConfig = {},
  target: Pick<CheckinResolvedTarget, "senderId" | "workspaceRoot">,
  briefing: ContextBoardBriefing,
  now: Date = new Date(),
): ProactiveJudgmentInput {
  const targetKey = buildCheckinTargetKey({
    senderId: target.senderId,
    workspaceRoot: target.workspaceRoot,
  });
  return {
    checkin: {
      lastCompletionAt: briefing.checkin.lastCompletionAt,
      lastCompletionResult: briefing.checkin.lastCompletionResult,
      nextWakeAt: briefing.checkin.nextWakeAt,
      pendingHandoffExists: Boolean(briefing.checkin.pendingHandoff.exists),
    },
    contextBriefing: {
      followupContext: briefing.followupContext,
      stale: briefing.stale,
      staleReasons: [...briefing.staleReasons],
    },
    now: now.toISOString(),
    recentOutcomes: readRecentProactiveOutcomes(config, { targetKey }),
    stateCard: briefing.stateCard,
    target: {
      senderId: target.senderId,
      targetKey,
      workspaceRoot: target.workspaceRoot,
    },
    timezone: normalizeText(config.timezone),
    voiceSignal: undefined,
  };
}

export function resolveProactiveObservationHostAdapter(
  config: ProactiveJudgmentConfig = {},
): ObservationHostAdapter | null {
  const host = resolveActiveProactiveObservationHost(config);
  if (host === "deterministic") {
    return null;
  }
  if (host === "codex") {
    return { host, run: runCodexProactiveObservation };
  }
  if (host === "hermes") {
    return { host, run: runHermesProactiveObservation };
  }
  return { host, run: runOpenAICompatibleProactiveObservation };
}

export function resolveActiveProactiveObservationHost(
  config: ProactiveJudgmentConfig = {},
): Exclude<ProactiveJudgmentHost, "auto"> {
  const mode = normalizeText(config.proactiveObservationMode).toLowerCase();
  if (mode === "deterministic") {
    return "deterministic";
  }
  const requested = normalizeProactiveJudgmentHost(config.proactiveObservationHost);
  if (requested && requested !== "auto") {
    return requested;
  }
  const endpoint = resolveProactiveObservationEndpoint(config);
  if (endpoint) {
    return isLocalEndpoint(endpoint) ? "local" : "openai-compatible";
  }
  return "deterministic";
}

function runOpenAICompatibleProactiveObservation(
  config: ProactiveJudgmentConfig = {},
  input: ProactiveJudgmentInput,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return runOpenAICompatibleSemanticJson(config, {
    apiKey: normalizeText(config.proactiveObservationApiKey),
    endpoint: resolveProactiveObservationEndpoint(config),
    label: "proactive observation",
    model: resolveProactiveObservationModel(config),
    prompt: buildProactiveObservationPrompt(input),
    requestExtraBody: {
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 512,
    },
    timeoutMs,
    workspaceRoot: input.target.workspaceRoot,
  });
}

function runCodexProactiveObservation(
  config: ProactiveJudgmentConfig = {},
  input: ProactiveJudgmentInput,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return runCodexSemanticJson(config, {
    label: "proactive observation",
    model: resolveProactiveObservationModel(config),
    prompt: buildProactiveObservationPrompt(input),
    timeoutMs,
    workspaceRoot: input.target.workspaceRoot,
  });
}

function runHermesProactiveObservation(
  config: ProactiveJudgmentConfig = {},
  input: ProactiveJudgmentInput,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return Promise.resolve(runHermesSemanticJson(config, {
    label: "proactive observation",
    model: resolveProactiveObservationModel(config),
    prompt: buildProactiveObservationPrompt(input),
    timeoutMs,
    workspaceRoot: input.target.workspaceRoot,
  }));
}

function resolveProactiveObservationEndpoint(config: ProactiveJudgmentConfig): string {
  return normalizeText(config.proactiveObservationEndpoint) || DEFAULT_OBSERVATION_ENDPOINT;
}

function resolveProactiveObservationModel(config: ProactiveJudgmentConfig): string {
  return normalizeText(config.proactiveObservationModel) || DEFAULT_OBSERVATION_MODEL;
}

function resolveProactiveObservationTimeoutMs(config: ProactiveJudgmentConfig): number {
  const configured = Number(config.proactiveObservationTimeoutMs);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function resolveProactiveObservationMinConfidence(config: ProactiveJudgmentConfig): number {
  const configured = Number(config.proactiveObservationMinConfidence);
  return Number.isFinite(configured) && configured > 0 ? Math.min(1, configured) : DEFAULT_MIN_CONFIDENCE;
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  } catch {
    return false;
  }
}
