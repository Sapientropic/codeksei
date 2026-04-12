// @ts-check

import * as crypto from "crypto";
import {
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
} from "../contracts/runtime-events";
import type {
  ChannelAdapterLike,
  SessionStoreLike,
} from "../core/app-service-contract";
import type {
  DeliveryFailurePayload,
  ReplyTarget,
  UnknownRecord,
} from "../core/runtime-types";
import { computeVisibleDeliveryDelta } from "./stream-delivery/delta-merge";
import {
  buildCurrentSafeReplyText,
  buildReplyText,
  commitPreparedStreamingDelivery,
  normalizeDeliveryDelta,
  normalizeWeixinReplyMode,
  prefersSettledDelivery,
  prefersStreamingDelivery,
  prepareStreamingDelivery,
  type FlushTrigger,
  type PreparedStreamingDelivery,
} from "./stream-delivery/delivery-transport";
import {
  buildRunKey,
  ensureRunState,
  findRunState,
  removeStateItem,
  replaceStateItemText,
  upsertStateItem,
  type RunState,
} from "./stream-delivery/run-state";
import {
  buildDeliveryTracePayload,
  buildSettledWeixinDeliveryKey,
  disposeSupersededAbandonedRuns,
  hashReplyText,
  rememberRecentDelivery,
  resolveLateRewriteDelta,
  wasRecentlyDelivered,
  type DeliveryTracePayload,
} from "./stream-delivery/trace-abandonment";
import { createFlushScheduler } from "./stream-delivery/flush-scheduler";
import { createReplyTargetRegistry } from "./stream-delivery/reply-target-registry";
import {
  normalizeLineEndings,
  normalizeText,
  sanitizeReplyText,
} from "./stream-delivery/visible-text";

const STREAM_IDLE_FLUSH_MS = 500;
const STREAM_FORCE_FLUSH_CHARS = 100;
const STREAM_BOUNDARY_FLUSH_CHARS = 30;

interface StreamDeliveryOptions {
  channelAdapter: ChannelAdapterLike;
  sessionStore: SessionStoreLike;
  weixinReplyMode?: unknown;
  deliveryTraceEnabled?: unknown;
  onDeliveryFailure?: ((payload: DeliveryFailurePayload) => Promise<void> | void) | null;
  streamIdleFlushMs?: unknown;
  streamForceFlushChars?: unknown;
  streamBoundaryFlushChars?: unknown;
}

type FlushScheduler = ReturnType<typeof createFlushScheduler>;
type ReplyTargetRegistry = ReturnType<typeof createReplyTargetRegistry>;

export class StreamDelivery {
  channelAdapter: ChannelAdapterLike;
  deliveryTraceEnabled: boolean;
  flushScheduler: FlushScheduler;
  ignoredRunKeys: Set<string>;
  onDeliveryFailure: ((payload: DeliveryFailurePayload) => Promise<void> | void) | null;
  recentSettledWeixinDeliveries: Map<string, number>;
  replyTargetRegistry: ReplyTargetRegistry;
  sessionStore: SessionStoreLike;
  stateByRunKey: Map<string, RunState>;
  streamBoundaryFlushChars: number;
  streamForceFlushChars: number;
  streamIdleFlushMs: number;
  weixinReplyMode: "settled" | "stream";

  constructor({
    channelAdapter,
    sessionStore,
    weixinReplyMode = "settled",
    deliveryTraceEnabled = false,
    onDeliveryFailure = null,
    streamIdleFlushMs = STREAM_IDLE_FLUSH_MS,
    streamForceFlushChars = STREAM_FORCE_FLUSH_CHARS,
    streamBoundaryFlushChars = STREAM_BOUNDARY_FLUSH_CHARS,
  }: StreamDeliveryOptions) {
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
      flushNow: (
        state: RunState,
        options: { force: boolean; trigger?: FlushTrigger | null },
      ) => this.flushNow(state, options),
      runtimeEventTypes: RUNTIME_EVENT_TYPES,
      streamIdleFlushMs: this.streamIdleFlushMs,
      streamForceFlushChars: this.streamForceFlushChars,
      streamBoundaryFlushChars: this.streamBoundaryFlushChars,
    });
    this.stateByRunKey = new Map();
    this.ignoredRunKeys = new Set();
    this.recentSettledWeixinDeliveries = new Map();
  }

  setReplyTarget(bindingKey: string, target: ReplyTarget): void {
    this.replyTargetRegistry.setReplyTarget(bindingKey, target);
  }

  queueReplyTargetForThread(threadId: string, target: ReplyTarget): void {
    this.replyTargetRegistry.queueReplyTargetForThread(threadId, target);
  }

  async handleRuntimeEvent(event: RuntimeEvent<UnknownRecord>): Promise<void> {
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
          onDisposeRunKey: (runKey) => this.disposeRunState(runKey),
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

  async finishTurn({ threadId, finalText }: { threadId: unknown; finalText: unknown }): Promise<void> {
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

  async finalizeAbandonedTurn({
    threadId,
    turnId = "",
    trailingText = "",
  }: {
    threadId: unknown;
    turnId?: string;
    trailingText?: string;
  }): Promise<void> {
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

  attachReplyTarget(state: RunState): ReplyTarget | null {
    return this.replyTargetRegistry.attachReplyTarget(state);
  }

  async flush(
    state: RunState,
    { force, trigger = null }: { force: boolean; trigger?: FlushTrigger | null },
  ): Promise<void> {
    await this.flushScheduler.flush(state, { force, trigger });
  }

  async flushNow(
    state: RunState,
    { force, trigger = null }: { force: boolean; trigger?: FlushTrigger | null },
  ): Promise<void> {
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
    const replyTarget = state.replyTarget;
    if (!replyTarget) {
      return;
    }
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
          userId: replyTarget.userId,
          text: delta,
          contextToken: replyTarget.contextToken,
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
        const errorMessage = error instanceof Error ? error.message : String(error || "");
        console.error(`[codeksei] failed to deliver reply thread=${state.threadId}: ${errorMessage}`);
        this.handleDeliveryFailure(state, error);
      }
    });
  }

  handleDeliveryFailure(state: RunState, error: unknown): void {
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
    })).catch((callbackError: unknown) => {
      const callbackErrorMessage = callbackError instanceof Error
        ? callbackError.message
        : String(callbackError || "");
      console.error(`[codeksei] delivery failure callback crashed thread=${state.threadId}: ${callbackErrorMessage}`);
    });
  }

  disposeRunState(runKey: unknown): void {
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

  scheduleStreamingFlush(
    state: RunState,
    { force = false, trigger = null }: { force?: boolean; trigger?: FlushTrigger | null } = {},
  ): void {
    this.flushScheduler.scheduleStreamingFlush(state, { force, trigger });
  }

  clearScheduledFlush(state: RunState): void {
    this.flushScheduler.clearScheduledFlush(state);
  }

  logDeliveryTrace(stage: unknown, payload: DeliveryTracePayload | null, error: unknown = null): void {
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
      const errorMessage = error instanceof Error ? error.message : String(error || "");
      parts.push(`error=${JSON.stringify(errorMessage)}`);
      console.error(parts.join(" "));
      return;
    }
    console.log(parts.join(" "));
  }
}

function numberOrDefault(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
