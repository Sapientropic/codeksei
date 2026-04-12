// @ts-check

const {
  collectVisibleItems,
  readStateItemText,
} = require("./run-state");
const { computeVisibleDeliveryDelta } = require("./delta-merge");
const {
  isBriefStreamingProgressText,
  markdownToPlainText,
  normalizeLineEndings,
  normalizeText,
  rememberVisiblePart,
  sanitizeReplyText,
  shouldStreamImmediately,
  trimOuterBlankLines,
} = require("./visible-text");

function normalizeWeixinReplyMode(value: any) {
  return normalizeText(value).toLowerCase() === "settled" ? "settled" : "stream";
}

function prefersSettledDelivery(state: any) {
  return normalizeText(state?.replyTarget?.provider) === "weixin"
    && normalizeWeixinReplyMode(state?.weixinReplyMode) === "settled";
}

function prefersStreamingDelivery(state: any) {
  return normalizeText(state?.replyTarget?.provider) === "weixin"
    && normalizeWeixinReplyMode(state?.weixinReplyMode) === "stream";
}

function hasWatchdogTail(state: any, { completedOnly }: any) {
  return Boolean(readStateItemText(state, "__watchdog__", { completedOnly }));
}

function buildAllVisibleReplyText(
  state: any,
  { completedOnly, skipItemIds = null, collapseDuplicateVisibleItems = false }: any
) {
  const parts: string[] = [];
  const seenVisibleParts = collapseDuplicateVisibleItems ? new Set() : null;
  for (const item of collectVisibleItems(state, { completedOnly, skipItemIds })) {
    if (!seenVisibleParts) {
      parts.push(item.text);
      continue;
    }
    rememberVisiblePart(parts, seenVisibleParts, item.text);
  }
  return parts.join("\n\n");
}

function findLatestVisibleReplyText(state: any, { completedOnly }: any) {
  const visibleItems = collectVisibleItems(state, { completedOnly });
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    if (visibleItems[index].itemId !== "__watchdog__") {
      return visibleItems[index].text;
    }
  }
  return "";
}

function findLatestWatchdogVisibleReply(visibleItems: any) {
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

function findLatestWatchdogVisibleReplyText(state: any, { completedOnly }: any) {
  const visibleItems = collectVisibleItems(state, {
    completedOnly,
    skipItemIds: new Set(["__watchdog__"]),
  });
  const candidate = findLatestWatchdogVisibleReply(visibleItems);
  return candidate?.text || "";
}

function findLastVisibleReplyIndex(visibleItems: any) {
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    if (visibleItems[index]?.itemId !== "__watchdog__") {
      return index;
    }
  }
  return -1;
}

function findStreamingTerminalReplyText(visibleItems: any) {
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

function buildStreamingReplyText(state: any, { completedOnly }: any) {
  const parts: string[] = [];
  const seenParts = new Set();
  for (const item of collectVisibleItems(state, { completedOnly })) {
    if (!shouldStreamImmediately(item)) {
      continue;
    }
    rememberVisiblePart(parts, seenParts, item.text);
  }
  return parts.join("\n\n");
}

function buildStreamingWatchdogReplyText(state: any, { completedOnly }: any) {
  const visible = buildStreamingReplyText(state, { completedOnly });
  const tail = readStateItemText(state, "__watchdog__", { completedOnly });
  const watchdogText = tail ? markdownToPlainText(tail) : "";
  return [visible, watchdogText].filter(Boolean).join("\n\n");
}

function buildSettledReplyText(state: any, { completedOnly }: any) {
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

function buildReplyText(state: any, { completedOnly, preferLatestMessage = false, force = false }: any) {
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

function buildCurrentSafeReplyText(state: any, { force = false, completedOnly = false }: any = {}) {
  const plainText = buildReplyText(state, {
    completedOnly,
    preferLatestMessage: prefersSettledDelivery(state),
    force,
  });
  return sanitizeReplyText(state.replyTarget, plainText).text;
}

function normalizeDeliveryDelta(delta: any, { streaming = false }: any = {}) {
  const normalized = String(delta || "");
  if (!streaming) {
    return normalized;
  }
  // Stream mode ships completed assistant items one message at a time. The
  // snapshot diff can therefore start with the joiner's blank lines; trim only
  // that transport artifact so the next item lands as a clean standalone send.
  return normalized.replace(/^\n+/u, "");
}

function shouldPreserveStreamingBlock(prepared: any) {
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

function shouldScheduleStreamingIdleFlush(prepared: any) {
  const deliveredItems = Array.isArray(prepared?.deliveredItems) ? prepared.deliveredItems : [];
  if (!deliveredItems.length) {
    return false;
  }
  // Idle flush is only for lightweight commentary. Letting unfinished final
  // text flush on idle is what produced half-sentences like "...时间" followed
  // by "线，不靠你自己回忆。" in separate WeChat bubbles.
  return deliveredItems.every((item: any) => normalizeText(item?.phase) === "commentary");
}

function prepareStreamingDelivery(state: any, { completedOnly, force }: any) {
  const visibleItems = collectVisibleItems(state, { completedOnly });
  const deliveredItems = [];
  const deltaParts = [];

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

function buildStreamingDeliveredVisibleText(state: any, { completedOnly, deliveredItems, force }: any) {
  const deliveredById = new Map();
  for (const item of Array.isArray(deliveredItems) ? deliveredItems : []) {
    deliveredById.set(item.itemId, item.visibleText);
  }

  const parts: string[] = [];
  const seenParts = new Set();
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

function commitPreparedStreamingDelivery(prepared: any, { delivered }: any) {
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

function hasCompletedFlushTrigger(trigger: any, runtimeEventTypes: any) {
  const source = normalizeText(trigger?.source);
  return source === runtimeEventTypes.REPLY_COMPLETED
    || source === runtimeEventTypes.TURN_COMPLETED
    || source === "finishTurn"
    || source === "finalizeAbandonedTurn";
}

function hasNaturalFlushBoundary(text: any) {
  const normalized = trimOuterBlankLines(normalizeLineEndings(text));
  if (!normalized) {
    return false;
  }
  return /\n\n$/.test(normalized)
    || /\n$/.test(normalized)
    || /(?:[。！？!?]|[.!?]["'”’）)\]」』】]?)$/.test(normalized);
}

module.exports = {
  buildAllVisibleReplyText,
  buildCurrentSafeReplyText,
  buildReplyText,
  buildSettledReplyText,
  buildStreamingReplyText,
  commitPreparedStreamingDelivery,
  findLatestVisibleReplyText,
  findLatestWatchdogVisibleReply,
  findLatestWatchdogVisibleReplyText,
  findStreamingTerminalReplyText,
  hasCompletedFlushTrigger,
  hasNaturalFlushBoundary,
  normalizeDeliveryDelta,
  normalizeWeixinReplyMode,
  prefersSettledDelivery,
  prefersStreamingDelivery,
  prepareStreamingDelivery,
  shouldPreserveStreamingBlock,
  shouldScheduleStreamingIdleFlush,
};

export {};
