// @ts-check

import * as crypto from "crypto";
import {
  normalizeLineEndings,
  normalizeText,
} from "./visible-text";
import {
  prefersSettledDelivery,
  prefersStreamingDelivery,
  type PreparedStreamingDelivery,
} from "./delivery-transport";
import type { FlushTrigger } from "./delivery-transport";
import type { RunState } from "./run-state";

const RECENT_WEIXIN_DELIVERY_TTL_MS = 30_000;

export interface DeliveryTracePayload {
  traceId: string;
  threadId: string;
  turnId: string;
  mode: string;
  force: boolean;
  trigger: string;
  relation: string;
  sentCharsBefore: number;
  safeChars: number;
  deltaChars: number;
  deliveredVisibleBeforeChars: number;
  deliveredVisibleAfterChars: number;
  safeHash: string;
  deltaHash: string;
}

interface LateRewriteDeltaResult {
  delta: string;
  deltaResult: {
    delta: string;
    relation: string;
    deliveredVisibleBefore: string;
    deliveredVisibleAfter: string;
  };
}

export function buildSettledWeixinDeliveryKey(state: RunState, safeText: unknown): string {
  if (!prefersSettledDelivery(state)) {
    return "";
  }
  const threadId = normalizeText(state?.threadId);
  const userId = normalizeText(state?.replyTarget?.userId);
  const contextToken = normalizeText(state?.replyTarget?.contextToken);
  const text = normalizeLineEndings(safeText).trim();
  if (!threadId || !userId || !contextToken || !text) {
    return "";
  }
  // Keep the scope narrow: only suppress the same settled payload on the same
  // WeChat thread shortly after a successful send, which is where we see
  // accidental duplicate terminal deliveries.
  return `${threadId}|${userId}|${contextToken}|${text}`;
}

function pruneRecentDeliveries(recentSettledWeixinDeliveries: Map<string, number>, now: number = Date.now()): void {
  for (const [key, deliveredAt] of recentSettledWeixinDeliveries.entries()) {
    if (!Number.isFinite(deliveredAt) || (now - deliveredAt) > RECENT_WEIXIN_DELIVERY_TTL_MS) {
      recentSettledWeixinDeliveries.delete(key);
    }
  }
}

export function wasRecentlyDelivered(
  recentSettledWeixinDeliveries: Map<string, number>,
  key: string,
  now: number = Date.now(),
): boolean {
  pruneRecentDeliveries(recentSettledWeixinDeliveries, now);
  const deliveredAt = recentSettledWeixinDeliveries.get(key);
  return typeof deliveredAt === "number"
    && Number.isFinite(deliveredAt)
    && (now - deliveredAt) <= RECENT_WEIXIN_DELIVERY_TTL_MS;
}

export function rememberRecentDelivery(
  recentSettledWeixinDeliveries: Map<string, number>,
  key: string,
  now: number = Date.now(),
): void {
  pruneRecentDeliveries(recentSettledWeixinDeliveries, now);
  recentSettledWeixinDeliveries.set(key, now);
}

function buildDeliveryMode(state: RunState): string {
  if (prefersSettledDelivery(state)) {
    return "settled";
  }
  if (prefersStreamingDelivery(state)) {
    return "stream";
  }
  return normalizeText(state?.replyTarget?.provider) || "unknown";
}

function formatDeliveryTrigger(trigger: FlushTrigger | null | undefined): string {
  if (!trigger || typeof trigger !== "object") {
    return "";
  }
  return [
    normalizeText(trigger.source),
    normalizeText(trigger.itemId),
    normalizeText(trigger.phase),
    normalizeText(trigger.fragmentKind),
    normalizeText(trigger.fragmentRelation),
  ].filter(Boolean).join("/");
}

export function hashReplyText(text: unknown): string {
  return crypto.createHash("sha1").update(String(text || ""), "utf8").digest("hex").slice(0, 12);
}

export function buildDeliveryTracePayload(
  state: RunState,
  {
    force = false,
    trigger = null,
    traceId = "",
    safeText = "",
    delta = "",
    relation = "",
    deliveredVisibleBefore = "",
    deliveredVisibleAfter = "",
  }: {
    force?: boolean;
    trigger?: FlushTrigger | null;
    traceId?: string;
    safeText?: string;
    delta?: string;
    relation?: string;
    deliveredVisibleBefore?: string;
    deliveredVisibleAfter?: string;
  } = {},
): DeliveryTracePayload {
  return {
    traceId: normalizeText(traceId),
    threadId: normalizeText(state?.threadId),
    turnId: normalizeText(state?.turnId),
    mode: buildDeliveryMode(state),
    force: Boolean(force),
    trigger: formatDeliveryTrigger(trigger),
    relation: normalizeText(relation),
    sentCharsBefore: String(state?.sentText || "").length,
    safeChars: String(safeText || "").length,
    deltaChars: String(delta || "").length,
    deliveredVisibleBeforeChars: String(deliveredVisibleBefore || "").length,
    deliveredVisibleAfterChars: String(deliveredVisibleAfter || "").length,
    safeHash: hashReplyText(safeText),
    deltaHash: hashReplyText(delta),
  };
}

export function resolveLateRewriteDelta({
  state,
  delta,
  deltaResult,
  force,
  safeText,
  streamPrepared,
}: {
  state: RunState;
  delta: string;
  deltaResult: {
    relation: string;
    deliveredVisibleBefore: string;
    deliveredVisibleAfter: string;
  };
  force: boolean;
  safeText: string;
  streamPrepared?: PreparedStreamingDelivery | null;
}): LateRewriteDeltaResult {
  if (
    delta
    || streamPrepared
    || !Boolean(state?.abandonedAt)
    || !force
    || !safeText
    || safeText === state.sentText
  ) {
    return {
      delta,
      deltaResult: {
        delta,
        relation: deltaResult.relation,
        deliveredVisibleBefore: deltaResult.deliveredVisibleBefore,
        deliveredVisibleAfter: deltaResult.deliveredVisibleAfter,
      },
    };
  }
  return {
    delta: safeText,
    deltaResult: {
      delta: safeText,
      relation: deltaResult.relation === "rewrite_without_extension"
        ? "late_rewrite"
        : (deltaResult.relation || "late_rewrite"),
      deliveredVisibleBefore: state.sentText,
      deliveredVisibleAfter: safeText,
    },
  };
}

export function disposeSupersededAbandonedRuns({
  stateByRunKey,
  ignoredRunKeys,
  threadId,
  activeTurnId = "",
  onDisposeRunKey = null,
}: {
  stateByRunKey: Map<string, RunState>;
  ignoredRunKeys: Set<string>;
  threadId: unknown;
  activeTurnId?: string;
  onDisposeRunKey?: ((runKey: string) => void) | null;
}): void {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedActiveTurnId = normalizeText(activeTurnId);
  if (!normalizedThreadId) {
    return;
  }
  for (const candidate of stateByRunKey.values()) {
    if (candidate.threadId !== normalizedThreadId || !candidate.abandonedAt) {
      continue;
    }
    if (normalizedActiveTurnId && candidate.turnId === normalizedActiveTurnId) {
      continue;
    }
    ignoredRunKeys.add(candidate.runKey);
    if (typeof onDisposeRunKey === "function") {
      onDisposeRunKey(candidate.runKey);
    }
  }
}
