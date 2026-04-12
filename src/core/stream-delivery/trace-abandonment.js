// @ts-check

const crypto = require("crypto");
const {
  normalizeLineEndings,
  normalizeText,
} = require("./visible-text");
const {
  prefersSettledDelivery,
  prefersStreamingDelivery,
} = require("./delivery-transport");

const RECENT_WEIXIN_DELIVERY_TTL_MS = 30_000;

function buildSettledWeixinDeliveryKey(state, safeText) {
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

function pruneRecentDeliveries(recentSettledWeixinDeliveries, now = Date.now()) {
  for (const [key, deliveredAt] of recentSettledWeixinDeliveries.entries()) {
    if (!Number.isFinite(deliveredAt) || (now - deliveredAt) > RECENT_WEIXIN_DELIVERY_TTL_MS) {
      recentSettledWeixinDeliveries.delete(key);
    }
  }
}

function wasRecentlyDelivered(recentSettledWeixinDeliveries, key, now = Date.now()) {
  pruneRecentDeliveries(recentSettledWeixinDeliveries, now);
  const deliveredAt = recentSettledWeixinDeliveries.get(key);
  return Number.isFinite(deliveredAt) && (now - deliveredAt) <= RECENT_WEIXIN_DELIVERY_TTL_MS;
}

function rememberRecentDelivery(recentSettledWeixinDeliveries, key, now = Date.now()) {
  pruneRecentDeliveries(recentSettledWeixinDeliveries, now);
  recentSettledWeixinDeliveries.set(key, now);
}

function buildDeliveryMode(state) {
  if (prefersSettledDelivery(state)) {
    return "settled";
  }
  if (prefersStreamingDelivery(state)) {
    return "stream";
  }
  return normalizeText(state?.replyTarget?.provider) || "unknown";
}

function formatDeliveryTrigger(trigger) {
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

function hashReplyText(text) {
  return crypto.createHash("sha1").update(String(text || ""), "utf8").digest("hex").slice(0, 12);
}

function buildDeliveryTracePayload(state, {
  force = false,
  trigger = null,
  traceId = "",
  safeText = "",
  delta = "",
  relation = "",
  deliveredVisibleBefore = "",
  deliveredVisibleAfter = "",
} = {}) {
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

function resolveLateRewriteDelta({ state, delta, deltaResult, force, safeText, streamPrepared }) {
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
      deltaResult,
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

function disposeSupersededAbandonedRuns({
  stateByRunKey,
  ignoredRunKeys,
  threadId,
  activeTurnId = "",
  onDisposeRunKey = null,
}) {
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

module.exports = {
  buildDeliveryTracePayload,
  buildSettledWeixinDeliveryKey,
  disposeSupersededAbandonedRuns,
  hashReplyText,
  rememberRecentDelivery,
  resolveLateRewriteDelta,
  wasRecentlyDelivered,
};
