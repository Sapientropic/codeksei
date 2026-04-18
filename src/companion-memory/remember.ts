import * as crypto from "node:crypto";
import * as fs from "node:fs";

import { resolveCheckinTarget } from "../checkin";
import { bestEffortRefreshContextBoard, type ContextBoardConfig } from "../context/board";
import { normalizeText } from "../core/text-normalization";
import {
  ensureDurableNoteSections,
  resolveDurableNoteRoute,
  type ResolvedDurableNoteRoute,
} from "../notes/durable-note-schema";
import { findSectionRange } from "../notes/note-sync";
import { writeForeignTextDocument } from "../state/json-state";
import {
  COMPANION_MEMORY_SOURCE_VALUES,
  type CompanionMemoryKind,
  type CompanionMemorySlotId,
  type CompanionMemorySource,
  type CompanionPersonaDomain,
} from "./contracts";
import {
  maybeExtractCompanionMemorySemantic,
} from "./semantic";
import type { CompanionMemorySemanticConfig } from "./semantic-prompt";
import type {
  CompanionMemorySemanticFact,
  CompanionMemorySemanticGap,
  CompanionMemorySemanticResult,
} from "./semantic-normalize";
import {
  createCompanionMemoryRuntimeStateStore,
  type CompanionMemoryPatternCandidate,
  type CompanionMemoryRuntimeState,
} from "./runtime-state";
import {
  extractCompanionProfileSignalUpdatesFromText,
} from "./profile-signals";
import { mergeCompanionProfileSignals } from "./profile-signal-contracts";
import { createSessionStore } from "../session/session-store-factory";

export interface CompanionMemoryRuntimeConfig extends ContextBoardConfig, CompanionMemorySemanticConfig {
  accountId?: string;
  cliIdempotencyLedgerFile?: string;
}

export type CompanionRememberStatus = "noop" | "updated" | "deferred";

export interface CompanionMemoryWrite {
  confidence?: number;
  domain?: CompanionPersonaDomain | "";
  isCorrection?: boolean;
  kind: CompanionMemoryKind;
  replaces?: string[];
  slotId: CompanionMemorySlotId;
  source: "deterministic" | "semantic";
  text: string;
}

export interface CompanionMemoryRememberResult {
  boardRefreshed: boolean;
  gaps: CompanionMemorySemanticGap[];
  noteFiles: string[];
  reasons: string[];
  state: CompanionMemoryRuntimeState;
  status: CompanionRememberStatus;
  updatedSlots: CompanionMemorySlotId[];
  writes: CompanionMemoryWrite[];
}

interface CompanionProfileSnapshot {
  boundary: string[];
  current_status: string[];
  next: string[];
  preference: string[];
  rhythm: string[];
}

const MIN_SEMANTIC_CONFIDENCE = 0.55;
const MAX_RECENT_HASHES = 64;
const MAX_RECENT_WRITES = 20;
const MAX_PATTERN_CANDIDATES_PER_SLOT = 12;

const BOUNDARY_RE = /(不要|别|不能|先别|必须先|不要在|别在|先问过|先问我|不能碰|别碰|不要碰)/u;
const PREFERENCE_RE = /(喜欢|希望|更喜欢|最好|简短|详细|直接|温柔|主动|被动|数据|感受|别太|不要太|少一点|多一点|短一点|长一点|英文|英语|中文|english|chinese|mandarin|代词|pronoun|称呼我|叫我|he\/him|she\/her|they\/them)/iu;
const RHYTHM_RE = /(\d{1,2}[:点时]\d{0,2}|早上|上午|中午|下午|傍晚|晚上|夜里|凌晨|起床|睡前|睡觉|熬夜|效率高|效率最好|高能|慢热|别打扰|打扰)/u;
const NEXT_RE = /(接下来|下一步|最近要|最近会|明天|今晚|待会|之后|这周|这个周末|马上要|先做|准备去|打算)/u;
const CURRENT_STATUS_RE = /(我是|我做|最近在|现在在|目前在|眼下在|一直在|最头疼|卡在|想解决|想让我帮|我主要|我是男|我是女|男生|女生|男性|女性|male|female|man\b|woman\b|non-?binary)/iu;
const STRONG_LABEL_RE = /(人格|人格类型|mbti|adhd|抑郁症|焦虑症|双相|自闭|神经质|diagnosis|diagnosed)/iu;
const LANGUAGE_RE = /\benglish\b|\bchinese\b|\bmandarin\b|英文|英语|中文|汉语|普通话/iu;
const LANGUAGE_HINT_RE = /(回复|回答|说|讲|聊|交流|沟通|写|用|切换|改用|prefer|reply|respond|speak|talk|write|use|switch|keep)/iu;
const PRONOUN_RE = /(he\/him|she\/her|they\/them|代词|pronoun|叫我他|叫我她|叫我ta|叫我TA|用他|用她|用ta|用TA|称呼我)/iu;

const SLOT_TO_KIND: Record<CompanionMemorySlotId, CompanionMemoryKind> = {
  boundary: "boundary",
  current_status: "status",
  next: "next",
  preference: "preference",
  rhythm: "pattern",
};

const MANAGED_SLOT_NAMES: Record<CompanionMemorySlotId, string> = {
  boundary: "companion-memory-boundary",
  current_status: "companion-memory-current-status",
  next: "companion-memory-next",
  preference: "companion-memory-preference",
  rhythm: "companion-memory-rhythm",
};

export async function rememberCompanionMemory(
  config: CompanionMemoryRuntimeConfig,
  {
    options = {},
    refreshBoard = true,
    source,
    state,
    text,
    userId,
    workspaceRoot = config.workspaceRoot,
  }: {
    options?: Record<string, unknown>;
    refreshBoard?: boolean;
    source: CompanionMemorySource;
    state?: unknown;
    text: string;
    userId: string;
    workspaceRoot?: unknown;
  },
  now: Date = new Date(),
): Promise<CompanionMemoryRememberResult> {
  const normalizedText = normalizeText(text);
  const runtimeStore = createCompanionMemoryRuntimeStateStore(config, userId);
  const currentRuntimeState = runtimeStore.getState();
  const normalizedSource = normalizeCompanionMemorySource(source);
  if (!normalizedText) {
    return {
      boardRefreshed: false,
      gaps: [],
      noteFiles: [],
      reasons: ["missing-text"],
      state: currentRuntimeState,
      status: "noop",
      updatedSlots: [],
      writes: [],
    };
  }

  const processedHash = buildProcessedHash(normalizedSource, normalizedText);
  if (currentRuntimeState.lastProcessedHashes.includes(processedHash)) {
    return {
      boardRefreshed: false,
      gaps: [],
      noteFiles: [],
      reasons: ["duplicate-input"],
      state: currentRuntimeState,
      status: "noop",
      updatedSlots: [],
      writes: [],
    };
  }

  const deterministicWrites = extractCompanionWrites(normalizedText, { source: normalizedSource });
  const currentProfile = collectCompanionProfileSnapshot(config, userId);
  const semanticInput: Parameters<typeof maybeExtractCompanionMemorySemantic>[1] = {
    currentMessage: normalizedText,
    currentProfile,
    deterministicWrites,
    options,
    profile: {
      userId,
      workspaceRoot: normalizeText(workspaceRoot) || process.cwd(),
    },
    runtimeState: currentRuntimeState,
    source: normalizedSource,
  };
  if (state) {
    semanticInput.state = state as Record<string, unknown>;
  }
  const semantic = await maybeExtractCompanionMemorySemantic(
    config,
    semanticInput,
    normalizedSource === "onboarding_turn" ? "onboarding" : "companion",
  );
  const writes = resolveCompanionWrites(semantic.data, deterministicWrites);
  const gaps = semantic.data?.gaps || [];
  const policy = applyCompanionSourcePolicy(currentRuntimeState, writes, normalizedSource, now);

  let boardRefreshed = false;
  let noteFiles: string[] = [];
  let updatedSlots: CompanionMemorySlotId[] = [];
  let status: CompanionRememberStatus = "noop";
  let nextRuntimeState = policy.state;
  const reasons = [...policy.reasons];

  if (policy.durableWrites.length) {
    noteFiles = syncCompanionWrites(config, userId, policy.durableWrites);
    updatedSlots = Array.from(new Set(policy.durableWrites.map((write) => write.slotId)));
    nextRuntimeState = updateRuntimeStateAfterWrites(policy.state, policy.durableWrites, normalizedSource, processedHash, now);
    runtimeStore.setState(nextRuntimeState);
    status = "updated";
    if (refreshBoard && normalizeText(workspaceRoot)) {
      boardRefreshed = Boolean(bestEffortRefreshContextBoard(config, {
        mode: "proactive",
        user: userId,
        workspace: normalizeText(workspaceRoot),
      }));
    }
  } else {
    status = policy.deferred ? "deferred" : "noop";
    nextRuntimeState = policy.deferred
      ? updateRuntimeStateAfterDeferred(policy.state, normalizedSource, now)
      : updateRuntimeStateAfterNoop(policy.state, processedHash, normalizedSource, now);
    runtimeStore.setState(nextRuntimeState);
    if (!reasons.length) {
      reasons.push(status === "deferred" ? "awaiting-pattern-confirmation" : "no-high-value-facts");
    }
  }

  return {
    boardRefreshed,
    gaps,
    noteFiles,
    reasons,
    state: nextRuntimeState,
    status,
    updatedSlots,
    writes: policy.durableWrites,
  };
}

export async function bestEffortRememberCompanionMemory(
  config: CompanionMemoryRuntimeConfig,
  {
    explicitUser = "",
    explicitWorkspace = "",
    options = {},
    refreshBoard = true,
    source,
    state,
    text,
  }: {
    explicitUser?: string;
    explicitWorkspace?: string;
    options?: Record<string, unknown>;
    refreshBoard?: boolean;
    source: CompanionMemorySource;
    state?: unknown;
    text: string;
  },
  now: Date = new Date(),
): Promise<CompanionMemoryRememberResult | null> {
  try {
    const resolution = resolveCheckinTarget({
      accountId: normalizeText(config.accountId),
      config: {
        allowedUserIds: Array.isArray(config.allowedUserIds) ? config.allowedUserIds : [],
        workspaceRoot: normalizeText(config.workspaceRoot),
      },
      explicitUser: normalizeText(explicitUser),
      explicitWorkspace: normalizeText(explicitWorkspace),
      sessionStore: createSessionStore(config.sessionsFile),
    });
    if (!resolution.ok || !resolution.value) {
      return null;
    }
    const rememberArgs: Parameters<typeof rememberCompanionMemory>[1] = {
      options,
      refreshBoard,
      source,
      text,
      userId: resolution.value.senderId,
      workspaceRoot: resolution.value.workspaceRoot,
    };
    if (state) {
      rememberArgs.state = state as Record<string, unknown>;
    }
    return rememberCompanionMemory(config, rememberArgs, now);
  } catch {
    return null;
  }
}

export function extractCompanionWrites(
  text: string,
  {
    source,
  }: {
    source: CompanionMemorySource;
  },
): CompanionMemoryWrite[] {
  const normalizedInput = normalizeText(text);
  if (!normalizedInput) {
    return [];
  }
  const sentences = splitIntoSentences(normalizedInput);
  const writes: CompanionMemoryWrite[] = [];
  const unmatched: string[] = [];

  for (const sentence of sentences) {
    const slots = detectSlots(sentence);
    if (!slots.length) {
      unmatched.push(sentence);
      continue;
    }
    for (const slotId of slots) {
      writes.push({
        kind: SLOT_TO_KIND[slotId],
        slotId,
        source: "deterministic",
        text: sentence,
      });
    }
  }

  // Onboarding is the only lane allowed to promote the first unmatched sentence
  // into a current_status candidate. Ongoing hosted/bridge over-calls must stay
  // conservative so casual chat does not silently become durable truth.
  if (
    source === "onboarding_turn"
    && !writes.some((entry) => entry.slotId === "current_status")
    && (!writes.length || unmatched.length)
  ) {
    const currentStatusCandidate = sentences.find((sentence) => CURRENT_STATUS_RE.test(sentence))
      || unmatched[0]
      || sentences[0]
      || "";
    if (currentStatusCandidate) {
      writes.unshift({
        kind: "status",
        slotId: "current_status",
        source: "deterministic",
        text: currentStatusCandidate,
      });
    }
  }

  return dedupeWrites(writes);
}

function resolveCompanionWrites(
  semantic: CompanionMemorySemanticResult | null,
  deterministicWrites: CompanionMemoryWrite[],
): CompanionMemoryWrite[] {
  const semanticWrites = semantic ? mapSemanticFactsToWrites(semantic) : [];
  if (!semanticWrites.length) {
    return deterministicWrites;
  }
  const coveredSlots = new Set(semanticWrites.map((write) => `${write.slotId}:${normalizeComparable(write.text)}`));
  return dedupeWrites([
    ...semanticWrites,
    ...deterministicWrites.filter((write) => !coveredSlots.has(`${write.slotId}:${normalizeComparable(write.text)}`)),
  ]);
}

function mapSemanticFactsToWrites(result: CompanionMemorySemanticResult): CompanionMemoryWrite[] {
  const writes: CompanionMemoryWrite[] = [];
  for (const fact of [...result.corrections, ...result.facts]) {
    if (!shouldPersistSemanticFact(fact)) {
      continue;
    }
    const slotId = fact.suggestedSlot || mapDomainToSlot(fact.domain);
    if (!slotId) {
      continue;
    }
    writes.push({
      confidence: fact.confidence,
      domain: fact.domain,
      isCorrection: fact.isCorrection,
      kind: fact.suggestedKind || SLOT_TO_KIND[slotId],
      replaces: fact.replaces,
      slotId,
      source: "semantic",
      text: fact.statement,
    });
  }
  return writes;
}

function applyCompanionSourcePolicy(
  currentState: CompanionMemoryRuntimeState,
  writes: CompanionMemoryWrite[],
  source: CompanionMemorySource,
  now: Date,
): {
  deferred: boolean;
  durableWrites: CompanionMemoryWrite[];
  reasons: string[];
  state: CompanionMemoryRuntimeState;
} {
  const reasons: string[] = [];
  const durableWrites: CompanionMemoryWrite[] = [];
  let deferred = false;
  const nextState: CompanionMemoryRuntimeState = {
    ...currentState,
    pendingPatternCandidates: clonePatternCandidateMap(currentState.pendingPatternCandidates),
    recentWrites: currentState.recentWrites.slice(),
    slotFreshness: { ...currentState.slotFreshness },
    lastProcessedHashes: currentState.lastProcessedHashes.slice(),
  };

  for (const write of writes) {
    if (source === "reminder_proactive" && !["next", "preference", "boundary"].includes(write.slotId)) {
      reasons.push(`source-restricted:${write.slotId}`);
      continue;
    }

    if (source === "diary_supplement" && write.kind === "pattern") {
      const candidate = trackPatternCandidate(nextState.pendingPatternCandidates[write.slotId], write, now);
      nextState.pendingPatternCandidates[write.slotId] = candidate.items;
      if (candidate.promoted) {
        durableWrites.push(write);
        reasons.push(`pattern-promoted:${write.slotId}`);
      } else {
        deferred = true;
        reasons.push(`pattern-deferred:${write.slotId}`);
      }
      continue;
    }

    durableWrites.push(write);
  }

  return {
    deferred,
    durableWrites: dedupeWrites(durableWrites),
    reasons: dedupeLines(reasons),
    state: nextState,
  };
}

function syncCompanionWrites(
  config: CompanionMemoryRuntimeConfig,
  userId: string,
  writes: CompanionMemoryWrite[],
): string[] {
  const touchedFiles = new Set<string>();
  const writesBySlot = new Map<CompanionMemorySlotId, CompanionMemoryWrite[]>();
  for (const write of writes) {
    const group = writesBySlot.get(write.slotId) || [];
    group.push(write);
    writesBySlot.set(write.slotId, group);
  }

  for (const [slotId, slotWrites] of writesBySlot.entries()) {
    const route = resolveCompanionRoute(config, userId, SLOT_TO_KIND[slotId]);
    const ensureOptions: { createIfMissing?: boolean; fileTitle?: unknown } = {};
    if (route.createIfMissing) {
      ensureOptions.createIfMissing = true;
    }
    if (route.fileTitle) {
      ensureOptions.fileTitle = route.fileTitle;
    }
    ensureDurableNoteSections(route.filePath, route.sections, ensureOptions);
    writeManagedCompanionSlot(route, slotId, slotWrites);
    touchedFiles.add(route.filePath);
  }

  return Array.from(touchedFiles);
}

function writeManagedCompanionSlot(
  route: ResolvedDurableNoteRoute,
  slotId: CompanionMemorySlotId,
  writes: CompanionMemoryWrite[],
): void {
  const current = fs.readFileSync(route.filePath, "utf8");
  const range = findSectionRange(current, route.section);
  if (!range) {
    return;
  }
  const sectionBody = current.slice(range.contentStart, range.end);
  const managedSlot = route.slot || MANAGED_SLOT_NAMES[slotId];
  const existingManagedLines = extractManagedSlotLines(sectionBody, managedSlot);
  const legacyLines = existingManagedLines.length ? [] : extractLegacySectionLines(sectionBody);
  const baseline = existingManagedLines.length ? existingManagedLines : legacyLines;
  const nextLines = mergeSlotLines(baseline, writes, slotId, route.maxItems);
  if (!nextLines.length) {
    return;
  }
  const renderedBody = route.style === "paragraph"
    ? nextLines.join("\n")
    : nextLines.map((line) => `- ${line}`).join("\n");
  const managedBlock = buildManagedBlock(managedSlot, renderedBody);
  const nextSectionBody = !existingManagedLines.length && legacyLines.length
    ? managedBlock
    : upsertManagedBlock(sectionBody, managedSlot, managedBlock);
  const nextContent = replaceSectionBody(current, range.contentStart, range.end, nextSectionBody);
  if (normalizeLineEnding(nextContent) !== normalizeLineEnding(current)) {
    writeForeignTextDocument(route.filePath, ensureTrailingNewline(nextContent), { encoding: "utf8" });
  }
}

function updateRuntimeStateAfterWrites(
  state: CompanionMemoryRuntimeState,
  writes: CompanionMemoryWrite[],
  source: CompanionMemorySource,
  processedHash: string,
  now: Date,
): CompanionMemoryRuntimeState {
  const updatedAt = now.toISOString();
  const recentWrites = [
    ...writes.map((write) => ({
      source,
      slotId: write.slotId,
      text: normalizeText(write.text),
      updatedAt,
    })),
    ...state.recentWrites,
  ].slice(0, MAX_RECENT_WRITES);
  const slotFreshness = { ...state.slotFreshness };
  for (const write of writes) {
    slotFreshness[write.slotId] = updatedAt;
  }
  const profileSignals = writes.reduce((signals, write) => (
    mergeCompanionProfileSignals(signals, extractCompanionProfileSignalUpdatesFromText(write.text))
  ), state.profileSignals);
  return {
    ...state,
    lastProcessedHashes: appendProcessedHash(state.lastProcessedHashes, processedHash),
    recentWrites,
    slotFreshness,
    profileSignals,
    pendingPatternCandidates: clearPromotedCandidates(state.pendingPatternCandidates, writes),
    lastSource: source,
    lastUpdatedAt: updatedAt,
  };
}

function updateRuntimeStateAfterNoop(
  state: CompanionMemoryRuntimeState,
  processedHash: string,
  source: CompanionMemorySource,
  now: Date,
): CompanionMemoryRuntimeState {
  return {
    ...state,
    lastProcessedHashes: appendProcessedHash(state.lastProcessedHashes, processedHash),
    lastSource: source,
    lastUpdatedAt: now.toISOString(),
  };
}

function updateRuntimeStateAfterDeferred(
  state: CompanionMemoryRuntimeState,
  source: CompanionMemorySource,
  now: Date,
): CompanionMemoryRuntimeState {
  return {
    ...state,
    lastSource: source,
    lastUpdatedAt: now.toISOString(),
  };
}

function appendProcessedHash(items: string[], hash: string): string[] {
  return dedupeLines([hash, ...items]).slice(0, MAX_RECENT_HASHES);
}

function clearPromotedCandidates(
  candidates: CompanionMemoryRuntimeState["pendingPatternCandidates"],
  writes: CompanionMemoryWrite[],
): CompanionMemoryRuntimeState["pendingPatternCandidates"] {
  const next = clonePatternCandidateMap(candidates);
  for (const write of writes) {
    next[write.slotId] = next[write.slotId].filter((item) => normalizeComparable(item.text) !== normalizeComparable(write.text));
  }
  return next;
}

function trackPatternCandidate(
  items: CompanionMemoryPatternCandidate[],
  write: CompanionMemoryWrite,
  now: Date,
): {
  items: CompanionMemoryPatternCandidate[];
  promoted: boolean;
} {
  const normalizedText = normalizeText(write.text);
  const next = items.slice(0, MAX_PATTERN_CANDIDATES_PER_SLOT);
  const index = next.findIndex((item) => normalizeComparable(item.text) === normalizeComparable(normalizedText));
  const nowIso = now.toISOString();
  if (index < 0) {
    next.unshift({
      count: 1,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      text: normalizedText,
    });
    return {
      items: next.slice(0, MAX_PATTERN_CANDIDATES_PER_SLOT),
      promoted: false,
    };
  }

  const current = next[index];
  if (!current) {
    return {
      items: next.slice(0, MAX_PATTERN_CANDIDATES_PER_SLOT),
      promoted: false,
    };
  }
  const updated: CompanionMemoryPatternCandidate = {
    count: current.count + 1,
    firstSeenAt: current.firstSeenAt,
    lastSeenAt: nowIso,
    text: current.text,
  };
  next.splice(index, 1);
  next.unshift(updated);
  return {
    items: next.slice(0, MAX_PATTERN_CANDIDATES_PER_SLOT),
    promoted: updated.count >= 2,
  };
}

function resolveCompanionRoute(
  config: CompanionMemoryRuntimeConfig,
  userId: string,
  kind: CompanionMemoryKind,
): ResolvedDurableNoteRoute {
  return resolveDurableNoteRoute({
    ...config,
    allowedUserIds: [userId],
    senderId: userId,
  }, {
    kind,
    scope: "companion",
  });
}

function collectCompanionProfileSnapshot(
  config: CompanionMemoryRuntimeConfig,
  userId: string,
): CompanionProfileSnapshot {
  return {
    boundary: collectCompanionSlotLines(config, userId, "boundary"),
    current_status: collectCompanionSlotLines(config, userId, "current_status"),
    next: collectCompanionSlotLines(config, userId, "next"),
    preference: collectCompanionSlotLines(config, userId, "preference"),
    rhythm: collectCompanionSlotLines(config, userId, "rhythm"),
  };
}

function collectCompanionSlotLines(
  config: CompanionMemoryRuntimeConfig,
  userId: string,
  slotId: CompanionMemorySlotId,
): string[] {
  try {
    const route = resolveCompanionRoute(config, userId, SLOT_TO_KIND[slotId]);
    if (!fs.existsSync(route.filePath)) {
      return [];
    }
    const content = fs.readFileSync(route.filePath, "utf8");
    const range = findSectionRange(content, route.section);
    if (!range) {
      return [];
    }
    return extractLegacySectionLines(content.slice(range.contentStart, range.end)).slice(0, 6);
  } catch {
    return [];
  }
}

function shouldPersistSemanticFact(fact: CompanionMemorySemanticFact): boolean {
  if (fact.confidence < MIN_SEMANTIC_CONFIDENCE) {
    return false;
  }
  if (fact.domain === "social_circle" && fact.suggestedSlot && !["boundary", "next", "preference"].includes(fact.suggestedSlot)) {
    return false;
  }
  if (fact.domain === "psychometrics") {
    if (fact.suggestedSlot && !["boundary", "preference"].includes(fact.suggestedSlot)) {
      return false;
    }
    if (STRONG_LABEL_RE.test(fact.statement)) {
      return false;
    }
  }
  return Boolean(fact.statement);
}

function mapDomainToSlot(domain: CompanionPersonaDomain): CompanionMemorySlotId {
  switch (domain) {
    case "preferences":
    case "psychometrics":
      return "preference";
    case "social_circle":
      return "boundary";
    case "work":
      return "next";
    case "experiences":
      return "rhythm";
    case "biography":
    default:
      return "current_status";
  }
}

function mergeSlotLines(
  baseline: string[],
  writes: CompanionMemoryWrite[],
  slotId: CompanionMemorySlotId,
  maxItems: number,
): string[] {
  const replacements = writes.flatMap((write) => write.replaces || []);
  const retained = baseline.filter((line) => !matchesReplacement(line, replacements));
  const incoming = dedupeLines(writes.map((write) => write.text));
  const resetCurrentStatus = slotId === "current_status" && writes.some((write) => write.isCorrection);
  return dedupeLines([...incoming, ...(resetCurrentStatus ? [] : retained)]).slice(0, Math.max(1, maxItems || 1));
}

function matchesReplacement(line: string, replacements: string[]): boolean {
  const comparable = normalizeComparable(line);
  return replacements.some((candidate) => {
    const target = normalizeComparable(candidate);
    return target && (comparable === target || comparable.includes(target) || target.includes(comparable));
  });
}

function dedupeWrites(writes: CompanionMemoryWrite[]): CompanionMemoryWrite[] {
  const seen = new Set<string>();
  const deduped: CompanionMemoryWrite[] = [];
  for (const write of writes) {
    const key = `${write.slotId}:${normalizeText(write.text).toLowerCase()}`;
    if (!write.text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(write);
  }
  return deduped;
}

function detectSlots(sentence: string): CompanionMemorySlotId[] {
  const slots: CompanionMemorySlotId[] = [];
  if (BOUNDARY_RE.test(sentence)) {
    slots.push("boundary");
  }
  const hasLanguagePreference = LANGUAGE_RE.test(sentence)
    && (LANGUAGE_HINT_RE.test(sentence) || PREFERENCE_RE.test(sentence));
  if (PREFERENCE_RE.test(sentence) || hasLanguagePreference || PRONOUN_RE.test(sentence)) {
    slots.push("preference");
  }
  if (RHYTHM_RE.test(sentence)) {
    slots.push("rhythm");
  }
  if (NEXT_RE.test(sentence)) {
    slots.push("next");
  }
  if (CURRENT_STATUS_RE.test(sentence)) {
    slots.push("current_status");
  }
  return slots;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/[\n\r]+|(?<=[。！？!?])/u)
    .map((sentence) => normalizeSentence(sentence))
    .filter(Boolean);
}

function normalizeSentence(value: string): string {
  return normalizeText(value).replace(/^[-*]\s+/u, "").replace(/\s+/gu, " ").trim();
}

function extractManagedSlotLines(sectionBody: string, slot: string): string[] {
  const match = buildManagedSlotPattern(slot).exec(sectionBody);
  if (!match?.[1]) {
    return [];
  }
  return extractLegacySectionLines(match[1]);
}

function extractLegacySectionLines(sectionBody: string): string[] {
  return normalizeLineEnding(sectionBody)
    .replace(/<!--[\s\S]*?-->/gu, "\n")
    .split("\n")
    .map((line) => normalizeText(line).replace(/^\s*-\s*/u, ""))
    .filter((line) => line && !/^#+\s/u.test(line));
}

function buildManagedSlotPattern(slot: string): RegExp {
  const escaped = escapeRegExp(slot);
  return new RegExp(`<!--\\s*codeksei-managed:${escaped}:start\\s*-->\\s*([\\s\\S]*?)\\s*<!--\\s*codeksei-managed:${escaped}:end\\s*-->`, "u");
}

function buildManagedBlock(slot: string, body: string): string {
  return [
    `<!-- codeksei-managed:${slot}:start -->`,
    body.trim(),
    `<!-- codeksei-managed:${slot}:end -->`,
  ].join("\n");
}

function upsertManagedBlock(sectionBody: string, slot: string, block: string): string {
  const pattern = buildManagedSlotPattern(slot);
  if (pattern.test(sectionBody)) {
    return sectionBody.replace(pattern, block).trimEnd();
  }
  return [sectionBody.trim(), block].filter(Boolean).join("\n\n").trimEnd();
}

function replaceSectionBody(content: string, start: number, end: number, body: string): string {
  const before = content.slice(0, start).replace(/\s*$/u, "");
  const after = content.slice(end).replace(/^\s*/u, "");
  return [before, body.trim(), after].filter(Boolean).join("\n\n");
}

function normalizeComparable(value: string): string {
  return normalizeText(value).replace(/\s+/gu, " ").toLowerCase();
}

function normalizeLineEnding(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeLines(lines: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const normalized = normalizeText(line);
    if (!normalized) {
      continue;
    }
    const signature = normalizeComparable(normalized);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    result.push(normalized);
  }
  return result;
}

function clonePatternCandidateMap(
  value: CompanionMemoryRuntimeState["pendingPatternCandidates"],
): CompanionMemoryRuntimeState["pendingPatternCandidates"] {
  return {
    boundary: value.boundary.slice(),
    current_status: value.current_status.slice(),
    next: value.next.slice(),
    preference: value.preference.slice(),
    rhythm: value.rhythm.slice(),
  };
}

function normalizeCompanionMemorySource(value: unknown): CompanionMemorySource {
  const normalized = normalizeText(value);
  return COMPANION_MEMORY_SOURCE_VALUES.includes(normalized as CompanionMemorySource)
    ? normalized as CompanionMemorySource
    : "host_user_turn";
}

function buildProcessedHash(source: CompanionMemorySource, text: string): string {
  return crypto.createHash("sha1").update(`${source}\n${normalizeComparable(text)}`).digest("hex");
}
