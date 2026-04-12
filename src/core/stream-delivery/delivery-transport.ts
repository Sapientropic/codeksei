// @ts-check

import type { RunState, VisibleRunStateItem } from "./run-state";
import {
  collectVisibleItems,
  readStateItemText,
} from "./run-state";
import { computeVisibleDeliveryDelta } from "./delta-merge";
import {
  isBriefStreamingProgressText,
  markdownToPlainText,
  normalizeLineEndings,
  normalizeText,
  rememberVisiblePart,
  sanitizeReplyText,
  shouldStreamImmediately,
  trimOuterBlankLines,
} from "./visible-text";

export interface FlushTrigger {
  source?: string;
  itemId?: string;
  phase?: string;
  fragmentKind?: string;
  fragmentRelation?: string;
}

export interface DeliveredStreamingItem {
  itemId: string;
  visibleText: string;
  deltaText: string;
  relation: string;
  phase: string;
  fragmentKind: string;
}

export interface PreparedStreamingDelivery {
  state: RunState;
  safeText: string;
  relation: string;
  deliveredItems: DeliveredStreamingItem[];
  deliveredVisibleAfter: string;
  preserveBlock: boolean;
  idleFlushEligible: boolean;
}

function normalizeWeixinReplyModeValue(value: unknown): "settled" | "stream" {
  return normalizeText(value).toLowerCase() === "settled" ? "settled" : "stream";
}

export function normalizeWeixinReplyMode(value: unknown): "settled" | "stream" {
  return normalizeWeixinReplyModeValue(value);
}

export function prefersSettledDelivery(state: RunState | null | undefined): boolean {
  return normalizeText(state?.replyTarget?.provider) === "weixin"
    && normalizeWeixinReplyModeValue(state?.weixinReplyMode) === "settled";
}

export function prefersStreamingDelivery(state: RunState | null | undefined): boolean {
  return normalizeText(state?.replyTarget?.provider) === "weixin"
    && normalizeWeixinReplyModeValue(state?.weixinReplyMode) === "stream";
}

function hasWatchdogTail(state: RunState, { completedOnly }: { completedOnly: boolean }): boolean {
  return Boolean(readStateItemText(state, "__watchdog__", { completedOnly }));
}

export function buildAllVisibleReplyText(
  state: RunState,
  {
    completedOnly,
    skipItemIds = null,
    collapseDuplicateVisibleItems = false,
  }: {
    completedOnly: boolean;
    skipItemIds?: Set<string> | null;
    collapseDuplicateVisibleItems?: boolean;
  },
): string {
  const parts: string[] = [];
  const seenVisibleParts = collapseDuplicateVisibleItems ? new Set<string>() : null;
  for (const item of collectVisibleItems(state, { completedOnly, skipItemIds })) {
    if (!seenVisibleParts) {
      parts.push(item.text);
      continue;
    }
    rememberVisiblePart(parts, seenVisibleParts, item.text);
  }
  return parts.join("\n\n");
}

export function findLatestVisibleReplyText(state: RunState, { completedOnly }: { completedOnly: boolean }): string {
  const visibleItems = collectVisibleItems(state, { completedOnly });
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    if (visibleItems[index].itemId !== "__watchdog__") {
      return visibleItems[index].text;
    }
  }
  return "";
}

export function findLatestWatchdogVisibleReply(
  visibleItems: VisibleRunStateItem[],
): VisibleRunStateItem | null {
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    const item = visibleItems[index];
    if (!item || item.itemId === "__watchdog__") {
      continue;
    }

    if (item.phase === "final") {
      return item;
    }

    if (item.phase === "commentary") {
      if (item.completed && isBriefStreamingProgressText(item.text)) {
        return item;
      }
      continue;
    }

    if (item.completed || isBriefStreamingProgressText(item.text)) {
      return item;
    }
  }
  return null;
}

export function findLatestWatchdogVisibleReplyText(
  state: RunState,
  { completedOnly }: { completedOnly: boolean },
): string {
  const visibleItems = collectVisibleItems(state, {
    completedOnly,
    skipItemIds: new Set(["__watchdog__"]),
  });
  const candidate = findLatestWatchdogVisibleReply(visibleItems);
  return candidate?.text || "";
}

function findLastVisibleReplyIndex(visibleItems: VisibleRunStateItem[]): number {
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    if (visibleItems[index]?.itemId !== "__watchdog__") {
      return index;
    }
  }
  return -1;
}

export function findStreamingTerminalReplyText(visibleItems: VisibleRunStateItem[]): VisibleRunStateItem | null {
  const lastVisibleReplyIndex = findLastVisibleReplyIndex(visibleItems);
  if (lastVisibleReplyIndex < 0) {
    return null;
  }
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    const item = visibleItems[index];
    if (item.itemId === "__watchdog__") {
      continue;
    }
    if (!shouldStreamImmediately(item)) {
      return item;
    }
  }
  return visibleItems[lastVisibleReplyIndex] || null;
}

export function buildStreamingReplyText(state: RunState, { completedOnly }: { completedOnly: boolean }): string {
  const parts: string[] = [];
  const seenParts = new Set<string>();
  for (const item of collectVisibleItems(state, { completedOnly })) {
    if (!shouldStreamImmediately(item)) {
      continue;
    }
    rememberVisiblePart(parts, seenParts, item.text);
  }
  return parts.join("\n\n");
}

function buildStreamingWatchdogReplyText(state: RunState, { completedOnly }: { completedOnly: boolean }): string {
  const visible = buildStreamingReplyText(state, { completedOnly });
  const tail = readStateItemText(state, "__watchdog__", { completedOnly });
  const watchdogText = tail ? markdownToPlainText(tail) : "";
  return [visible, watchdogText].filter(Boolean).join("\n\n");
}

export function buildSettledReplyText(state: RunState, { completedOnly }: { completedOnly: boolean }): string {
  const tail = readStateItemText(state, "__watchdog__", { completedOnly });
  if (!tail) {
    // Codex can emit several assistant messages inside one turn. In settled
    // WeChat delivery we only want the latest user-facing reply, otherwise all
    // intermediate progress updates get stitched onto the final answer.
    return findLatestVisibleReplyText(state, { completedOnly });
  }

  // When the watchdog has to rescue a stalled turn, dumping every visible item
  // back to WeChat recreates the historical failure mode where long internal
  // commentary or task cards leak as one giant assistant bubble. Keep only the
  // latest safe visible block, then append the watchdog tail.
  const visible = findLatestWatchdogVisibleReplyText(state, { completedOnly });
  return [visible, markdownToPlainText(tail)].filter(Boolean).join("\n\n");
}

export function buildReplyText(
  state: RunState,
  {
    completedOnly,
    preferLatestMessage = false,
    force = false,
  }: {
    completedOnly: boolean;
    preferLatestMessage?: boolean;
    force?: boolean;
  },
): string {
  if (prefersStreamingDelivery(state) && !preferLatestMessage) {
    return force && hasWatchdogTail(state, { completedOnly })
      ? buildStreamingWatchdogReplyText(state, { completedOnly })
      : buildStreamingReplyText(state, { completedOnly });
  }

  if (force && hasWatchdogTail(state, { completedOnly })) {
    return buildSettledReplyText(state, { completedOnly });
  }

  if (preferLatestMessage) {
    return buildSettledReplyText(state, { completedOnly });
  }

  return buildAllVisibleReplyText(state, { completedOnly });
}

export function buildCurrentSafeReplyText(
  state: RunState,
  { force = false, completedOnly = false }: { force?: boolean; completedOnly?: boolean } = {},
): string {
  const plainText = buildReplyText(state, {
    completedOnly,
    preferLatestMessage: prefersSettledDelivery(state),
    force,
  });
  return sanitizeReplyText(state.replyTarget, plainText).text;
}

export function normalizeDeliveryDelta(
  delta: unknown,
  { streaming = false }: { streaming?: boolean } = {},
): string {
  const normalized = String(delta || "");
  if (!streaming) {
    return normalized;
  }
  // Stream mode ships completed assistant items one message at a time. The
  // snapshot diff can therefore start with the joiner's blank lines; trim only
  // that transport artifact so the next item lands as a clean standalone send.
  return normalized.replace(/^\n+/u, "");
}

export function shouldPreserveStreamingBlock(prepared: { deliveredItems?: unknown[] } | null | undefined): boolean {
  const deliveredItems = Array.isArray(prepared?.deliveredItems) ? prepared.deliveredItems : [];
  if (deliveredItems.length !== 1) {
    return false;
  }
  const item = deliveredItems[0];
  if (!item) {
    return false;
  }
  // Single streaming bubbles should land in WeChat as one coherent message.
  // Otherwise the transport layer re-splits on punctuation and turns a normal
  // sentence like "在。你这会儿怎么样..." into multiple tiny bubbles.
  return true;
}

export function shouldScheduleStreamingIdleFlush(
  prepared: { deliveredItems?: Array<{ phase?: unknown }> } | null | undefined,
): boolean {
  const deliveredItems = Array.isArray(prepared?.deliveredItems) ? prepared.deliveredItems : [];
  if (!deliveredItems.length) {
    return false;
  }
  // Idle flush is only for lightweight commentary. Letting unfinished final
  // text flush on idle is what produced half-sentences like "...时间" followed
  // by "线，不靠你自己回忆。" in separate WeChat bubbles.
  return deliveredItems.every((item) => normalizeText(item?.phase) === "commentary");
}

export function prepareStreamingDelivery(
  state: RunState,
  { completedOnly, force }: { completedOnly: boolean; force: boolean },
): PreparedStreamingDelivery {
  const visibleItems = collectVisibleItems(state, { completedOnly });
  const deliveredItems: DeliveredStreamingItem[] = [];
  const deltaParts: string[] = [];

  for (const item of visibleItems) {
    const isWatchdog = item.itemId === "__watchdog__";
    if (!isWatchdog && !shouldStreamImmediately(item)) {
      continue;
    }
    if (isWatchdog && !force) {
      continue;
    }

    const itemState = state.items.get(item.itemId);
    const deltaResult = computeVisibleDeliveryDelta(item.lastDeliveredVisibleText, item.text);
    if (itemState) {
      itemState.pendingVisibleSuffix = deltaResult.delta;
    }
    const normalizedDelta = normalizeDeliveryDelta(deltaResult.delta, { streaming: true });
    if (!normalizedDelta) {
      continue;
    }
    if (deltaParts.length) {
      deltaParts.push("\n\n");
    }
    deltaParts.push(normalizedDelta);
    deliveredItems.push({
      itemId: item.itemId,
      visibleText: item.text,
      deltaText: normalizedDelta,
      relation: deltaResult.relation,
      phase: item.phase,
      fragmentKind: item.lastFragmentKind,
    });
  }

  return {
    state,
    safeText: deltaParts.join(""),
    relation: deliveredItems.length === 1
      ? deliveredItems[0].relation
      : (deliveredItems.length > 1 ? "batch" : "keep"),
    deliveredItems,
    deliveredVisibleAfter: buildStreamingDeliveredVisibleText(state, {
      completedOnly,
      deliveredItems,
      force,
    }),
    preserveBlock: shouldPreserveStreamingBlock({ deliveredItems }),
    idleFlushEligible: shouldScheduleStreamingIdleFlush({ deliveredItems }),
  };
}

function buildStreamingDeliveredVisibleText(
  state: RunState,
  {
    completedOnly,
    deliveredItems,
    force,
  }: {
    completedOnly: boolean;
    deliveredItems: DeliveredStreamingItem[];
    force: boolean;
  },
): string {
  const deliveredById = new Map<string, string>();
  for (const item of Array.isArray(deliveredItems) ? deliveredItems : []) {
    deliveredById.set(item.itemId, item.visibleText);
  }

  const parts: string[] = [];
  const seenParts = new Set<string>();
  for (const item of collectVisibleItems(state, { completedOnly })) {
    if (item.itemId === "__watchdog__" && !force) {
      continue;
    }
    if (item.itemId !== "__watchdog__" && !shouldStreamImmediately(item)) {
      continue;
    }
    const visibleText = trimOuterBlankLines(
      deliveredById.get(item.itemId) || item.lastDeliveredVisibleText || ""
    );
    if (!visibleText) {
      continue;
    }
    rememberVisiblePart(parts, seenParts, visibleText);
  }
  return parts.join("\n\n");
}

export function commitPreparedStreamingDelivery(
  prepared: PreparedStreamingDelivery | null | undefined,
  { delivered }: { delivered: boolean },
): void {
  if (!prepared?.state || !Array.isArray(prepared.deliveredItems)) {
    return;
  }
  for (const item of prepared.deliveredItems) {
    const stateItem = prepared.state.items.get(item.itemId);
    if (!stateItem) {
      continue;
    }
    if (delivered) {
      stateItem.lastDeliveredVisibleText = item.visibleText;
      stateItem.pendingVisibleSuffix = "";
      continue;
    }
    stateItem.pendingVisibleSuffix = item.deltaText;
  }
}

export function hasCompletedFlushTrigger(
  trigger: FlushTrigger | null | undefined,
  runtimeEventTypes: { REPLY_COMPLETED: string; TURN_COMPLETED: string },
): boolean {
  const source = normalizeText(trigger?.source);
  return source === runtimeEventTypes.REPLY_COMPLETED
    || source === runtimeEventTypes.TURN_COMPLETED
    || source === "finishTurn"
    || source === "finalizeAbandonedTurn";
}

export function hasNaturalFlushBoundary(text: unknown): boolean {
  const normalized = trimOuterBlankLines(normalizeLineEndings(text));
  if (!normalized) {
    return false;
  }
  return /\n\n$/.test(normalized)
    || /\n$/.test(normalized)
    || /(?:[。！？!?]|[.!?]["'”’）)\]」』】]?)$/.test(normalized);
}
