// @ts-check

const crypto = require("crypto");
const { RUNTIME_EVENT_TYPES } = require("../contracts/runtime-events");
const { computeVisibleDeliveryDelta } = require("./stream-delivery/delta-merge");
const {
  buildCurrentSafeReplyText,
  buildReplyText,
  commitPreparedStreamingDelivery,
  normalizeDeliveryDelta,
  normalizeWeixinReplyMode,
  prefersSettledDelivery,
  prefersStreamingDelivery,
  prepareStreamingDelivery,
} = require("./stream-delivery/delivery-transport");
const {
  buildRunKey,
  ensureRunState,
  findRunState,
  removeStateItem,
  replaceStateItemText,
  upsertStateItem,
} = require("./stream-delivery/run-state");
const {
  buildDeliveryTracePayload,
  buildSettledWeixinDeliveryKey,
  disposeSupersededAbandonedRuns,
  hashReplyText,
  rememberRecentDelivery,
  resolveLateRewriteDelta,
  wasRecentlyDelivered,
} = require("./stream-delivery/trace-abandonment");
const { createFlushScheduler } = require("./stream-delivery/flush-scheduler");
const { createReplyTargetRegistry } = require("./stream-delivery/reply-target-registry");
const {
  normalizeLineEndings,
  normalizeText,
  sanitizeReplyText,
} = require("./stream-delivery/visible-text");

const STREAM_IDLE_FLUSH_MS = 500;
const STREAM_FORCE_FLUSH_CHARS = 100;
const STREAM_BOUNDARY_FLUSH_CHARS = 30;

/**
 * @typedef {{
 *   userId: string,
 *   contextToken: string,
 *   provider: string,
 * }} ReplyTarget
 */

/**
 * @typedef {{
 *   source?: string,
 *   itemId?: string,
 *   phase?: string,
 *   fragmentKind?: string,
 *   fragmentRelation?: string,
 * } | null} FlushTrigger
 */

/**
 * @typedef {{
 *   runKey: string,
 *   threadId: string,
 *   bindingKey: string,
 *   replyTarget: ReplyTarget | null,
 *   turnId: string,
 *   itemOrder: string[],
 *   items: Map<string, unknown>,
 *   weixinReplyMode: string,
 *   sentText: string,
 *   lastDeliveredVisibleText: string,
 *   sendChain: Promise<void>,
 *   flushPromise: Promise<void> | null,
 *   scheduledFlushTimer: NodeJS.Timeout | null,
 *   abandonedAt: number,
 * }} RunState
 */

class StreamDelivery {
  channelAdapter: any;
  deliveryTraceEnabled: any;
  flushScheduler: any;
  ignoredRunKeys: Set<any>;
  onDeliveryFailure: any;
  recentSettledWeixinDeliveries: Map<any, any>;
  replyTargetRegistry: any;
  sessionStore: any;
  stateByRunKey: Map<any, any>;
  streamBoundaryFlushChars: any;
  streamForceFlushChars: any;
  streamIdleFlushMs: any;
  weixinReplyMode: any;

  constructor({
    channelAdapter,
    sessionStore,
    weixinReplyMode = "settled",
    deliveryTraceEnabled = false,
    onDeliveryFailure = null,
    streamIdleFlushMs = STREAM_IDLE_FLUSH_MS,
    streamForceFlushChars = STREAM_FORCE_FLUSH_CHARS,
    streamBoundaryFlushChars = STREAM_BOUNDARY_FLUSH_CHARS,
  }: any) {
    this.channelAdapter = channelAdapter;
    this.sessionStore = sessionStore;
    this.weixinReplyMode = normalizeWeixinReplyMode(weixinReplyMode);
    this.deliveryTraceEnabled = Boolean(deliveryTraceEnabled);
    this.onDeliveryFailure = typeof onDeliveryFailure === "function" ? onDeliveryFailure : null;
    this.streamIdleFlushMs = numberOrDefault(streamIdleFlushMs, STREAM_IDLE_FLUSH_MS);
    this.streamForceFlushChars = numberOrDefault(streamForceFlushChars, STREAM_FORCE_FLUSH_CHARS);
    this.streamBoundaryFlushChars = numberOrDefault(streamBoundaryFlushChars, STREAM_BOUNDARY_FLUSH_CHARS);
    this.replyTargetRegistry = createReplyTargetRegistry({
      sessionStore: this.sessionStore,
    });
    this.flushScheduler = createFlushScheduler({
      flushNow: (state: any, options: any) => this.flushNow(state, options),
      runtimeEventTypes: RUNTIME_EVENT_TYPES,
      streamIdleFlushMs: this.streamIdleFlushMs,
      streamForceFlushChars: this.streamForceFlushChars,
      streamBoundaryFlushChars: this.streamBoundaryFlushChars,
    });
    this.stateByRunKey = new Map();
    this.ignoredRunKeys = new Set();
    this.recentSettledWeixinDeliveries = new Map();
  }

  setReplyTarget(bindingKey: any, target: any) {
    this.replyTargetRegistry.setReplyTarget(bindingKey, target);
  }

  queueReplyTargetForThread(threadId: any, target: any) {
    this.replyTargetRegistry.queueReplyTargetForThread(threadId, target);
  }

  async handleRuntimeEvent(event: any) {
    const threadId = normalizeText(event?.payload?.threadId);
    const turnId = normalizeText(event?.payload?.turnId);
    if (!threadId) {
      return;
    }
    const ignoredRunKey = turnId ? buildRunKey(threadId, turnId) : "";
    if (ignoredRunKey && this.ignoredRunKeys.has(ignoredRunKey)) {
      if (event.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED || event.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
        this.ignoredRunKeys.delete(ignoredRunKey);
      }
      return;
    }

    switch (event.type) {
      case RUNTIME_EVENT_TYPES.TURN_STARTED: {
        disposeSupersededAbandonedRuns({
          stateByRunKey: this.stateByRunKey,
          ignoredRunKeys: this.ignoredRunKeys,
          threadId,
          activeTurnId: turnId,
          onDisposeRunKey: (runKey: any) => this.disposeRunState(runKey),
        });
        const state = ensureRunState(this.stateByRunKey, {
          threadId,
          turnId,
          weixinReplyMode: this.weixinReplyMode,
        });
        state.turnId = turnId || state.turnId;
        state.abandonedAt = 0;
        this.attachReplyTarget(state);
        return;
      }
      case RUNTIME_EVENT_TYPES.REPLY_DELTA: {
        const state = ensureRunState(this.stateByRunKey, {
          threadId,
          turnId,
          weixinReplyMode: this.weixinReplyMode,
        });
        state.abandonedAt = 0;
        const itemId = normalizeText(event.payload.itemId) || `item-${state.itemOrder.length + 1}`;
        const fragment = upsertStateItem(state, {
          itemId,
          text: normalizeLineEndings(event.payload.text),
          completed: false,
          phase: event.payload.phase,
          fragmentKind: event.payload.fragmentKind || "delta",
        });
        this.scheduleStreamingFlush(state, {
          force: false,
          trigger: {
            source: event.type,
            itemId,
            phase: normalizeText(event.payload.phase),
            fragmentKind: normalizeText(event.payload.fragmentKind) || "delta",
            fragmentRelation: fragment.relation,
          },
        });
        return;
      }
      case RUNTIME_EVENT_TYPES.REPLY_COMPLETED: {
        const state = ensureRunState(this.stateByRunKey, {
          threadId,
          turnId,
          weixinReplyMode: this.weixinReplyMode,
        });
        state.abandonedAt = 0;
        const itemId = normalizeText(event.payload.itemId) || `item-${state.itemOrder.length + 1}`;
        const fragment = upsertStateItem(state, {
          itemId,
          text: normalizeLineEndings(event.payload.text),
          completed: true,
          phase: event.payload.phase,
          fragmentKind: "completed_snapshot",
        });
        this.clearScheduledFlush(state);
        await this.flush(state, {
          force: false,
          trigger: {
            source: event.type,
            itemId,
            phase: normalizeText(event.payload.phase),
            fragmentKind: "completed_snapshot",
            fragmentRelation: fragment.relation,
          },
        });
        return;
      }
      case RUNTIME_EVENT_TYPES.TURN_COMPLETED: {
        const state = ensureRunState(this.stateByRunKey, {
          threadId,
          turnId,
          weixinReplyMode: this.weixinReplyMode,
        });
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
      case RUNTIME_EVENT_TYPES.TURN_FAILED:
        this.disposeRunState(buildRunKey(threadId, turnId));
        return;
      default:
        return;
    }
  }

  async finishTurn({ threadId, finalText }: any) {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedFinalText = normalizeLineEndings(finalText);
    if (!normalizedThreadId || !normalizedFinalText) {
      return;
    }

    const state = ensureRunState(this.stateByRunKey, {
      threadId: normalizedThreadId,
      turnId: "",
      weixinReplyMode: this.weixinReplyMode,
    });
    this.attachReplyTarget(state);
    if (!state.itemOrder.length) {
      upsertStateItem(state, {
        itemId: "final",
        text: normalizedFinalText,
        completed: true,
        phase: "final",
        fragmentKind: "completed_snapshot",
      });
    } else {
      const itemId = state.itemOrder[state.itemOrder.length - 1] || "final";
      replaceStateItemText(state, itemId, normalizedFinalText, true);
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

  async finalizeAbandonedTurn({ threadId, turnId = "", trailingText = "" }: any) {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const normalizedTrailingText = normalizeLineEndings(trailingText).trim();
    if (!normalizedThreadId) {
      return;
    }

    const state = findRunState(this.stateByRunKey, normalizedThreadId, normalizedTurnId);
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
      upsertStateItem(state, {
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

  attachReplyTarget(state: any) {
    return this.replyTargetRegistry.attachReplyTarget(state);
  }

  async flush(state: any, { force, trigger = null }: any) {
    await this.flushScheduler.flush(state, { force, trigger });
  }

  async flushNow(state: any, { force, trigger = null }: any) {
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
    const lateRewrite = resolveLateRewriteDelta({
      state,
      delta,
      deltaResult,
      force,
      safeText,
      streamPrepared,
    });
    delta = lateRewrite.delta;
    deltaResult = lateRewrite.deltaResult;
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
    if (deliveryDedupKey && wasRecentlyDelivered(this.recentSettledWeixinDeliveries, deliveryDedupKey)) {
      state.sentText = safeText;
      console.warn(`[codeksei] suppress duplicate weixin delivery thread=${state.threadId}`);
      return;
    }

    const settledWechatDelivery = prefersSettledDelivery(state);
    const streamingPreserveBlock = Boolean(streamPrepared?.preserveBlock);
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
    await this.flushScheduler.serializeSend(state, async () => {
      this.logDeliveryTrace("attempt", tracePayload);
      try {
        await this.channelAdapter.sendText({
          userId: state.replyTarget.userId,
          text: delta,
          contextToken: state.replyTarget.contextToken,
          preserveBlock: settledWechatDelivery || streamingPreserveBlock,
          trace: this.deliveryTraceEnabled
            ? {
              ...tracePayload,
              origin: "stream-delivery",
              preserveBlock: settledWechatDelivery || streamingPreserveBlock,
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
          rememberRecentDelivery(this.recentSettledWeixinDeliveries, deliveryDedupKey);
          console.log(
            `[codeksei] delivered weixin reply `
            + `thread=${state.threadId} turn=${state.turnId || "(pending)"} `
            + `chars=${safeText.length} hash=${hashReplyText(safeText)}`
          );
        }
      } catch (error) {
        if (streamPrepared) {
          commitPreparedStreamingDelivery(streamPrepared, { delivered: false });
        }
        this.logDeliveryTrace("failed", tracePayload, error);
        console.error(`[codeksei] failed to deliver reply thread=${state.threadId}: ${String((error as any)?.message || error)}`);
        this.handleDeliveryFailure(state, error);
      }
    });
  }

  handleDeliveryFailure(state: any, error: any) {
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
    })).catch((callbackError: any) => {
      console.error(`[codeksei] delivery failure callback crashed thread=${state.threadId}: ${callbackError.message}`);
    });
  }

  disposeRunState(runKey: any) {
    const normalizedRunKey = normalizeText(runKey);
    if (!normalizedRunKey) {
      return;
    }
    const state = this.stateByRunKey.get(normalizedRunKey);
    if (state) {
      this.flushScheduler.clearScheduledFlush(state);
    }
    this.stateByRunKey.delete(normalizedRunKey);
  }

  scheduleStreamingFlush(state: any, { force = false, trigger = null }: any = {}) {
    this.flushScheduler.scheduleStreamingFlush(state, { force, trigger });
  }

  clearScheduledFlush(state: any) {
    this.flushScheduler.clearScheduledFlush(state);
  }

  logDeliveryTrace(stage: any, payload: any, error: any = null) {
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

function numberOrDefault(value: any, fallback: any) {
  return Number.isFinite(value) ? value : fallback;
}

module.exports = { StreamDelivery };

export {};
