import * as fs from "node:fs";
import * as path from "node:path";

import { normalizeText } from "../contracts/text-normalization";
import { readForeignJsonDocument, readManagedJsonStateFile, writeManagedJsonStateFile } from "../state/json-state";

export interface ContextPackConfigInput {
  stateDir?: unknown;
  workspaceRoot?: unknown;
}

export interface ContextPackDefinition {
  budgetChars: number;
  content: string;
  cooldownHours: number;
  enabled: boolean;
  id: string;
  modes: string[];
  scope: string;
  triggers: {
    exclude: string[];
    include: string[];
  };
}

export interface EvaluatedContextPack {
  budgetChars: number;
  cooldownUntil: string;
  content: string;
  id: string;
  included: boolean;
  matchedExclude: string[];
  matchedInclude: string[];
  reason: string;
  sourcePath: string;
}

export interface ContextPackEvaluation {
  configPath: string;
  packs: EvaluatedContextPack[];
  statePath: string;
}

interface ContextPackRuntimeState {
  packs: Record<string, {
    lastIncludedAt: string;
  }>;
}

export function evaluateContextPacks(
  config: ContextPackConfigInput,
  {
    mode,
    now = new Date(),
    recordMatches = false,
    scanText,
  }: {
    mode: string;
    now?: Date;
    recordMatches?: boolean;
    scanText: string;
  },
): ContextPackEvaluation {
  const configPath = resolveContextPacksConfigPath(config);
  const statePath = resolveContextPacksStatePath(config);
  const runtimeState = readContextPackRuntimeState(statePath);
  const definitions = readContextPackDefinitions(configPath);
  const normalizedMode = normalizeText(mode).toLowerCase() || "proactive";
  const normalizedScanText = normalizeText(scanText).toLowerCase();
  const packs = definitions.map((pack) => evaluateContextPack(pack, {
    configPath,
    mode: normalizedMode,
    now,
    runtimeState,
    scanText: normalizedScanText,
  }));
  if (recordMatches) {
    writeContextPackRuntimeState(statePath, runtimeState, packs, now);
  }
  return {
    configPath,
    packs,
    statePath,
  };
}

export function resolveContextPacksConfigPath(config: ContextPackConfigInput): string {
  const workspaceRoot = normalizeText(config.workspaceRoot);
  return workspaceRoot ? path.join(workspaceRoot, ".codex", "context-packs.json") : "";
}

export function resolveContextPacksStatePath(config: ContextPackConfigInput): string {
  const stateDir = normalizeText(config.stateDir);
  return stateDir ? path.join(stateDir, "context-packs", "runtime.json") : "";
}

function readContextPackDefinitions(configPath: string): ContextPackDefinition[] {
  if (!configPath || !fs.existsSync(configPath)) {
    return [];
  }
  const document = readForeignJsonDocument<unknown>(configPath, { fallback: null });
  const rawPacks = Array.isArray(document)
    ? document
    : isRecord(document) && Array.isArray(document.packs)
      ? document.packs
      : [];
  return rawPacks
    .map(normalizeContextPackDefinition)
    .filter((pack): pack is ContextPackDefinition => Boolean(pack));
}

function normalizeContextPackDefinition(value: unknown): ContextPackDefinition | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeText(value.id);
  const content = normalizeText(value.content);
  if (!id || !content) {
    return null;
  }
  const triggers = isRecord(value.triggers) ? value.triggers : {};
  return {
    budgetChars: normalizePositiveInteger(value.budgetChars, 1200),
    content,
    cooldownHours: normalizePositiveInteger(value.cooldownHours, 0),
    enabled: value.enabled !== false,
    id,
    modes: normalizeStringList(value.modes).map((entry) => entry.toLowerCase()),
    scope: normalizeText(value.scope) || "workspace",
    triggers: {
      exclude: normalizeStringList(triggers.exclude),
      include: normalizeStringList(triggers.include),
    },
  };
}

function evaluateContextPack(
  pack: ContextPackDefinition,
  {
    configPath,
    mode,
    now,
    runtimeState,
    scanText,
  }: {
    configPath: string;
    mode: string;
    now: Date;
    runtimeState: ContextPackRuntimeState;
    scanText: string;
  },
): EvaluatedContextPack {
  const matchedExclude = matchTriggers(pack.triggers.exclude, scanText);
  const matchedInclude = matchTriggers(pack.triggers.include, scanText);
  const modeAllowed = !pack.modes.length || pack.modes.includes(mode);
  const cooldownUntil = resolveCooldownUntil(pack, configPath, runtimeState, now);
  const content = trimToBudget(pack.content, pack.budgetChars);
  const reason = resolveContextPackReason(pack, {
    cooldownUntil,
    matchedExclude,
    matchedInclude,
    modeAllowed,
  });
  return {
    budgetChars: pack.budgetChars,
    cooldownUntil,
    content,
    id: pack.id,
    included: reason === "matched",
    matchedExclude,
    matchedInclude,
    reason,
    sourcePath: configPath,
  };
}

function resolveContextPackReason(
  pack: ContextPackDefinition,
  {
    cooldownUntil,
    matchedExclude,
    matchedInclude,
    modeAllowed,
  }: {
    cooldownUntil: string;
    matchedExclude: string[];
    matchedInclude: string[];
    modeAllowed: boolean;
  },
): string {
  if (!pack.enabled) {
    return "disabled";
  }
  if (!modeAllowed) {
    return "mode not allowed";
  }
  if (matchedExclude.length) {
    return `exclude trigger matched: ${matchedExclude.join(", ")}`;
  }
  if (pack.triggers.include.length && !matchedInclude.length) {
    return "include trigger not matched";
  }
  if (cooldownUntil) {
    return `cooldown active until ${cooldownUntil}`;
  }
  return "matched";
}

function matchTriggers(triggers: string[], scanText: string): string[] {
  return triggers.filter((trigger) => {
    const normalized = normalizeText(trigger).toLowerCase();
    return Boolean(normalized && scanText.includes(normalized));
  });
}

function trimToBudget(content: string, budgetChars: number): string {
  if (content.length <= budgetChars) {
    return content;
  }
  return `${content.slice(0, Math.max(0, budgetChars - 24)).trim()}...(truncated)`;
}

function readContextPackRuntimeState(statePath: string): ContextPackRuntimeState {
  if (!statePath) {
    return { packs: {} };
  }
  const state = readManagedJsonStateFile<ContextPackRuntimeState>({
    fallback: { packs: {} },
    filePath: statePath,
    label: "context packs runtime state",
    validate: validateContextPackRuntimeState,
  });
  return {
    packs: isRecord(state.packs) ? state.packs : {},
  };
}

function writeContextPackRuntimeState(
  statePath: string,
  state: ContextPackRuntimeState,
  packs: EvaluatedContextPack[],
  now: Date,
): void {
  if (!statePath) {
    return;
  }
  const matched = packs.filter((pack) => pack.included);
  if (!matched.length) {
    return;
  }
  const includedAt = now.toISOString();
  const next: ContextPackRuntimeState = {
    packs: { ...state.packs },
  };
  for (const pack of matched) {
    next.packs[buildContextPackRuntimeKey(pack.sourcePath, pack.id)] = {
      lastIncludedAt: includedAt,
    };
  }
  writeManagedJsonStateFile(statePath, next);
}

function resolveCooldownUntil(
  pack: ContextPackDefinition,
  configPath: string,
  state: ContextPackRuntimeState,
  now: Date,
): string {
  if (!pack.cooldownHours) {
    return "";
  }
  const entry = state.packs[buildContextPackRuntimeKey(configPath, pack.id)];
  const lastIncludedAt = Date.parse(normalizeText(entry?.lastIncludedAt));
  if (!Number.isFinite(lastIncludedAt)) {
    return "";
  }
  const cooldownUntil = lastIncludedAt + pack.cooldownHours * 60 * 60 * 1000;
  return cooldownUntil > now.getTime() ? new Date(cooldownUntil).toISOString() : "";
}

function buildContextPackRuntimeKey(configPath: string, id: string): string {
  return `${configPath}#${id}`;
}

function validateContextPackRuntimeState(value: unknown): true | string {
  if (!isRecord(value)) {
    return "context packs runtime state must be an object";
  }
  if (typeof value.packs !== "undefined" && !isRecord(value.packs)) {
    return "context packs runtime state packs must be an object";
  }
  return true;
}

function normalizeStringList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
