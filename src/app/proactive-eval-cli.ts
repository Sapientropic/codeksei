import * as fs from "node:fs";

import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { normalizeText } from "../core/text-normalization";
import { buildProactiveDecision } from "../proactive/decision";
import {
  maybeGenerateProactiveObservation,
} from "../proactive/observation";
import type {
  ProactiveJudgmentConfig,
  ProactiveJudgmentInput,
  ProactiveReasonCode,
} from "../proactive/contracts";
import { readForeignJsonDocument } from "../state/json-state";

interface ProactiveEvalOptions {
  endpoint: string;
  fixture: string;
  help: boolean;
  model: string;
}

interface ProactiveEvalCase {
  expected: {
    decisionReasonCode?: string;
    observationStateSignal?: string;
    shouldSurface?: boolean;
  };
  id: string;
  input: ProactiveJudgmentInput;
}

type ProactiveEvalConfig = ProactiveJudgmentConfig & Partial<Pick<AppRuntimeConfig, "stateDir" | "timezone" | "workspaceRoot">>;

export async function runProactiveEvalCommand(
  config: ProactiveEvalConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<ProactiveEvalOptions>(args, getCommandArgsSchema("proactiveEval"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("proactive.eval"),
    };
  }
  const fixturePath = requireFixturePath(options.fixture);
  const cases = readFixtureCases(fixturePath);
  const modelOverride = normalizeText(options.model);
  const endpointOverride = normalizeText(options.endpoint);
  const evalConfig: ProactiveEvalConfig = {
    ...config,
    ...(endpointOverride ? { proactiveObservationEndpoint: endpointOverride } : {}),
    ...(modelOverride ? { proactiveObservationModel: modelOverride } : {}),
  };
  const results = [];
  let parseSuccessCount = 0;
  let matchedFields = 0;
  let expectedFields = 0;
  const falsePositiveIds: string[] = [];

  for (const entry of cases) {
    const now = new Date(normalizeText(entry.input.now) || Date.now());
    const observed = await maybeGenerateProactiveObservation(evalConfig, entry.input, {
      now: Number.isNaN(now.getTime()) ? new Date() : now,
      write: false,
    });
    if (observed.data) {
      parseSuccessCount += 1;
    }
    const decision = await buildProactiveDecision(evalConfig, {
      ...entry.input,
      observation: observed.data || undefined,
    });
    const score = scoreCase(entry, observed.data?.stateSignals || [], decision.reasonCode, decision.shouldSurface);
    matchedFields += score.matched;
    expectedFields += score.total;
    if (entry.expected.shouldSurface === false && decision.shouldSurface) {
      falsePositiveIds.push(entry.id);
    }
    results.push({
      decision,
      id: entry.id,
      observation: observed.data,
      observationReason: observed.reason,
      score,
    });
  }

  const fieldAccuracy = expectedFields > 0 ? Math.round((matchedFields / expectedFields) * 100) / 100 : 1;
  return {
    data: {
      cases: results,
      fixture: fixturePath,
      summary: {
        falsePositiveSummary: {
          count: falsePositiveIds.length,
          ids: falsePositiveIds,
        },
        fieldAccuracy,
        parseSuccessCount,
        total: cases.length,
      },
    },
    text: [
      `fixture: ${fixturePath}`,
      `total: ${cases.length}`,
      `parseSuccess: ${parseSuccessCount}/${cases.length}`,
      `fieldAccuracy: ${fieldAccuracy.toFixed(2)}`,
      `falsePositives: ${falsePositiveIds.length}`,
    ].join("\n"),
  };
}

function requireFixturePath(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error("缺少 --fixture <path>。");
  }
  if (!fs.existsSync(normalized)) {
    throw new Error(`找不到 proactive eval fixture: ${normalized}`);
  }
  return normalized;
}

function readFixtureCases(filePath: string): ProactiveEvalCase[] {
  const payload = readForeignJsonDocument<{ cases?: unknown[] }>(filePath, { fallback: { cases: [] } });
  const cases = Array.isArray(payload.cases) ? payload.cases : [];
  return cases.map((entry, index) => normalizeEvalCase(entry, index)).filter((entry): entry is ProactiveEvalCase => Boolean(entry));
}

function normalizeEvalCase(value: unknown, index: number): ProactiveEvalCase | null {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const input = record.input && typeof record.input === "object" && !Array.isArray(record.input)
    ? record.input as ProactiveJudgmentInput
    : null;
  if (!input) {
    return null;
  }
  const expected = record.expected && typeof record.expected === "object" && !Array.isArray(record.expected)
    ? record.expected as ProactiveEvalCase["expected"]
    : {};
  return {
    expected,
    id: normalizeText(record.id) || `case-${index + 1}`,
    input,
  };
}

function scoreCase(
  entry: ProactiveEvalCase,
  stateSignals: string[],
  reasonCode: ProactiveReasonCode,
  shouldSurface: boolean,
): { matched: number; total: number } {
  let matched = 0;
  let total = 0;
  if (entry.expected.observationStateSignal) {
    total += 1;
    matched += stateSignals.includes(entry.expected.observationStateSignal) ? 1 : 0;
  }
  if (entry.expected.decisionReasonCode) {
    total += 1;
    matched += reasonCode === entry.expected.decisionReasonCode ? 1 : 0;
  }
  if (typeof entry.expected.shouldSurface === "boolean") {
    total += 1;
    matched += shouldSurface === entry.expected.shouldSurface ? 1 : 0;
  }
  return { matched, total };
}
