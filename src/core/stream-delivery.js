const crypto = require("crypto");
const { sanitizeProtocolLeakText } = require("../adapters/runtime/codex/protocol-leak-monitor");
const { normalizeAssistantPhase } = require("../adapters/runtime/codex/message-utils");

const RECENT_WEIXIN_DELIVERY_TTL_MS = 30_000;
const STREAM_PROGRESS_MAX_CHARS = 120;
const STREAM_PROGRESS_MAX_LINES = 2;

class StreamDelivery {
  constructor({
    channelAdapter,
    sessionStore,
    weixinReplyMode = "settled",
    deliveryTraceEnabled = false,
    onDeliveryFailure = null,
  }) {
    this.channelAdapter = channelAdapter;
    this.sessionStore = sessionStore;
    this.weixinReplyMode = normalizeWeixinReplyMode(weixinReplyMode);
    this.deliveryTraceEnabled = Boolean(deliveryTraceEnabled);
    this.onDeliveryFailure = typeof onDeliveryFailure === "function" ? onDeliveryFailure : null;
    this.replyTargetByBindingKey = new Map();
    this.pendingReplyTargetsByThreadId = new Map();
    this.stateByRunKey = new Map();
    this.ignoredRunKeys = new Set();
    this.recentSettledWeixinDeliveries = new Map();
  }

  setReplyTarget(bindingKey, target) {
    if (!bindingKey || !target?.userId || !target?.contextToken) {
      return;
    }
    this.replyTargetByBindingKey.set(bindingKey, {
      userId: String(target.userId).trim(),
      contextToken: String(target.contextToken).trim(),
      provider: normalizeText(target.provider),
    });
  }

  queueReplyTargetForThread(threadId, target) {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId || !target?.userId || !target?.contextToken) {
      return;
    }
    const queue = this.pendingReplyTargetsByThreadId.get(normalizedThreadId) || [];
    queue.push({
      userId: String(target.userId).trim(),
      contextToken: String(target.contextToken).trim(),
      provider: normalizeText(target.provider),
    });
    this.pendingReplyTargetsByThreadId.set(normalizedThreadId, queue);
  }

  async handleRuntimeEvent(event) {
    const threadId = normalizeText(event?.payload?.threadId);
    const turnId = normalizeText(event?.payload?.turnId);
    if (!threadId) {
      return;
    }
    const ignoredRunKey = turnId ? buildRunKey(threadId, turnId) : "";
    if (ignoredRunKey && this.ignoredRunKeys.has(ignoredRunKey)) {
      if (event.type === "runtime.turn.completed" || event.type === "runtime.turn.failed") {
        this.ignoredRunKeys.delete(ignoredRunKey);
      }
      return;
    }

    switch (event.type) {
      case "runtime.turn.started": {
        this.disposeSupersededAbandonedRuns(threadId, turnId);
        const state = this.ensureRunState(threadId, turnId);
        state.turnId = turnId || state.turnId;
        state.abandonedAt = 0;
        this.attachReplyTarget(state);
        return;
      }
      case "runtime.reply.delta": {
        const state = this.ensureRunState(threadId, turnId);
        state.abandonedAt = 0;
        this.upsertItem(state, {
          itemId: normalizeText(event.payload.itemId) || `item-${state.itemOrder.length + 1}`,
          text: normalizeLineEndings(event.payload.text),
          completed: false,
          phase: normalizeAssistantPhase(event.payload.phase),
        });
        return;
      }
      case "runtime.reply.completed": {
        const state = this.ensureRunState(threadId, turnId);
        state.abandonedAt = 0;
        const itemId = normalizeText(event.payload.itemId) || `item-${state.itemOrder.length + 1}`;
        const phase = normalizeAssistantPhase(event.payload.phase);
        this.upsertItem(state, {
          itemId,
          text: normalizeLineEndings(event.payload.text),
          completed: true,
          phase,
        });
        await this.flush(state, {
          force: false,
          trigger: {
            source: event.type,
            itemId,
            phase,
          },
        });
        return;
      }
      case "runtime.turn.completed": {
        const state = this.ensureRunState(threadId, turnId);
        state.turnId = turnId || state.turnId;
        state.abandonedAt = 0;
        await this.flush(state, {
          force: true,
          trigger: { source: event.type },
        });
        this.disposeRunState(state.runKey);
        return;
      }
      case "runtime.turn.failed":
        this.disposeRunState(buildRunKey(threadId, turnId));
        return;
      default:
        return;
    }
  }

  async finishTurn({ threadId, finalText }) {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedFinalText = normalizeLineEndings(finalText);
    if (!normalizedThreadId || !normalizedFinalText) {
      return;
    }

    const state = this.ensureRunState(normalizedThreadId, "");
    this.attachReplyTarget(state);
    if (!state.itemOrder.length) {
      this.upsertItem(state, {
        itemId: "final",
        text: normalizedFinalText,
        completed: true,
      });
    } else {
      const itemId = state.itemOrder[state.itemOrder.length - 1] || "final";
      this.setItemText(state, itemId, normalizedFinalText, true);
      for (const candidateId of state.itemOrder) {
        const item = state.items.get(candidateId);
        if (item) {
          item.currentText = item.completedText || item.currentText;
          item.completed = true;
        }
      }
    }

    await this.flush(state, {
      force: true,
      trigger: {
        source: "finishTurn",
        itemId: state.itemOrder[state.itemOrder.length - 1] || "final",
      },
    });
    this.disposeRunState(state.runKey);
  }

  async finalizeAbandonedTurn({ threadId, turnId = "", trailingText = "" }) {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const normalizedTrailingText = normalizeLineEndings(trailingText).trim();
    if (!normalizedThreadId) {
      return;
    }

    const state = this.findRunState(normalizedThreadId, normalizedTurnId);
    if (!state) {
      // If this exact turn is already gone, do not resurrect a new pending run
      // just to send the watchdog suffix again. That creates duplicate "tail"
      // messages after delivery failure or other local terminal states.
      if (normalizedTurnId) {
        return;
      }
      if (normalizedTrailingText) {
        await this.finishTurn({
          threadId: normalizedThreadId,
          finalText: normalizedTrailingText,
        });
      }
      return;
    }

    this.attachReplyTarget(state);
    if (normalizedTrailingText) {
      this.upsertItem(state, {
        itemId: "__watchdog__",
        text: normalizedTrailingText,
        completed: true,
      });
    }
    await this.flush(state, {
      force: true,
      trigger: {
        source: "finalizeAbandonedTurn",
        itemId: normalizedTrailingText ? "__watchdog__" : "",
      },
    });
    removeStateItem(state, "__watchdog__");
    state.sentText = buildCurrentSafeReplyText(state, { force: true });
    state.abandonedAt = Date.now();
  }

  ensureRunState(threadId, turnId = "") {
    const runKey = buildRunKey(threadId, turnId);
    const existing = this.stateByRunKey.get(runKey);
    if (existing) {
      return existing;
    }

    const created = {
      runKey,
      threadId,
      bindingKey: "",
      replyTarget: null,
      turnId: normalizeText(turnId),
      itemOrder: [],
      items: new Map(),
      weixinReplyMode: this.weixinReplyMode,
      sentText: "",
      sendChain: Promise.resolve(),
      flushPromise: null,
      abandonedAt: 0,
    };
    this.stateByRunKey.set(runKey, created);
    this.attachReplyTarget(created);
    return created;
  }

  findRunState(threadId, turnId = "") {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedThreadId) {
      return null;
    }
    if (normalizedTurnId) {
      const exact = this.stateByRunKey.get(buildRunKey(normalizedThreadId, normalizedTurnId));
      if (exact) {
        return exact;
      }
    }
    const pending = this.stateByRunKey.get(buildRunKey(normalizedThreadId, ""));
    if (pending && (!normalizedTurnId || !pending.turnId || pending.turnId === normalizedTurnId)) {
      return pending;
    }
    for (const candidate of this.stateByRunKey.values()) {
      if (candidate.threadId !== normalizedThreadId) {
        continue;
      }
      if (!normalizedTurnId || candidate.turnId === normalizedTurnId) {
        return candidate;
      }
    }
    return null;
  }

  attachReplyTarget(state) {
    if (!state.replyTarget) {
      const queue = this.pendingReplyTargetsByThreadId.get(state.threadId) || [];
      if (queue.length) {
        state.replyTarget = queue.shift();
        if (queue.length) {
          this.pendingReplyTargetsByThreadId.set(state.threadId, queue);
        } else {
          this.pendingReplyTargetsByThreadId.delete(state.threadId);
        }
      }
    }
    const linked = this.sessionStore.findBindingForThreadId(state.threadId);
    if (!linked?.bindingKey) {
      return;
    }
    state.bindingKey = linked.bindingKey;
    if (!state.replyTarget) {
      const target = this.replyTargetByBindingKey.get(linked.bindingKey);
      state.replyTarget = target;
    }
  }

  upsertItem(state, { itemId, text, completed, phase = "" }) {
    if (!text) {
      return;
    }
    if (!state.items.has(itemId)) {
      state.itemOrder.push(itemId);
      state.items.set(itemId, {
        currentText: "",
        completedText: "",
        completed: false,
        phase: "",
      });
    }

    const current = state.items.get(itemId);
    const normalizedPhase = normalizeAssistantPhase(phase);
    if (normalizedPhase) {
      current.phase = normalizedPhase;
    }
    if (completed) {
      const merged = mergeCompletedItemText(current.currentText, text);
      current.currentText = merged;
      current.completedText = merged;
      current.completed = true;
      return;
    }

    current.currentText = appendStreamingText(current.currentText, text);
  }

  setItemText(state, itemId, text, completed) {
    if (!text) {
      return;
    }
    if (!state.items.has(itemId)) {
      state.itemOrder.push(itemId);
        state.items.set(itemId, {
          currentText: "",
          completedText: "",
          completed: false,
          phase: "",
        });
    }

    const current = state.items.get(itemId);
    current.currentText = text;
    if (completed) {
      current.completedText = text;
    }
    current.completed = Boolean(completed);
  }

  async flush(state, { force, trigger = null }) {
    const previous = state.flushPromise || Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(() => this.flushNow(state, { force, trigger }));
    const tracked = current.finally(() => {
      const latestState = this.stateByRunKey.get(state.runKey);
      if (latestState && latestState.flushPromise === tracked) {
        latestState.flushPromise = null;
      }
    });
    state.flushPromise = tracked;
    await tracked;
  }

  async flushNow(state, { force, trigger = null }) {
    if (!state.replyTarget) {
      return;
    }
    // WeChat reply mode is explicit. `settled` waits for the terminal snapshot;
    // `stream` ships user-visible assistant message blocks as they complete.
    // Keep the modes distinct here so future "optimize the stream" tweaks do
    // not accidentally reintroduce token-level spam or repeated block sends.
    if (!force && prefersSettledDelivery(state)) {
      return;
    }

    const plainText = markdownToPlainText(buildReplyText(state, {
      completedOnly: !force,
      preferLatestMessage: prefersSettledDelivery(state),
      force,
    }));
    const sanitized = sanitizeReplyText(state.replyTarget, plainText);
    if (sanitized.suppress) {
      state.sentText = sanitized.text;
      console.log(
        `[codeksei] suppressed system reply `
        + `thread=${state.threadId} turn=${state.turnId || "(pending)"} `
        + `preview=${JSON.stringify(plainText.slice(0, 80))}`
      );
      return;
    }
    const safeText = sanitized.text;
    if (!safeText || safeText === state.sentText) {
      return;
    }

    if (state.sentText && !safeText.startsWith(state.sentText)) {
      console.warn(`[codeksei] skip non-monotonic reply thread=${state.threadId}`);
      return;
    }

    const delta = normalizeDeliveryDelta(
      safeText.slice(state.sentText.length),
      { streaming: prefersStreamingDelivery(state) }
    );
    if (!delta) {
      return;
    }

    if (!delta.trim()) {
      state.sentText = safeText;
      return;
    }

    const deliveryDedupKey = buildSettledWeixinDeliveryKey(state, safeText);
    if (deliveryDedupKey && this.wasRecentlyDelivered(deliveryDedupKey)) {
      state.sentText = safeText;
      console.warn(`[codeksei] suppress duplicate weixin delivery thread=${state.threadId}`);
      return;
    }

    const settledWechatDelivery = prefersSettledDelivery(state);
    const tracePayload = buildDeliveryTracePayload(state, {
      force,
      trigger,
      traceId: this.deliveryTraceEnabled ? crypto.randomUUID().slice(0, 8) : "",
      safeText,
      delta,
    });
    state.sendChain = state.sendChain.then(async () => {
      this.logDeliveryTrace("attempt", tracePayload);
      await this.channelAdapter.sendText({
        userId: state.replyTarget.userId,
        text: delta,
        contextToken: state.replyTarget.contextToken,
        preserveBlock: settledWechatDelivery,
        trace: this.deliveryTraceEnabled
          ? {
            ...tracePayload,
            origin: "stream-delivery",
            preserveBlock: settledWechatDelivery,
          }
          : null,
      });
      state.sentText = safeText;
      this.logDeliveryTrace("delivered", tracePayload);
      if (deliveryDedupKey) {
        this.rememberRecentDelivery(deliveryDedupKey);
        console.log(
          `[codeksei] delivered weixin reply `
          + `thread=${state.threadId} turn=${state.turnId || "(pending)"} `
          + `chars=${safeText.length} hash=${hashReplyText(safeText)}`
        );
      }
    }).catch((error) => {
      this.logDeliveryTrace("failed", tracePayload, error);
      console.error(`[codeksei] failed to deliver reply thread=${state.threadId}: ${error.message}`);
      this.handleDeliveryFailure(state, error);
    });

    await state.sendChain;
  }

  handleDeliveryFailure(state, error) {
    if (!state?.runKey) {
      return;
    }
    // Once WeChat delivery has exhausted its retries for this run, continuing
    // to stream later deltas only creates repeated send failures and fake typing.
    this.ignoredRunKeys.add(state.runKey);
    this.disposeRunState(state.runKey);
    if (!this.onDeliveryFailure) {
      return;
    }
    Promise.resolve(this.onDeliveryFailure({
      threadId: state.threadId,
      turnId: state.turnId,
      bindingKey: state.bindingKey,
      error,
      sentText: state.sentText,
      replyTarget: state.replyTarget ? { ...state.replyTarget } : null,
    })).catch((callbackError) => {
      console.error(`[codeksei] delivery failure callback crashed thread=${state.threadId}: ${callbackError.message}`);
    });
  }

  disposeSupersededAbandonedRuns(threadId, activeTurnId = "") {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedActiveTurnId = normalizeText(activeTurnId);
    if (!normalizedThreadId) {
      return;
    }
    for (const candidate of this.stateByRunKey.values()) {
      if (candidate.threadId !== normalizedThreadId || !candidate.abandonedAt) {
        continue;
      }
      if (normalizedActiveTurnId && candidate.turnId === normalizedActiveTurnId) {
        continue;
      }
      this.ignoredRunKeys.add(candidate.runKey);
      this.disposeRunState(candidate.runKey);
    }
  }

  disposeRunState(runKey) {
    const normalizedRunKey = normalizeText(runKey);
    if (!normalizedRunKey) {
      return;
    }
    this.stateByRunKey.delete(normalizedRunKey);
  }

  wasRecentlyDelivered(key) {
    this.pruneRecentDeliveries();
    const deliveredAt = this.recentSettledWeixinDeliveries.get(key);
    return Number.isFinite(deliveredAt) && (Date.now() - deliveredAt) <= RECENT_WEIXIN_DELIVERY_TTL_MS;
  }

  rememberRecentDelivery(key) {
    this.pruneRecentDeliveries();
    this.recentSettledWeixinDeliveries.set(key, Date.now());
  }

  pruneRecentDeliveries() {
    const now = Date.now();
    for (const [key, deliveredAt] of this.recentSettledWeixinDeliveries.entries()) {
      if (!Number.isFinite(deliveredAt) || (now - deliveredAt) > RECENT_WEIXIN_DELIVERY_TTL_MS) {
        this.recentSettledWeixinDeliveries.delete(key);
      }
    }
  }

  logDeliveryTrace(stage, payload, error = null) {
    if (!this.deliveryTraceEnabled || !payload) {
      return;
    }
    const parts = [
      `[codeksei] weixin delivery trace stage=${stage}`,
      `pid=${process.pid}`,
      `trace=${payload.traceId || "(none)"}`,
      `thread=${payload.threadId}`,
      `turn=${payload.turnId || "(pending)"}`,
      `mode=${payload.mode}`,
      `force=${payload.force ? "1" : "0"}`,
      payload.trigger ? `trigger=${payload.trigger}` : "",
      `sentCharsBefore=${payload.sentCharsBefore}`,
      `safeChars=${payload.safeChars}`,
      `deltaChars=${payload.deltaChars}`,
      `safeHash=${payload.safeHash}`,
      `deltaHash=${payload.deltaHash}`,
    ].filter(Boolean);
    if (error) {
      parts.push(`error=${JSON.stringify(String(error?.message || error || ""))}`);
      console.error(parts.join(" "));
      return;
    }
    console.log(parts.join(" "));
  }
}

function buildRunKey(threadId, turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  return normalizedTurnId
    ? `${normalizedThreadId}:${normalizedTurnId}`
    : `${normalizedThreadId}:pending`;
}

function buildReplyText(state, { completedOnly, preferLatestMessage = false, force = false }) {
  if (force && hasWatchdogTail(state, { completedOnly })) {
    if (prefersStreamingDelivery(state)) {
      return buildStreamingWatchdogReplyText(state, { completedOnly });
    }
    return buildSettledReplyText(state, { completedOnly });
  }

  if (preferLatestMessage) {
    return buildSettledReplyText(state, { completedOnly });
  }

  if (prefersStreamingDelivery(state)) {
    return buildStreamingReplyText(state, { completedOnly, force });
  }

  return buildAllVisibleReplyText(state, { completedOnly });
}

function buildStreamingReplyText(state, { completedOnly, force }) {
  const visibleItems = collectVisibleItems(state, { completedOnly });
  const parts = [];
  const seenParts = new Set();
  const lastVisibleReplyIndex = findLastVisibleReplyIndex(visibleItems);

  for (let index = 0; index < visibleItems.length; index += 1) {
    const item = visibleItems[index];
    if (!shouldStreamImmediately(item, { isTerminalVisibleItem: index === lastVisibleReplyIndex })) {
      continue;
    }
    rememberVisiblePart(parts, seenParts, item.text);
  }

  if (!force) {
    return parts.join("\n\n");
  }

  const terminal = findStreamingTerminalReplyText(visibleItems);
  if (terminal) {
    // `stream` means "ship completed user-visible blocks early when safe", not
    // "stitch every unseen progress block onto the terminal answer". If no
    // user-visible text has actually gone out yet, collapsing to the terminal
    // block avoids the historical failure mode where several brief progress
    // items get welded onto the final answer as one duplicated mega-bubble.
    if (!normalizeVisibleStreamingText(state.sentText)) {
      return terminal.text;
    }
    rememberVisiblePart(parts, seenParts, terminal.text);
  }
  return parts.join("\n\n");
}

function buildStreamingWatchdogReplyText(state, { completedOnly }) {
  const visible = buildStreamingReplyText(state, { completedOnly, force: true });
  const tail = readStateItemText(state, "__watchdog__", { completedOnly });
  return [visible, tail].filter(Boolean).join("\n\n");
}

function buildCurrentSafeReplyText(state, { force = false, completedOnly = false } = {}) {
  const plainText = markdownToPlainText(buildReplyText(state, {
    completedOnly,
    preferLatestMessage: prefersSettledDelivery(state),
    force,
  }));
  return sanitizeReplyText(state.replyTarget, plainText).text;
}

function buildSettledReplyText(state, { completedOnly }) {
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
  return [visible, tail].filter(Boolean).join("\n\n");
}

function buildAllVisibleReplyText(
  state,
  { completedOnly, skipItemIds = null, collapseDuplicateVisibleItems = false }
) {
  const parts = [];
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

function findLatestVisibleReplyText(state, { completedOnly }) {
  const visibleItems = collectVisibleItems(state, { completedOnly });
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    if (visibleItems[index].itemId !== "__watchdog__") {
      return visibleItems[index].text;
    }
  }
  return "";
}

function findLatestWatchdogVisibleReplyText(state, { completedOnly }) {
  const visibleItems = collectVisibleItems(state, {
    completedOnly,
    skipItemIds: new Set(["__watchdog__"]),
  });
  const candidate = findLatestWatchdogVisibleReply(visibleItems);
  return candidate?.text || "";
}

function findLatestWatchdogVisibleReply(visibleItems) {
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

function findStreamingTerminalReplyText(visibleItems) {
  const lastVisibleReplyIndex = findLastVisibleReplyIndex(visibleItems);
  if (lastVisibleReplyIndex < 0) {
    return null;
  }
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    const item = visibleItems[index];
    if (item.itemId === "__watchdog__") {
      continue;
    }
    if (!shouldStreamImmediately(item, { isTerminalVisibleItem: index === lastVisibleReplyIndex })) {
      return item;
    }
  }
  return visibleItems[lastVisibleReplyIndex] || null;
}

function findLastVisibleReplyIndex(visibleItems) {
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    if (visibleItems[index]?.itemId !== "__watchdog__") {
      return index;
    }
  }
  return -1;
}

function readStateItemText(state, itemId, { completedOnly }) {
  const item = state.items.get(itemId);
  if (!item) {
    return "";
  }
  const sourceText = completedOnly
    ? (item.completed ? item.completedText : "")
    : (item.completed ? item.completedText : item.currentText);
  return trimOuterBlankLines(sourceText);
}

function collectVisibleItems(state, { completedOnly, skipItemIds = null }) {
  const items = [];
  for (const itemId of state.itemOrder) {
    if (skipItemIds?.has(itemId)) {
      continue;
    }
    const text = readStateItemText(state, itemId, { completedOnly });
    if (!text) {
      continue;
    }
    const item = state.items.get(itemId);
    items.push({
      itemId,
      text,
      completed: Boolean(item?.completed),
      phase: normalizeAssistantPhase(item?.phase),
    });
  }
  return items;
}

function removeStateItem(state, itemId) {
  const normalizedItemId = normalizeText(itemId);
  if (!normalizedItemId || !state?.items?.has(normalizedItemId)) {
    return;
  }
  state.items.delete(normalizedItemId);
  state.itemOrder = state.itemOrder.filter((candidateId) => candidateId !== normalizedItemId);
}

function markdownToPlainText(text) {
  let result = normalizeLineEndings(text);
  result = result.replace(/```([^\n]*)\n?([\s\S]*?)```/g, (_, language, code) => {
    const label = String(language || "").trim();
    const body = indentBlock(String(code || ""));
    return label ? `\n${label}:\n${body}\n` : `\n代码:\n${body}\n`;
  });
  result = result.replace(/```([^\n]*)\n?([\s\S]*)$/g, (_, language, code) => {
    const label = String(language || "").trim();
    const body = indentBlock(String(code || ""));
    return label ? `\n${label}:\n${body}\n` : `\n代码:\n${body}\n`;
  });
  result = result.replace(/!\[[^\]]*]\([^)]*\)/g, "");
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/^#{1,6}\s*(.+)$/gm, "$1");
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/\*([^*]+)\*/g, "$1");
  result = result.replace(/^>\s?/gm, "> ");
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_, inner) =>
    String(inner || "").split("|").map((cell) => cell.trim()).join("  ")
  );
  result = result.replace(/\n{3,}/g, "\n\n");
  return trimOuterBlankLines(result);
}

function appendStreamingText(current, next) {
  const base = String(current || "");
  const incoming = String(next || "");
  if (!incoming) {
    return base;
  }
  if (!base) {
    return incoming;
  }
  if (base.endsWith(incoming)) {
    return base;
  }
  if (incoming.startsWith(base)) {
    return incoming;
  }

  const maxOverlap = Math.min(base.length, incoming.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (base.slice(-size) === incoming.slice(0, size)) {
      return `${base}${incoming.slice(size)}`;
    }
  }

  return `${base}${incoming}`;
}

function prefersSettledDelivery(state) {
  return normalizeText(state?.replyTarget?.provider) === "weixin"
    && normalizeWeixinReplyMode(state?.weixinReplyMode) === "settled";
}

function prefersStreamingDelivery(state) {
  return normalizeText(state?.replyTarget?.provider) === "weixin"
    && normalizeWeixinReplyMode(state?.weixinReplyMode) === "stream";
}

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

function buildDeliveryMode(state) {
  if (prefersSettledDelivery(state)) {
    return "settled";
  }
  if (prefersStreamingDelivery(state)) {
    return "stream";
  }
  return normalizeText(state?.replyTarget?.provider) || "unknown";
}

function buildDeliveryTracePayload(state, {
  force = false,
  trigger = null,
  traceId = "",
  safeText = "",
  delta = "",
} = {}) {
  return {
    traceId: normalizeText(traceId),
    threadId: normalizeText(state?.threadId),
    turnId: normalizeText(state?.turnId),
    mode: buildDeliveryMode(state),
    force: Boolean(force),
    trigger: formatDeliveryTrigger(trigger),
    sentCharsBefore: String(state?.sentText || "").length,
    safeChars: String(safeText || "").length,
    deltaChars: String(delta || "").length,
    safeHash: hashReplyText(safeText),
    deltaHash: hashReplyText(delta),
  };
}

function formatDeliveryTrigger(trigger) {
  if (!trigger || typeof trigger !== "object") {
    return "";
  }
  return [
    normalizeText(trigger.source),
    normalizeText(trigger.itemId),
    normalizeText(trigger.phase),
  ].filter(Boolean).join("/");
}

function hashReplyText(text) {
  return crypto.createHash("sha1").update(String(text || ""), "utf8").digest("hex").slice(0, 12);
}

function mergeCompletedItemText(current, completed) {
  const streamed = String(current || "");
  const finalized = String(completed || "");
  if (!finalized) {
    return streamed;
  }
  if (!streamed) {
    return finalized;
  }
  // Upstream can resend the same final item with only whitespace / formatting
  // differences between delta and completed snapshots. Treat those as the same
  // semantic block so we do not concatenate two copies of the same answer.
  if (normalizeVisibleStreamingText(streamed) === normalizeVisibleStreamingText(finalized)) {
    return finalized;
  }
  return appendStreamingText(streamed, finalized);
}

function indentBlock(text) {
  const normalized = trimOuterBlankLines(normalizeLineEndings(text));
  if (!normalized) {
    return "";
  }
  return normalized.split("\n").map((line) => `    ${line}`).join("\n");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWeixinReplyMode(value) {
  return normalizeText(value).toLowerCase() === "settled" ? "settled" : "stream";
}

function normalizeLineEndings(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function normalizeDeliveryDelta(delta, { streaming = false } = {}) {
  const normalized = String(delta || "");
  if (!streaming) {
    return normalized;
  }
  // Stream mode ships completed assistant items one message at a time. The
  // snapshot diff can therefore start with the joiner's blank lines; trim only
  // that transport artifact so the next item lands as a clean standalone send.
  return normalized.replace(/^\n+/u, "");
}

function buildVisibleItemDedupKey(text) {
  return trimOuterBlankLines(markdownToPlainText(normalizeLineEndings(text)));
}

function normalizeVisibleStreamingText(text) {
  return buildVisibleItemDedupKey(text).replace(/\s+/gu, " ").trim();
}

function hasWatchdogTail(state, { completedOnly }) {
  return Boolean(readStateItemText(state, "__watchdog__", { completedOnly }));
}

function rememberVisiblePart(parts, seenParts, text) {
  const dedupeKey = buildVisibleItemDedupKey(text);
  if (dedupeKey && seenParts.has(dedupeKey)) {
    return;
  }
  if (dedupeKey) {
    seenParts.add(dedupeKey);
  }
  parts.push(text);
}

function shouldStreamImmediately(item, { isTerminalVisibleItem = false } = {}) {
  if (!item?.text || item.itemId === "__watchdog__") {
    return false;
  }
  const phase = normalizeAssistantPhase(item.phase);
  if (phase === "final") {
    return false;
  }
  if (!isBriefStreamingProgressText(item.text)) {
    return false;
  }
  if (phase === "commentary") {
    return true;
  }
  // When phase is missing, the current terminal short block could still be the
  // user's final answer. Hold only that trailing block until another visible
  // item arrives or the turn completes, so we do not leak a short final reply
  // early just because upstream omitted phase metadata once.
  return !isTerminalVisibleItem;
}

function isBriefStreamingProgressText(text) {
  const raw = trimOuterBlankLines(normalizeLineEndings(text));
  if (!raw) {
    return false;
  }
  if (
    raw.includes("```")
    || raw.includes("\n\n")
    || /\[[^\]]+\]\([^)]+\)/u.test(raw)
    || /^\s*(?:[-*]|\d+\.)\s/mu.test(raw)
    || raw.includes("【继续任务】")
    || raw.includes("【当前状态】")
    || raw.includes("【执行前检查】")
  ) {
    return false;
  }
  const plain = buildVisibleItemDedupKey(raw);
  if (!plain || plain.length > STREAM_PROGRESS_MAX_CHARS) {
    return false;
  }
  const lineCount = plain.split("\n").filter(Boolean).length;
  return lineCount > 0 && lineCount <= STREAM_PROGRESS_MAX_LINES;
}

function trimOuterBlankLines(text) {
  return String(text || "")
    .replace(/^\s*\n+/g, "")
    .replace(/\n+\s*$/g, "");
}

function shouldSuppressSystemReply(replyTarget, plainReplyText) {
  if (replyTarget?.provider !== "system") {
    return false;
  }
  const normalized = normalizeLineEndings(String(plainReplyText || ""));
  const compact = normalized.trim();
  if (!compact) {
    return false;
  }
  const sentinelNormalized = normalizeSilentSentinelText(compact);
  if (compact === "CB_SILENT" || compact === "__SILENT__" || compact === "SILENT") {
    return true;
  }
  if (containsStructuredSilentSignal(normalized)) {
    return true;
  }
  if (compact.toUpperCase().includes("CB_SILENT") || compact.toUpperCase().includes("__SILENT__")) {
    return true;
  }
  if (sentinelNormalized.includes("CB_SILENT") || sentinelNormalized.includes("__SILENT__") || sentinelNormalized.includes("SILENT")) {
    return true;
  }
  return normalized
    .split("\n")
    .map((line) => normalizeSilentSentinelText(line.trim()))
    .some((line) => line === "CB_SILENT" || line === "__SILENT__" || line === "SILENT");
}

function sanitizeReplyText(replyTarget, plainReplyText) {
  const normalized = normalizeLineEndings(String(plainReplyText || ""));
  if (!normalized) {
    return { suppress: false, text: "" };
  }
  const protocolSanitized = sanitizeProtocolLeakText(normalized);
  const safeText = protocolSanitized.text || "";
  if (shouldSuppressSystemReply(replyTarget, safeText)) {
    return { suppress: true, text: "" };
  }
  const cleaned = stripSilentSentinelArtifacts(safeText);
  return {
    suppress: false,
    text: trimOuterBlankLines(cleaned),
  };
}

function normalizeSilentSentinelText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z_]/g, "");
}

function stripSilentSentinelArtifacts(value) {
  return normalizeLineEndings(String(value || ""))
    .replace(/\{\s*"cyberboss_action"\s*:\s*"silent"\s*\}/gi, "")
    .split("\n")
    .map((line) => {
      const parts = line.split(/\s+/);
      const kept = parts.filter((part) => !isSilentSentinelToken(part));
      return kept.join(" ").trim();
    })
    .filter((line, index, lines) => line || (index > 0 && index < lines.length - 1))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function isSilentSentinelToken(value) {
  const normalized = normalizeSilentSentinelText(value);
  return normalized === "CB_SILENT" || normalized === "__SILENT__" || normalized === "SILENT";
}

function containsStructuredSilentSignal(value) {
  return /\{\s*"cyberboss_action"\s*:\s*"silent"\s*\}/i.test(String(value || ""));
}

module.exports = { StreamDelivery };
