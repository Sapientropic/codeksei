import * as fs from "node:fs";
import * as path from "node:path";

import { logWarn } from "../core/logging";
import { normalizeText } from "../contracts/text-normalization";
import {
  PROACTIVE_RESPONSE_OUTCOMES,
  type ProactiveDecision,
  type ProactiveOutcomeLogEntry,
  type ProactiveRecentOutcome,
  type ProactiveResponseOutcome,
} from "./contracts";

export interface ProactiveOutcomeLogConfig {
  stateDir?: unknown;
}

export interface ProactiveOutcomeLogTarget {
  targetKey: string;
}

export function readRecentProactiveOutcomes(
  config: ProactiveOutcomeLogConfig,
  target: ProactiveOutcomeLogTarget,
  limit = 8,
): ProactiveRecentOutcome[] {
  const filePath = resolveProactiveOutcomeLogPath(config, target);
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  try {
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/gu)
      .filter(Boolean)
      .slice(-Math.max(1, limit))
      .map((line) => JSON.parse(line) as Partial<ProactiveOutcomeLogEntry>)
      .map((entry) => ({
        createdAt: normalizeText(entry.createdAt),
        interventionLevel: normalizeText(entry.interventionLevel),
        reasonCode: normalizeText(entry.reasonCode),
        responseOutcome: normalizeText(entry.responseOutcome),
      }))
      .filter((entry) => entry.createdAt || entry.responseOutcome);
  } catch (error) {
    logWarn("[codeksei] proactive outcome read skipped:", error);
    return [];
  }
}

export function writeProactiveOutcomeLogEntry(
  config: ProactiveOutcomeLogConfig,
  target: ProactiveOutcomeLogTarget,
  entry: ProactiveOutcomeLogEntry,
): boolean {
  const filePath = resolveProactiveOutcomeLogPath(config, target);
  if (!filePath) {
    return false;
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
    return true;
  } catch (error) {
    logWarn("[codeksei] proactive outcome write skipped:", error);
    return false;
  }
}

export function writeProactiveOutcomeFeedback(
  config: ProactiveOutcomeLogConfig,
  target: ProactiveOutcomeLogTarget,
  {
    actualResult,
    decisionId,
    feedbackText = "",
    responseOutcome = "",
  }: {
    actualResult: string;
    decisionId: string;
    feedbackText?: string;
    responseOutcome?: string;
  },
): boolean {
  const normalizedDecisionId = normalizeText(decisionId);
  if (!normalizedDecisionId) {
    return false;
  }
  return writeProactiveOutcomeLogEntry(config, target, {
    actualResult: normalizeText(actualResult),
    createdAt: new Date().toISOString(),
    decisionId: normalizedDecisionId,
    feedbackText: normalizeText(feedbackText),
    interventionLevel: "",
    model: {
      fallbackReason: "",
      host: "deterministic",
      model: "",
      used: false,
    },
    nextWakePolicy: {
      mode: "keep_existing",
      reason: "Outcome feedback was recorded without a decision snapshot.",
    },
    reasonCode: "",
    responseOutcome: normalizeProactiveResponseOutcome(responseOutcome),
    suggestedMessage: "",
    targetKey: target.targetKey,
  });
}

export function buildProactiveOutcomeLogEntry({
  actualResult,
  decision,
  feedbackText = "",
  responseOutcome = "",
  targetKey,
}: {
  actualResult: string;
  decision: ProactiveDecision;
  feedbackText?: string;
  responseOutcome?: string;
  targetKey: string;
}): ProactiveOutcomeLogEntry {
  return {
    actualResult: normalizeText(actualResult),
    createdAt: new Date().toISOString(),
    decisionId: decision.decisionId,
    feedbackText: normalizeText(feedbackText),
    interventionLevel: decision.interventionLevel,
    model: decision.model,
    nextWakePolicy: decision.nextWakePolicy,
    reasonCode: decision.reasonCode,
    responseOutcome: normalizeProactiveResponseOutcome(responseOutcome),
    suggestedMessage: decision.suggestedMessage,
    targetKey,
  };
}

export function normalizeProactiveResponseOutcome(value: unknown): ProactiveResponseOutcome | "" {
  const normalized = normalizeText(value).toLowerCase();
  return PROACTIVE_RESPONSE_OUTCOMES.includes(normalized as ProactiveResponseOutcome)
    ? normalized as ProactiveResponseOutcome
    : "";
}

export function resolveProactiveOutcomeLogPath(
  config: ProactiveOutcomeLogConfig,
  target: ProactiveOutcomeLogTarget,
): string {
  const stateDir = normalizeText(config.stateDir);
  const targetKey = normalizeText(target.targetKey);
  if (!stateDir || !targetKey) {
    return "";
  }
  return path.join(stateDir, "proactive", "outcomes", `${sanitizeTargetKey(targetKey)}.jsonl`);
}

function sanitizeTargetKey(targetKey: string): string {
  return normalizeText(targetKey).replace(/[\\/:*?"<>|]+/gu, "_");
}
