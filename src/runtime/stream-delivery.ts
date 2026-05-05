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
import { logError, logInfo } from "../core/logging";
import type { PageArtifactStore } from "../state/page-artifacts";
import {
  normalizeWeixinReplyMode,
  type FlushTrigger,
} from "./stream-delivery/delivery-transport";
import { executeStreamFlush, handleStreamDeliveryFailure } from "./stream-delivery/flush-executor";
import { createFlushScheduler } from "./stream-delivery/flush-scheduler";
import { createReplyTargetRegistry } from "./stream-delivery/reply-target-registry";
import { applyRuntimeEventToStream } from "./stream-delivery/runtime-event-apply";
import { type RunState } from "./stream-delivery/run-state";
import { type DeliveryTracePayload } from "./stream-delivery/trace-abandonment";
import { finalizeAbandonedStreamTurn, finishStreamTurn } from "./stream-delivery/turn-finalize";

const STREAM_IDLE_FLUSH_MS = 500;
const STREAM_FORCE_FLUSH_CHARS = 100;
const STREAM_BOUNDARY_FLUSH_CHARS = 30;

interface StreamDeliveryOptions {
  channelAdapter: ChannelAdapterLike;
  sessionStore: SessionStoreLike;
  weixinReplyMode?: unknown;
  deliveryTraceEnabled?: unknown;
  pageArtifactStore?: PageArtifactStore | null;
  runtimeId?: unknown;
  weixinDeliveryConfigFile?: unknown;
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
  pageArtifactStore: PageArtifactStore | null;
  recentSettledWeixinDeliveries: Map<string, number>;
  replyTargetRegistry: ReplyTargetRegistry;
  sessionStore: SessionStoreLike;
  stateByRunKey: Map<string, RunState>;
  streamBoundaryFlushChars: number;
  streamForceFlushChars: number;
  streamIdleFlushMs: number;
  runtimeId: string;
  weixinDeliveryConfigFile: string;
  weixinReplyMode: "settled" | "stream";

  constructor({
    channelAdapter,
    sessionStore,
    weixinReplyMode = "settled",
    deliveryTraceEnabled = false,
    pageArtifactStore = null,
    runtimeId = "",
    weixinDeliveryConfigFile = "",
    onDeliveryFailure = null,
    streamIdleFlushMs = STREAM_IDLE_FLUSH_MS,
    streamForceFlushChars = STREAM_FORCE_FLUSH_CHARS,
    streamBoundaryFlushChars = STREAM_BOUNDARY_FLUSH_CHARS,
  }: StreamDeliveryOptions) {
    this.channelAdapter = channelAdapter;
    this.sessionStore = sessionStore;
    this.weixinReplyMode = normalizeWeixinReplyMode(weixinReplyMode);
    this.deliveryTraceEnabled = Boolean(deliveryTraceEnabled);
    this.pageArtifactStore = pageArtifactStore;
    this.runtimeId = typeof runtimeId === "string" && runtimeId.trim() ? runtimeId.trim() : "unknown";
    this.weixinDeliveryConfigFile = typeof weixinDeliveryConfigFile === "string" ? weixinDeliveryConfigFile.trim() : "";
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

  setWeixinReplyMode(mode: unknown): void {
    // Existing RunState instances keep the mode captured at turn creation.
    // Only future turns should see this change; rewriting in-flight state can
    // duplicate or lose visible WeChat delivery when a user toggles /reply mid-turn.
    this.weixinReplyMode = normalizeWeixinReplyMode(mode);
  }

  queueReplyTargetForThread(threadId: string, target: ReplyTarget): void {
    this.replyTargetRegistry.queueReplyTargetForThread(threadId, target);
  }

  async handleRuntimeEvent(event: RuntimeEvent<UnknownRecord>): Promise<void> {
    await applyRuntimeEventToStream(this, event);
  }

  async finishTurn({ threadId, finalText }: { threadId: unknown; finalText: unknown }): Promise<void> {
    await finishStreamTurn(this, { threadId, finalText });
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
    await finalizeAbandonedStreamTurn(this, {
      threadId,
      turnId,
      trailingText,
    });
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
    await executeStreamFlush(this, state, { force, trigger });
  }

  handleDeliveryFailure(state: RunState, error: unknown): void {
    handleStreamDeliveryFailure(this, state, error);
  }

  disposeRunState(runKey: unknown): void {
    const normalizedRunKey = typeof runKey === "string" ? runKey.trim() : "";
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
      logError(parts.join(" "));
      return;
    }
    logInfo(parts.join(" "));
  }
}

function numberOrDefault(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
