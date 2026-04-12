// @ts-check

const { normalizeAssistantPhase } = require("../../adapters/runtime/codex/message-utils");
const {
  mergeAuthoritativeItemText,
  normalizeFragmentKind,
} = require("./delta-merge");
const {
  markdownToPlainText,
  normalizeLineEndings,
  normalizeText,
  trimOuterBlankLines,
} = require("./visible-text");

/**
 * @typedef {{
 *   userId: string,
 *   contextToken: string,
 *   provider: string,
 * }} ReplyTarget
 */

/**
 * @typedef {{
 *   itemId: string,
 *   authoritativeText: string,
 *   currentText: string,
 *   completedText: string,
 *   completed: boolean,
 *   phase: string,
 *   lastFragmentAt: number,
 *   lastFragmentKind: string,
 *   lastDeliveredVisibleText: string,
 *   pendingVisibleSuffix: string,
 * }} RunStateItem
 */

/**
 * @typedef {{
 *   runKey: string,
 *   threadId: string,
 *   bindingKey: string,
 *   replyTarget: ReplyTarget | null,
 *   turnId: string,
 *   itemOrder: string[],
 *   items: Map<string, RunStateItem>,
 *   weixinReplyMode: string,
 *   sentText: string,
 *   lastDeliveredVisibleText: string,
 *   sendChain: Promise<void>,
 *   flushPromise: Promise<void> | null,
 *   scheduledFlushTimer: NodeJS.Timeout | null,
 *   abandonedAt: number,
 * }} RunState
 */

function numberOrDefault(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function buildRunKey(threadId, turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  return normalizedTurnId
    ? `${normalizedThreadId}:${normalizedTurnId}`
    : `${normalizedThreadId}:pending`;
}

function createRunState({ threadId, turnId = "", weixinReplyMode }) {
  return {
    runKey: buildRunKey(threadId, turnId),
    threadId,
    bindingKey: "",
    replyTarget: null,
    turnId: normalizeText(turnId),
    itemOrder: [],
    items: new Map(),
    weixinReplyMode,
    sentText: "",
    lastDeliveredVisibleText: "",
    sendChain: Promise.resolve(),
    flushPromise: null,
    scheduledFlushTimer: null,
    abandonedAt: 0,
  };
}

function ensureRunState(stateByRunKey, { threadId, turnId = "", weixinReplyMode }) {
  const runKey = buildRunKey(threadId, turnId);
  const existing = stateByRunKey.get(runKey);
  if (existing) {
    return existing;
  }
  const created = createRunState({ threadId, turnId, weixinReplyMode });
  stateByRunKey.set(runKey, created);
  return created;
}

function findRunState(stateByRunKey, threadId, turnId = "") {
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

function ensureStateItem(state, itemId) {
  const normalizedItemId = normalizeText(itemId) || `item-${state.itemOrder.length + 1}`;
  const existing = state.items.get(normalizedItemId);
  if (existing) {
    return existing;
  }
  const created = {
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

function upsertStateItem(state, { itemId, text, completed, phase = "", fragmentKind = "" }) {
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

function replaceStateItemText(state, itemId, text, completed) {
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

function removeStateItem(state, itemId) {
  const normalizedItemId = normalizeText(itemId);
  if (!normalizedItemId || !state?.items?.has(normalizedItemId)) {
    return;
  }
  state.items.delete(normalizedItemId);
  state.itemOrder = state.itemOrder.filter((candidateId) => candidateId !== normalizedItemId);
}

function readStateItemText(state, itemId, { completedOnly }) {
  const item = state.items.get(itemId);
  if (!item) {
    return "";
  }
  const sourceText = completedOnly
    ? (item.completed ? item.completedText || item.authoritativeText : "")
    : (item.completedText || item.authoritativeText);
  return trimOuterBlankLines(sourceText);
}

function collectVisibleItems(state, { completedOnly, skipItemIds = null }) {
  const items = [];
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

module.exports = {
  buildRunKey,
  collectVisibleItems,
  createRunState,
  ensureRunState,
  ensureStateItem,
  findRunState,
  readStateItemText,
  removeStateItem,
  replaceStateItemText,
  upsertStateItem,
};
