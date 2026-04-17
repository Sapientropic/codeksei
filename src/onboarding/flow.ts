import * as crypto from "node:crypto";
import * as fs from "node:fs";

import type { ContextBoardConfig } from "../context/board";
import { bestEffortRefreshContextBoard } from "../context/board";
import { normalizeText } from "../core/text-normalization";
import {
  ensureDurableNoteSections,
  resolveDurableNoteRoute,
  type ResolvedDurableNoteRoute,
} from "../notes/durable-note-schema";
import { findSectionRange } from "../notes/note-sync";
import { writeForeignTextDocument } from "../state/json-state";
import { maybeExtractOnboardingSemantic } from "./onboarding-semantic";
import type { OnboardingSemanticConfig } from "./onboarding-semantic-prompt";
import type {
  OnboardingPersonaDomain,
  OnboardingCompanionKind,
} from "./onboarding-contracts";
import type {
  OnboardingSemanticFact,
  OnboardingSemanticGap,
  OnboardingSemanticResult,
} from "./onboarding-semantic-normalize";
import {
  createDefaultOnboardingCoverage,
  createOnboardingStateStore,
  isOnboardingReady,
  type OnboardingCoverage,
  type OnboardingSlotCoverage,
  type OnboardingSlotId,
  type OnboardingState,
  type OnboardingStatus,
} from "./state";

export interface OnboardingRuntimeConfig extends ContextBoardConfig, OnboardingSemanticConfig {
  cliIdempotencyLedgerFile?: string;
}

export interface ExtractedOnboardingWrite {
  confidence?: number;
  domain?: OnboardingPersonaDomain | "";
  isCorrection?: boolean;
  kind: OnboardingCompanionKind;
  replaces?: string[];
  slotId: OnboardingSlotId;
  source: "deterministic" | "semantic";
  text: string;
}

export interface OnboardingConversationResult {
  assistantMessage: string;
  noteFiles: string[];
  state: OnboardingState;
  writes: ExtractedOnboardingWrite[];
}

interface CompanionProfileSnapshot {
  boundary: string[];
  current_status: string[];
  next: string[];
  preference: string[];
  rhythm: string[];
}

const MAX_ONBOARDING_TURNS = 8;
const MIN_SEMANTIC_CONFIDENCE = 0.55;

const BOUNDARY_RE = /(不要|别|不能|先别|必须先|不要在|别在|先问过|先问我|不能碰|别碰|不要碰)/u;
const PREFERENCE_RE = /(喜欢|希望|更喜欢|最好|简短|详细|直接|温柔|主动|被动|数据|感受|别太|不要太|少一点|多一点|短一点|长一点)/u;
const RHYTHM_RE = /(\d{1,2}[:点时]\d{0,2}|早上|上午|中午|下午|傍晚|晚上|夜里|凌晨|起床|睡前|睡觉|熬夜|效率高|效率最好|高能|慢热|别打扰|打扰)/u;
const NEXT_RE = /(接下来|下一步|最近要|最近会|明天|今晚|待会|之后|这周|这个周末|马上要|先做|准备去|打算)/u;
const CURRENT_STATUS_RE = /(我是|我做|最近在|现在在|目前在|眼下在|一直在|最头疼|卡在|想解决|想让我帮|我主要)/u;
const STRONG_LABEL_RE = /(人格|人格类型|mbti|adhd|抑郁症|焦虑症|双相|自闭|神经质|diagnosis|diagnosed)/iu;

const SLOT_TO_KIND: Record<OnboardingSlotId, OnboardingCompanionKind> = {
  boundary: "boundary",
  current_status: "status",
  next: "next",
  preference: "preference",
  rhythm: "pattern",
};

const SLOT_PROMPTS: Record<OnboardingSlotId, string[]> = {
  current_status: [
    "先别把自己整理成一张表。你就顺着说说，最近的生活和最占心的那件事，大概是什么样？",
    "我们先不急着定义一切。你这阵子主要在过什么样的日子，脑子里最常挂着哪条线？",
  ],
  rhythm: [
    "我想摸一下你的节奏。你一天里通常什么时候最有精神，什么时候我最好别冒出来？",
    "顺着刚才那条线再说一句就够了: 你一般什么时段比较能动，什么时段我别打扰你？",
  ],
  preference: [
    "如果我要陪你把事接住，你更喜欢我短一点直接一点，还是多展开一点慢慢说？",
    "我也想知道你舒服的说话方式。你更喜欢我利落一点，还是更像有人陪着你一起展开一点？",
  ],
  boundary: [
    "还有个边界我想先记住。有没有什么事是我别碰的，或者必须先问过你的？",
    "你可以先把不舒服的地方告诉我。什么做法会让你烦，或者哪些事我一定要先征求你？",
  ],
  next: [
    "最后先替你接住一条最近会发生的事。接下来最可能先出现、最值得我记着的那件事是什么？",
    "我想先记住一个很近的落点。接下来这几天，最可能先发生、也最希望我帮你接上的是什么？",
  ],
};

const ACK_LINES: Record<OnboardingSlotId, string> = {
  boundary: "这条边界我会认真记着。",
  current_status: "我大概知道你最近在过什么了。",
  next: "好，我先把那条近线记着。",
  preference: "你舒服的说话方式我记下来了。",
  rhythm: "你的节奏我先摸到了。",
};

const MANAGED_SLOT_NAMES: Record<OnboardingSlotId, string> = {
  boundary: "onboarding-boundary",
  current_status: "current-position",
  next: "onboarding-next",
  preference: "onboarding-preference",
  rhythm: "onboarding-rhythm",
};

export function startOnboardingConversation(
  config: OnboardingRuntimeConfig,
  userId: string,
  now: Date = new Date(),
): OnboardingConversationResult {
  const store = createOnboardingStateStore(config, userId);
  const current = store.getState();

  if (current.status === "ready") {
    return {
      assistantMessage: "我已经大概有个你的样子了，后面不用重来。要是最近有变化，就像平常聊天一样告诉我，我会顺手改。",
      noteFiles: [],
      state: current,
      writes: [],
    };
  }

  if (current.status === "in_progress" || current.status === "followup_needed") {
    return {
      assistantMessage: buildPromptForMissingSlot(current.missingSlots, current.turnCount, []),
      noteFiles: [],
      state: current,
      writes: [],
    };
  }

  const nextState = store.setState({
    coverage: createDefaultOnboardingCoverage(),
    missingSlots: [],
    sessionId: crypto.randomUUID(),
    status: "in_progress",
    turnCount: 1,
    updatedAt: now.toISOString(),
  });
  return {
    assistantMessage: buildPromptForMissingSlot(nextState.missingSlots, nextState.turnCount, []),
    noteFiles: [],
    state: nextState,
    writes: [],
  };
}

export async function stepOnboardingConversation(
  config: OnboardingRuntimeConfig,
  {
    sessionId,
    text,
    userId,
  }: {
    sessionId: string;
    text: string;
    userId: string;
  },
  now: Date = new Date(),
): Promise<OnboardingConversationResult> {
  const store = createOnboardingStateStore(config, userId);
  const current = store.getState();
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId || !current.sessionId) {
    throw new Error("当前还没有进行中的 onboarding session，请先执行 onboarding start。");
  }
  if (current.sessionId !== normalizedSessionId) {
    throw new Error("onboarding session 已变化，请重新获取最新 sessionId。");
  }

  const normalizedText = normalizeText(text);
  const deterministicWrites = extractOnboardingWrites(normalizedText);
  const currentProfile = collectCompanionProfileSnapshot(config, userId);
  const semantic = await maybeExtractOnboardingSemantic(config, {
    currentMessage: normalizedText,
    currentProfile,
    deterministicWrites,
    profile: {
      sessionId: normalizedSessionId,
      userId,
      workspaceRoot: config.workspaceRoot || process.cwd(),
    },
    state: current,
  });
  const writes = resolveOnboardingWrites(semantic.data, deterministicWrites);
  const noteFiles = syncOnboardingWrites(config, userId, writes);
  const nextCoverage = mergeCoverage(current.coverage, writes);
  const nextTurnCount = current.status === "ready"
    ? current.turnCount
    : Math.min(current.turnCount + 1, MAX_ONBOARDING_TURNS);
  const nextStatus = resolveNextOnboardingStatus(nextCoverage, nextTurnCount);
  const nextState = store.setState({
    coverage: nextCoverage,
    missingSlots: [],
    sessionId: current.sessionId,
    status: nextStatus,
    turnCount: nextTurnCount,
    updatedAt: now.toISOString(),
  });
  refreshOnboardingContextBoard(config, userId);

  return {
    assistantMessage: buildAssistantReply({
      gaps: semantic.data?.gaps || [],
      missingSlots: nextState.missingSlots,
      status: nextState.status,
      turnCount: nextState.turnCount,
      writes,
    }),
    noteFiles,
    state: nextState,
    writes,
  };
}

export function getOnboardingStatus(
  config: OnboardingRuntimeConfig,
  userId: string,
): OnboardingState {
  return createOnboardingStateStore(config, userId).getState();
}

export function resetOnboardingState(
  config: OnboardingRuntimeConfig,
  userId: string,
): OnboardingState {
  return createOnboardingStateStore(config, userId).reset();
}

export function extractOnboardingWrites(text: string): ExtractedOnboardingWrite[] {
  const normalizedInput = normalizeText(text);
  if (!normalizedInput) {
    return [];
  }
  const sentences = splitIntoSentences(normalizedInput);
  const writes: ExtractedOnboardingWrite[] = [];
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

  if (!writes.some((entry) => entry.slotId === "current_status") && (!writes.length || unmatched.length)) {
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

function resolveOnboardingWrites(
  semantic: OnboardingSemanticResult | null,
  deterministicWrites: ExtractedOnboardingWrite[],
): ExtractedOnboardingWrite[] {
  const semanticWrites = semantic ? mapSemanticFactsToWrites(semantic) : [];
  if (!semanticWrites.length) {
    return deterministicWrites;
  }
  const coveredSlots = new Set(semanticWrites.map((write) => write.slotId));
  return dedupeWrites([
    ...semanticWrites,
    ...deterministicWrites.filter((write) => !coveredSlots.has(write.slotId)),
  ]);
}

function mapSemanticFactsToWrites(result: OnboardingSemanticResult): ExtractedOnboardingWrite[] {
  const writes: ExtractedOnboardingWrite[] = [];
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

function shouldPersistSemanticFact(fact: OnboardingSemanticFact): boolean {
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

function syncOnboardingWrites(
  config: OnboardingRuntimeConfig,
  userId: string,
  writes: ExtractedOnboardingWrite[],
): string[] {
  const touchedFiles = new Set<string>();
  const writesBySlot = new Map<OnboardingSlotId, ExtractedOnboardingWrite[]>();
  for (const write of writes) {
    const group = writesBySlot.get(write.slotId) || [];
    group.push(write);
    writesBySlot.set(write.slotId, group);
  }

  for (const [slotId, slotWrites] of writesBySlot.entries()) {
    const route = resolveCompanionRouteForOnboarding(config, userId, SLOT_TO_KIND[slotId]);
    const ensureOptions: { createIfMissing?: boolean; fileTitle?: unknown } = {};
    if (route.createIfMissing) {
      ensureOptions.createIfMissing = true;
    }
    if (route.fileTitle) {
      ensureOptions.fileTitle = route.fileTitle;
    }
    ensureDurableNoteSections(route.filePath, route.sections, ensureOptions);
    writeManagedOnboardingSlot(route, slotId, slotWrites);
    touchedFiles.add(route.filePath);
  }

  return Array.from(touchedFiles);
}

function writeManagedOnboardingSlot(
  route: ResolvedDurableNoteRoute,
  slotId: OnboardingSlotId,
  writes: ExtractedOnboardingWrite[],
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

function resolveCompanionRouteForOnboarding(
  config: OnboardingRuntimeConfig,
  userId: string,
  kind: OnboardingCompanionKind,
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

function mergeCoverage(
  coverage: OnboardingCoverage,
  writes: ExtractedOnboardingWrite[],
): OnboardingCoverage {
  const nextSlotCoverage: OnboardingSlotCoverage = {
    ...coverage.slots,
  };
  const nextDomainCoverage = {
    ...coverage.domains,
  };
  for (const slotId of new Set(writes.map((write) => write.slotId))) {
    nextSlotCoverage[slotId] += 1;
  }
  for (const domain of new Set(writes.map((write) => write.domain || "").filter(Boolean))) {
    nextDomainCoverage[domain as OnboardingPersonaDomain] += 1;
  }
  return {
    domains: nextDomainCoverage,
    slots: nextSlotCoverage,
  };
}

function resolveNextOnboardingStatus(
  coverage: OnboardingCoverage,
  turnCount: number,
): OnboardingStatus {
  if (isOnboardingReady(coverage)) {
    return "ready";
  }
  if (turnCount >= MAX_ONBOARDING_TURNS) {
    return "followup_needed";
  }
  return "in_progress";
}

function buildAssistantReply({
  gaps,
  missingSlots,
  status,
  turnCount,
  writes,
}: {
  gaps: OnboardingSemanticGap[];
  missingSlots: OnboardingSlotId[];
  status: OnboardingStatus;
  turnCount: number;
  writes: ExtractedOnboardingWrite[];
}): string {
  const ack = buildAckPrefix(writes);
  if (status === "ready") {
    return [ack, "好，我已经大概摸到你的节奏了。后面你不用每次都从头解释自己，有变化直接顺手告诉我，我会跟着更新。"].filter(Boolean).join(" ");
  }
  if (status === "followup_needed") {
    return [ack, "我先不把这次聊成一份调查表。还缺的那一点，后面我会在合适的时候轻轻补一句。"].filter(Boolean).join(" ");
  }
  if (!writes.length) {
    return [pickNoWritePreface(turnCount), buildPromptForMissingSlot(missingSlots, turnCount, gaps)].filter(Boolean).join(" ");
  }
  return [ack, buildPromptForMissingSlot(missingSlots, turnCount, gaps)].filter(Boolean).join(" ");
}

function buildAckPrefix(writes: ExtractedOnboardingWrite[]): string {
  const slotIds = Array.from(new Set(writes.map((write) => write.slotId)));
  return slotIds.slice(0, 2).map((slotId) => ACK_LINES[slotId]).filter(Boolean).join(" ");
}

function buildPromptForMissingSlot(
  missingSlots: OnboardingSlotId[],
  turnCount: number,
  gaps: OnboardingSemanticGap[],
): string {
  const nextSlot = resolveNextPromptSlot(missingSlots, gaps);
  const prompts = SLOT_PROMPTS[nextSlot];
  return prompts[turnCount % prompts.length] || prompts[0] || "";
}

function resolveNextPromptSlot(missingSlots: OnboardingSlotId[], gaps: OnboardingSemanticGap[]): OnboardingSlotId {
  const gapOrder = { high: 0, medium: 1, low: 2 };
  const gapSlot = [...gaps]
    .filter((gap) => gap.slotId && missingSlots.includes(gap.slotId))
    .sort((left, right) => gapOrder[left.priority] - gapOrder[right.priority])[0]?.slotId;
  return gapSlot || missingSlots[0] || "current_status";
}

function pickNoWritePreface(turnCount: number): string {
  const options = [
    "没关系，你不用一下子把自己讲得很完整。",
    "不用替我整理答案，顺口说一点就够了。",
  ];
  return options[turnCount % options.length] || options[0] || "";
}

function detectSlots(sentence: string): OnboardingSlotId[] {
  const slots: OnboardingSlotId[] = [];
  if (BOUNDARY_RE.test(sentence)) {
    slots.push("boundary");
  }
  if (PREFERENCE_RE.test(sentence)) {
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

function dedupeWrites(writes: ExtractedOnboardingWrite[]): ExtractedOnboardingWrite[] {
  const seen = new Set<string>();
  const deduped: ExtractedOnboardingWrite[] = [];
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

function mapDomainToSlot(domain: OnboardingPersonaDomain): OnboardingSlotId {
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
  writes: ExtractedOnboardingWrite[],
  slotId: OnboardingSlotId,
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

function collectCompanionProfileSnapshot(
  config: OnboardingRuntimeConfig,
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
  config: OnboardingRuntimeConfig,
  userId: string,
  slotId: OnboardingSlotId,
): string[] {
  try {
    const route = resolveCompanionRouteForOnboarding(config, userId, SLOT_TO_KIND[slotId]);
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

function refreshOnboardingContextBoard(
  config: OnboardingRuntimeConfig,
  userId: string,
): void {
  if (!normalizeText(config.workspaceRoot)) {
    return;
  }
  bestEffortRefreshContextBoard(config, {
    mode: "proactive",
    user: userId,
    workspace: normalizeText(config.workspaceRoot),
  });
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
