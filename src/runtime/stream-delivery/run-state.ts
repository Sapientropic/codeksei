// @ts-check

import { normalizeAssistantPhase } from "../../adapters/runtime/codex/message-utils";
import {
  mergeAuthoritativeItemText,
  normalizeFragmentKind,
  type FragmentKind,
  type MergeAuthoritativeItemTextResult,
} from "./delta-merge";
import {
  markdownToPlainText,
  normalizeLineEndings,
  normalizeText,
  trimOuterBlankLines,
} from "./visible-text";

export interface ReplyTarget {
  userId: string;
  contextToken: string;
  provider: string;
  deliveryPolicy?: "normal" | "final_only";
}

export interface RunStateItem {
  itemId: string;
  authoritativeText: string;
  currentText: string;
  completedText: string;
  completed: boolean;
  phase: string;
  lastFragmentAt: number;
  lastFragmentKind: FragmentKind;
  lastDeliveredVisibleText: string;
  pendingVisibleSuffix: string;
}

export interface RunState {
  runKey: string;
  threadId: string;
  bindingKey: string;
  replyTarget: ReplyTarget | null;
  turnId: string;
  itemOrder: string[];
  items: Map<string, RunStateItem>;
  weixinReplyMode: string;
  sentText: string;
  lastDeliveredVisibleText: string;
  sendChain: Promise<void>;
  flushPromise: Promise<void> | null;
  scheduledFlushTimer: NodeJS.Timeout | null;
  abandonedAt: number;
}

export interface VisibleRunStateItem {
  itemId: string;
  text: string;
  completed: boolean;
  phase: string;
  lastDeliveredVisibleText: string;
  lastFragmentAt: number;
  lastFragmentKind: FragmentKind;
}

interface CreateRunStateArgs {
  threadId: unknown;
  turnId?: string;
  weixinReplyMode: unknown;
}

interface UpsertStateItemArgs {
  itemId?: unknown;
  text?: unknown;
  completed: boolean;
  phase?: unknown;
  fragmentKind?: unknown;
}

export function buildRunKey(threadId: unknown, turnId: string = ""): string {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  return normalizedTurnId
    ? `${normalizedThreadId}:${normalizedTurnId}`
    : `${normalizedThreadId}:pending`;
}

export function createRunState({ threadId, turnId = "", weixinReplyMode }: CreateRunStateArgs): RunState {
  const normalizedThreadId = normalizeText(threadId);
  return {
    runKey: buildRunKey(normalizedThreadId, turnId),
    threadId: normalizedThreadId,
    bindingKey: "",
    replyTarget: null,
    turnId: normalizeText(turnId),
    itemOrder: [],
    items: new Map(),
    weixinReplyMode: normalizeText(weixinReplyMode),
    sentText: "",
    lastDeliveredVisibleText: "",
    sendChain: Promise.resolve(),
    flushPromise: null,
    scheduledFlushTimer: null,
    abandonedAt: 0,
  };
}

export function ensureRunState(
  stateByRunKey: Map<string, RunState>,
  { threadId, turnId = "", weixinReplyMode }: CreateRunStateArgs,
): RunState {
  const runKey = buildRunKey(threadId, turnId);
  const existing = stateByRunKey.get(runKey);
  if (existing) {
    return existing;
  }
  const created = createRunState({ threadId, turnId, weixinReplyMode });
  stateByRunKey.set(runKey, created);
  return created;
}

export function findRunState(
  stateByRunKey: Map<string, RunState>,
  threadId: unknown,
  turnId: string = "",
): RunState | null {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  if (!normalizedThreadId) {
    return null;
  }
  if (normalizedTurnId) {
    const exact = stateByRunKey.get(buildRunKey(normalizedThreadId, normalizedTurnId));
    if (exact) {
      return exact;
    }
  }
  const pending = stateByRunKey.get(buildRunKey(normalizedThreadId, ""));
  if (pending && (!normalizedTurnId || !pending.turnId || pending.turnId === normalizedTurnId)) {
    return pending;
  }
  for (const candidate of stateByRunKey.values()) {
    if (candidate.threadId !== normalizedThreadId) {
      continue;
    }
    if (!normalizedTurnId || candidate.turnId === normalizedTurnId) {
      return candidate;
    }
  }
  return null;
}

export function ensureStateItem(state: RunState, itemId: unknown): RunStateItem {
  const normalizedItemId = normalizeText(itemId) || `item-${state.itemOrder.length + 1}`;
  const existing = state.items.get(normalizedItemId);
  if (existing) {
    return existing;
  }
  const created: RunStateItem = {
    itemId: normalizedItemId,
    authoritativeText: "",
    currentText: "",
    completedText: "",
    completed: false,
    phase: "",
    lastFragmentAt: 0,
    lastFragmentKind: "",
    lastDeliveredVisibleText: "",
    pendingVisibleSuffix: "",
  };
  state.items.set(normalizedItemId, created);
  state.itemOrder.push(normalizedItemId);
  return created;
}

export function upsertStateItem(
  state: RunState,
  { itemId, text, completed, phase = "", fragmentKind = "" }: UpsertStateItemArgs,
): MergeAuthoritativeItemTextResult {
  const normalizedItemId = normalizeText(itemId) || `item-${state.itemOrder.length + 1}`;
  const normalizedText = normalizeLineEndings(text);
  if (!normalizedText) {
    return { relation: "keep", text: "" };
  }
  const current = ensureStateItem(state, normalizedItemId);
  const normalizedPhase = normalizeAssistantPhase(phase);
  const normalizedFragment = normalizeFragmentKind(fragmentKind);
  if (normalizedPhase) {
    current.phase = normalizedPhase;
  }
  current.lastFragmentAt = Date.now();
  current.lastFragmentKind = normalizedFragment || current.lastFragmentKind;
  const merge = mergeAuthoritativeItemText(current.authoritativeText, normalizedText, {
    fragmentKind: completed ? "completed_snapshot" : normalizedFragment,
    completed,
  });
  current.authoritativeText = merge.text;
  current.currentText = merge.text;
  if (completed) {
    current.completedText = merge.text;
    current.completed = true;
  }
  current.pendingVisibleSuffix = "";
  return merge;
}

export function replaceStateItemText(state: RunState, itemId: unknown, text: unknown, completed: unknown): void {
  const normalizedText = normalizeLineEndings(text);
  if (!normalizedText) {
    return;
  }
  const current = ensureStateItem(state, itemId);
  current.authoritativeText = normalizedText;
  current.currentText = normalizedText;
  if (completed) {
    current.completedText = normalizedText;
  }
  current.completed = Boolean(completed);
  current.pendingVisibleSuffix = "";
}

export function removeStateItem(state: RunState, itemId: unknown): void {
  const normalizedItemId = normalizeText(itemId);
  if (!normalizedItemId || !state.items.has(normalizedItemId)) {
    return;
  }
  state.items.delete(normalizedItemId);
  state.itemOrder = state.itemOrder.filter((candidateId) => candidateId !== normalizedItemId);
}

export function readStateItemText(
  state: RunState,
  itemId: string,
  { completedOnly }: { completedOnly: boolean },
): string {
  const item = state.items.get(itemId);
  if (!item) {
    return "";
  }
  const sourceText = completedOnly
    ? (item.completed ? item.completedText || item.authoritativeText : "")
    : (item.completedText || item.authoritativeText);
  return trimOuterBlankLines(sourceText);
}

export function collectVisibleItems(
  state: RunState,
  { completedOnly, skipItemIds = null }: { completedOnly: boolean; skipItemIds?: Set<string> | null },
): VisibleRunStateItem[] {
  const items: VisibleRunStateItem[] = [];
  for (const itemId of state.itemOrder) {
    if (skipItemIds?.has(itemId)) {
      continue;
    }
    const sourceText = readStateItemText(state, itemId, { completedOnly });
    if (!sourceText) {
      continue;
    }
    const item = state.items.get(itemId);
    const text = markdownToPlainText(sourceText);
    if (!text) {
      continue;
    }
    items.push({
      itemId,
      text,
      completed: Boolean(item?.completed),
      phase: normalizeAssistantPhase(item?.phase),
      lastDeliveredVisibleText: trimOuterBlankLines(String(item?.lastDeliveredVisibleText || "")),
      lastFragmentAt: numberOrDefault(item?.lastFragmentAt, 0),
      lastFragmentKind: normalizeFragmentKind(item?.lastFragmentKind),
    });
  }
  return items;
}

function numberOrDefault(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
