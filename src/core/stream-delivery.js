const crypto = require("crypto");
const { sanitizeProtocolLeakText } = require("../adapters/runtime/codex/protocol-leak-monitor");
const { normalizeAssistantPhase } = require("../adapters/runtime/codex/message-utils");

const RECENT_WEIXIN_DELIVERY_TTL_MS = 30_000;
const STREAM_PROGRESS_MAX_CHARS = 120;
const STREAM_PROGRESS_MAX_LINES = 2;
const STREAM_IDLE_FLUSH_MS = 500;
const STREAM_FORCE_FLUSH_CHARS = 100;
const STREAM_BOUNDARY_FLUSH_CHARS = 30;
const WEIXIN_DUPLICATE_BLOCK_MIN_CHARS = 120;
const WEIXIN_DUPLICATE_BLOCK_MIN_SEGMENTS = 2;

class StreamDelivery {
  constructor({
    channelAdapter,
    sessionStore,
    weixinReplyMode = "settled",
    deliveryTraceEnabled = false,
    onDeliveryFailure = null,
    streamIdleFlushMs = STREAM_IDLE_FLUSH_MS,
    streamForceFlushChars = STREAM_FORCE_FLUSH_CHARS,
    streamBoundaryFlushChars = STREAM_BOUNDARY_FLUSH_CHARS,
  }) {
    this.channelAdapter = channelAdapter;
    this.sessionStore = sessionStore;
    this.weixinReplyMode = normalizeWeixinReplyMode(weixinReplyMode);
    this.deliveryTraceEnabled = Boolean(deliveryTraceEnabled);
    this.onDeliveryFailure = typeof onDeliveryFailure === "function" ? onDeliveryFailure : null;
    this.streamIdleFlushMs = numberOrDefault(streamIdleFlushMs, STREAM_IDLE_FLUSH_MS);
    this.streamForceFlushChars = numberOrDefault(streamForceFlushChars, STREAM_FORCE_FLUSH_CHARS);
    this.streamBoundaryFlushChars = numberOrDefault(streamBoundaryFlushChars, STREAM_BOUNDARY_FLUSH_CHARS);
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
        const itemId = normalizeText(event.payload.itemId) || `item-${state.itemOrder.length + 1}`;
        const phase = normalizeAssistantPhase(event.payload.phase);
        const fragmentKind = normalizeFragmentKind(event.payload.fragmentKind) || "delta";
        const fragment = this.upsertItem(state, {
          itemId,
          text: normalizeLineEndings(event.payload.text),
          completed: false,
          phase,
          fragmentKind,
        });
        this.scheduleStreamingFlush(state, {
          force: false,
          trigger: {
            source: event.type,
            itemId,
            phase,
            fragmentKind,
            fragmentRelation: fragment.relation,
          },
        });
        return;
      }
      case "runtime.reply.completed": {
        const state = this.ensureRunState(threadId, turnId);
        state.abandonedAt = 0;
        const itemId = normalizeText(event.payload.itemId) || `item-${state.itemOrder.length + 1}`;
        const phase = normalizeAssistantPhase(event.payload.phase);
        const fragment = this.upsertItem(state, {
          itemId,
          text: normalizeLineEndings(event.payload.text),
          completed: true,
          phase,
          fragmentKind: "completed_snapshot",
        });
        this.clearScheduledFlush(state);
        await this.flush(state, {
          force: false,
          trigger: {
            source: event.type,
            itemId,
            phase,
            fragmentKind: "completed_snapshot",
            fragmentRelation: fragment.relation,
          },
        });
        return;
      }
      case "runtime.turn.completed": {
        const state = this.ensureRunState(threadId, turnId);
        state.turnId = turnId || state.turnId;
        state.abandonedAt = 0;
        this.clearScheduledFlush(state);
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
        phase: "final",
        fragmentKind: "completed_snapshot",
      });
    } else {
      const itemId = state.itemOrder[state.itemOrder.length - 1] || "final";
      this.setItemText(state, itemId, normalizedFinalText, true);
      for (const candidateId of state.itemOrder) {
        const item = state.items.get(candidateId);
        if (item) {
          item.authoritativeText = item.completedText || item.authoritativeText;
          item.currentText = item.authoritativeText;
          item.completed = true;
        }
      }
    }

    await this.flush(state, {
      force: true,
      trigger: {
        source: "finishTurn",
        itemId: state.itemOrder[state.itemOrder.length - 1] || "final",
        fragmentKind: "completed_snapshot",
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
    this.clearScheduledFlush(state);
    if (normalizedTrailingText) {
      this.upsertItem(state, {
        itemId: "__watchdog__",
        text: normalizedTrailingText,
        completed: true,
        fragmentKind: "completed_snapshot",
      });
    }
    await this.flush(state, {
      force: true,
      trigger: {
        source: "finalizeAbandonedTurn",
        itemId: normalizedTrailingText ? "__watchdog__" : "",
        fragmentKind: normalizedTrailingText ? "completed_snapshot" : "",
      },
    });
    removeStateItem(state, "__watchdog__");
    state.sentText = buildCurrentSafeReplyText(state, { force: true });
    state.lastDeliveredVisibleText = state.sentText;
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
      lastDeliveredVisibleText: "",
      sendChain: Promise.resolve(),
      flushPromise: null,
      scheduledFlushTimer: null,
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

  upsertItem(state, { itemId, text, completed, phase = "", fragmentKind = "" }) {
    const normalizedText = normalizeLineEndings(text);
    if (!normalizedText) {
      return { relation: "keep", text: "" };
    }
    const current = ensureStateItem(state, itemId);
    const normalizedPhase = normalizeAssistantPhase(phase);
    const normalizedFragmentKind = normalizeFragmentKind(fragmentKind);
    if (normalizedPhase) {
      current.phase = normalizedPhase;
    }
    current.lastFragmentAt = Date.now();
    current.lastFragmentKind = normalizedFragmentKind || current.lastFragmentKind;
    const merge = mergeAuthoritativeItemText(current.authoritativeText, normalizedText, {
      fragmentKind: completed ? "completed_snapshot" : normalizedFragmentKind,
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

  setItemText(state, itemId, text, completed) {
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
    this.attachReplyTarget(state);
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

    const completedOnly = prefersSettledDelivery(state) ? !force : false;
    const streamPrepared = prefersStreamingDelivery(state)
      ? prepareStreamingDelivery(state, {
        completedOnly,
        force,
      })
      : null;
    const plainText = streamPrepared
      ? streamPrepared.safeText
      : buildReplyText(state, {
        completedOnly,
        preferLatestMessage: prefersSettledDelivery(state),
        force,
      });
    const sanitized = streamPrepared
      ? { suppress: false, text: plainText }
      : sanitizeReplyText(state.replyTarget, plainText);
    if (sanitized.suppress) {
      state.sentText = sanitized.text;
      state.lastDeliveredVisibleText = sanitized.text;
      console.log(
        `[codeksei] suppressed system reply `
        + `thread=${state.threadId} turn=${state.turnId || "(pending)"} `
        + `preview=${JSON.stringify(plainText.slice(0, 80))}`
      );
      return;
    }
    const safeText = sanitized.text;
    if (!safeText) {
      return;
    }
    let deltaResult = streamPrepared
      ? {
        delta: streamPrepared.safeText,
        relation: streamPrepared.relation,
        deliveredVisibleBefore: state.lastDeliveredVisibleText,
        deliveredVisibleAfter: streamPrepared.deliveredVisibleAfter,
      }
      : computeVisibleDeliveryDelta(state.sentText, safeText);
    let delta = normalizeDeliveryDelta(
      deltaResult.delta,
      { streaming: prefersStreamingDelivery(state) }
    );
    if (
      !delta
      && !streamPrepared
      && Boolean(state.abandonedAt)
      && force
      && safeText
      && safeText !== state.sentText
    ) {
      deltaResult = {
        delta: safeText,
        relation: deltaResult.relation === "rewrite_without_extension"
          ? "late_rewrite"
          : (deltaResult.relation || "late_rewrite"),
        deliveredVisibleBefore: state.sentText,
        deliveredVisibleAfter: safeText,
      };
      delta = safeText;
    }
    if (!delta) {
      if (streamPrepared) {
        commitPreparedStreamingDelivery(streamPrepared, { delivered: false });
      }
      return;
    }

    if (!delta.trim()) {
      state.sentText = safeText;
      state.lastDeliveredVisibleText = safeText;
      if (streamPrepared) {
        commitPreparedStreamingDelivery(streamPrepared, { delivered: false });
      }
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
      relation: deltaResult.relation,
      deliveredVisibleBefore: deltaResult.deliveredVisibleBefore,
      deliveredVisibleAfter: deltaResult.deliveredVisibleAfter,
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
      state.sentText = streamPrepared
        ? (deltaResult.deliveredVisibleAfter || state.lastDeliveredVisibleText || safeText)
        : safeText;
      state.lastDeliveredVisibleText = deltaResult.deliveredVisibleAfter || safeText;
      if (streamPrepared) {
        commitPreparedStreamingDelivery(streamPrepared, { delivered: true });
      }
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
      if (streamPrepared) {
        commitPreparedStreamingDelivery(streamPrepared, { delivered: false });
      }
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
    const state = this.stateByRunKey.get(normalizedRunKey);
    if (state) {
      this.clearScheduledFlush(state);
    }
    this.stateByRunKey.delete(normalizedRunKey);
  }

  scheduleStreamingFlush(state, { force = false, trigger = null } = {}) {
    if (!prefersStreamingDelivery(state)) {
      return;
    }
    const completedOnly = false;
    const prepared = prepareStreamingDelivery(state, { completedOnly, force });
    if (!prepared.safeText) {
      return;
    }
    const flushImmediately = force
      || hasCompletedFlushTrigger(trigger)
      || prepared.safeText.length >= this.streamForceFlushChars
      || (
        prepared.safeText.length >= this.streamBoundaryFlushChars
        && hasNaturalFlushBoundary(prepared.safeText)
      );
    if (flushImmediately) {
      this.clearScheduledFlush(state);
      void this.flush(state, { force, trigger });
      return;
    }
    if (state.scheduledFlushTimer) {
      return;
    }
    state.scheduledFlushTimer = setTimeout(() => {
      state.scheduledFlushTimer = null;
      void this.flush(state, {
        force,
        trigger: {
          source: "scheduled_stream_flush",
          itemId: normalizeText(trigger?.itemId),
          phase: normalizeText(trigger?.phase),
          fragmentKind: normalizeText(trigger?.fragmentKind),
          fragmentRelation: normalizeText(trigger?.fragmentRelation),
        },
      });
    }, this.streamIdleFlushMs);
  }

  clearScheduledFlush(state) {
    if (!state?.scheduledFlushTimer) {
      return;
    }
    clearTimeout(state.scheduledFlushTimer);
    state.scheduledFlushTimer = null;
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
      payload.relation ? `relation=${payload.relation}` : "",
      `visibleBefore=${payload.deliveredVisibleBeforeChars}`,
      `visibleAfter=${payload.deliveredVisibleAfterChars}`,
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

function buildStreamingReplyText(state, { completedOnly }) {
  const parts = [];
  const seenParts = new Set();
  for (const item of collectVisibleItems(state, { completedOnly })) {
    if (!shouldStreamImmediately(item)) {
      continue;
    }
    rememberVisiblePart(parts, seenParts, item.text);
  }
  return parts.join("\n\n");
}

function buildStreamingWatchdogReplyText(state, { completedOnly }) {
  const visible = buildStreamingReplyText(state, { completedOnly });
  const tail = readStateItemText(state, "__watchdog__", { completedOnly });
  const watchdogText = tail ? markdownToPlainText(tail) : "";
  return [visible, watchdogText].filter(Boolean).join("\n\n");
}

function buildCurrentSafeReplyText(state, { force = false, completedOnly = false } = {}) {
  const plainText = buildReplyText(state, {
    completedOnly,
    preferLatestMessage: prefersSettledDelivery(state),
    force,
  });
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
  return [visible, markdownToPlainText(tail)].filter(Boolean).join("\n\n");
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

function normalizeFragmentKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "delta") {
    return "delta";
  }
  if (normalized === "snapshot") {
    return "snapshot";
  }
  if (normalized === "completed_snapshot") {
    return "completed_snapshot";
  }
  return "";
}

function mergeAuthoritativeItemText(current, incoming, { fragmentKind = "", completed = false } = {}) {
  const base = normalizeLineEndings(current);
  const next = normalizeLineEndings(incoming);
  const normalizedFragmentKind = normalizeFragmentKind(
    completed ? "completed_snapshot" : fragmentKind
  ) || (completed ? "completed_snapshot" : "delta");
  if (!next) {
    return { text: base, relation: "keep" };
  }
  if (!base) {
    return {
      text: next,
      relation: normalizedFragmentKind === "delta" ? "append" : "replace",
    };
  }
  if (normalizedFragmentKind === "delta") {
    const appended = appendDeltaFragment(base, next);
    if (appended === base) {
      return { text: base, relation: "keep" };
    }
    if (appended === next) {
      return { text: next, relation: "replace" };
    }
    return { text: appended, relation: "append" };
  }

  const baseVisible = normalizeVisibleStreamingText(base);
  const nextVisible = normalizeVisibleStreamingText(next);
  const baseSemantic = normalizeStreamingSnapshotSemanticText(base);
  const nextSemantic = normalizeStreamingSnapshotSemanticText(next);
  const equivalent = (baseVisible && baseVisible === nextVisible)
    || (baseSemantic && baseSemantic === nextSemantic);
  if (equivalent) {
    if (normalizedFragmentKind === "completed_snapshot") {
      return { text: next, relation: "replace" };
    }
    return next.length >= base.length
      ? { text: next, relation: "replace" }
      : { text: base, relation: "keep" };
  }

  const nextContainsBase = (
    (baseVisible && nextVisible && (nextVisible.startsWith(baseVisible) || nextVisible.includes(baseVisible)))
    || (baseSemantic && nextSemantic && (nextSemantic.startsWith(baseSemantic) || nextSemantic.includes(baseSemantic)))
  );
  if (nextContainsBase) {
    return { text: next, relation: "replace" };
  }

  const baseContainsNext = (
    (baseVisible && nextVisible && (baseVisible.startsWith(nextVisible) || baseVisible.includes(nextVisible)))
    || (baseSemantic && nextSemantic && (baseSemantic.startsWith(nextSemantic) || baseSemantic.includes(nextSemantic)))
  );
  if (baseContainsNext) {
    if (normalizedFragmentKind === "completed_snapshot") {
      return { text: next, relation: "replace" };
    }
    return { text: base, relation: "keep" };
  }

  return { text: next, relation: "rewrite" };
}

function appendDeltaFragment(current, next) {
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

  const replacement = chooseStreamingSnapshotReplacement(base, incoming);
  if (replacement) {
    return replacement;
  }

  const maxOverlap = Math.min(base.length, incoming.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (base.slice(-size) === incoming.slice(0, size)) {
      return `${base}${incoming.slice(size)}`;
    }
  }

  return `${base}${incoming}`;
}

function prepareStreamingDelivery(state, { completedOnly, force }) {
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
  };
}

function buildStreamingDeliveredVisibleText(state, { completedOnly, deliveredItems, force }) {
  const deliveredById = new Map();
  for (const item of Array.isArray(deliveredItems) ? deliveredItems : []) {
    deliveredById.set(item.itemId, item.visibleText);
  }

  const parts = [];
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

function commitPreparedStreamingDelivery(prepared, { delivered }) {
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

function computeVisibleDeliveryDelta(previous, next) {
  const before = trimOuterBlankLines(normalizeLineEndings(previous));
  const after = trimOuterBlankLines(normalizeLineEndings(next));
  if (!after) {
    return {
      delta: "",
      relation: "keep",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: before,
    };
  }
  if (!before) {
    return {
      delta: after,
      relation: "initial",
      deliveredVisibleBefore: "",
      deliveredVisibleAfter: after,
    };
  }
  if (after === before) {
    return {
      delta: "",
      relation: "keep",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: before,
    };
  }
  if (after.startsWith(before)) {
    return {
      delta: after.slice(before.length),
      relation: "extend",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: after,
    };
  }

  const visibleBefore = normalizeVisibleStreamingText(before);
  const visibleAfter = normalizeVisibleStreamingText(after);
  if (visibleBefore && visibleBefore === visibleAfter) {
    return {
      delta: "",
      relation: "equivalent",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: before,
    };
  }
  if (visibleBefore && visibleAfter.startsWith(visibleBefore)) {
    const nextMap = buildComparisonMap(after);
    const previousMap = buildComparisonMap(before);
    return {
      delta: after.slice(comparisonIndexToRawIndex(nextMap, previousMap.comparison.length)),
      relation: "normalized_extend",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: after,
    };
  }

  const semanticBefore = normalizeStreamingSnapshotSemanticText(before);
  const semanticAfter = normalizeStreamingSnapshotSemanticText(after);
  if (semanticBefore && semanticBefore === semanticAfter) {
    return {
      delta: "",
      relation: "semantic_equivalent",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: before,
    };
  }
  if (semanticBefore && semanticAfter.startsWith(semanticBefore)) {
    const nextMap = buildComparisonMap(after, { stripPunctuation: true });
    const previousMap = buildComparisonMap(before, { stripPunctuation: true });
    return {
      delta: after.slice(comparisonIndexToRawIndex(nextMap, previousMap.comparison.length)),
      relation: "semantic_extend",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: after,
    };
  }

  return {
    delta: "",
    relation: "rewrite_without_extension",
    deliveredVisibleBefore: before,
    deliveredVisibleAfter: before,
  };
}

function buildComparisonMap(text, { stripPunctuation = false } = {}) {
  const raw = normalizeLineEndings(String(text || ""));
  const rawToComparison = new Array(raw.length + 1);
  let comparison = "";
  let lastWasSpace = true;
  rawToComparison[0] = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (/\s/u.test(character)) {
      if (!comparison || lastWasSpace) {
        rawToComparison[index + 1] = comparison.length;
        continue;
      }
      comparison += " ";
      lastWasSpace = true;
      rawToComparison[index + 1] = comparison.length;
      continue;
    }
    if (stripPunctuation && /[\p{P}\p{S}]/u.test(character)) {
      rawToComparison[index + 1] = comparison.length;
      continue;
    }
    comparison += character;
    lastWasSpace = false;
    rawToComparison[index + 1] = comparison.length;
  }

  while (comparison.endsWith(" ")) {
    comparison = comparison.slice(0, -1);
  }

  return { raw, comparison, rawToComparison };
}

function comparisonIndexToRawIndex(map, comparisonLength) {
  if (!map || !Array.isArray(map.rawToComparison) || comparisonLength <= 0) {
    return 0;
  }
  for (let index = 0; index < map.rawToComparison.length; index += 1) {
    if (map.rawToComparison[index] >= comparisonLength) {
      return index;
    }
  }
  return map.raw.length;
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
  const finalizedReplacement = chooseCompletedSnapshotReplacement(streamed, finalized);
  if (finalizedReplacement) {
    return finalizedReplacement;
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

function numberOrDefault(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function hasCompletedFlushTrigger(trigger) {
  const source = normalizeText(trigger?.source);
  return source === "runtime.reply.completed"
    || source === "runtime.turn.completed"
    || source === "finishTurn"
    || source === "finalizeAbandonedTurn";
}

function hasNaturalFlushBoundary(text) {
  const normalized = trimOuterBlankLines(normalizeLineEndings(text));
  if (!normalized) {
    return false;
  }
  return /\n\n$/.test(normalized)
    || /\n$/.test(normalized)
    || /(?:[。！？!?]|[.!?]["'”’）)\]」』】]?)$/.test(normalized);
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

function normalizeStreamingSnapshotSemanticText(text) {
  return normalizeVisibleStreamingText(text)
    .replace(/[\p{P}\p{S}]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function chooseStreamingSnapshotReplacement(base, incoming) {
  void base;
  void incoming;
  return "";
}

function chooseCompletedSnapshotReplacement(streamed, finalized) {
  void streamed;
  void finalized;
  return "";
}

function collapseRepeatedWechatReplyText(text) {
  let collapsed = trimOuterBlankLines(normalizeLineEndings(text));
  if (!collapsed || collapsed.length < WEIXIN_DUPLICATE_BLOCK_MIN_CHARS * 2) {
    return collapsed;
  }

  const splitters = [
    { pattern: /\n{2,}/u, joiner: "\n\n" },
    { pattern: /\n+/u, joiner: "\n" },
  ];
  for (let pass = 0; pass < 4; pass += 1) {
    let next = collapsed;
    for (const splitter of splitters) {
      next = collapseAdjacentRepeatedSegments(next, splitter);
      if (next !== collapsed) {
        break;
      }
    }
    if (next === collapsed) {
      return collapsed;
    }
    collapsed = next;
  }
  return collapsed;
}

function collapseAdjacentRepeatedSegments(text, { pattern, joiner }) {
  const segments = String(text || "")
    .split(pattern)
    .map((segment) => trimOuterBlankLines(segment))
    .filter(Boolean);
  if (segments.length < WEIXIN_DUPLICATE_BLOCK_MIN_SEGMENTS * 2) {
    return trimOuterBlankLines(text);
  }

  const normalizedSegments = segments.map((segment) => normalizeVisibleStreamingText(segment));
  for (let span = Math.floor(segments.length / 2); span >= 1; span -= 1) {
    for (let start = 0; (start + span * 2) <= segments.length; start += 1) {
      const left = normalizedSegments.slice(start, start + span);
      const right = normalizedSegments.slice(start + span, start + span * 2);
      if (!left.length || !arraysEqual(left, right)) {
        continue;
      }

      const normalizedBlock = left.join("\n");
      if (
        normalizedBlock.length < WEIXIN_DUPLICATE_BLOCK_MIN_CHARS
        || left.length < WEIXIN_DUPLICATE_BLOCK_MIN_SEGMENTS
      ) {
        continue;
      }

      return trimOuterBlankLines([
        ...segments.slice(0, start),
        ...segments.slice(start, start + span),
        ...segments.slice(start + span * 2),
      ].join(joiner));
    }
  }

  return trimOuterBlankLines(text);
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
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

function shouldStreamImmediately(item) {
  if (!item?.text || item.itemId === "__watchdog__") {
    return false;
  }
  const phase = normalizeAssistantPhase(item.phase);
  if (phase === "final") {
    return true;
  }
  if (!isBriefStreamingProgressText(item.text)) {
    return false;
  }
  if (phase === "commentary") {
    return true;
  }
  return true;
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
  const deduped = normalizeText(replyTarget?.provider) === "weixin"
    ? collapseRepeatedWechatReplyText(cleaned)
    : cleaned;
  return {
    suppress: false,
    text: trimOuterBlankLines(deduped),
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
