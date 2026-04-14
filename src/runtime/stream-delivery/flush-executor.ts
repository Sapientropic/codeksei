import * as crypto from "crypto";
import type { ChannelAdapterLike } from "../../core/app-service-contract";
import { supportsChannelOperation } from "../../core/app-service-contract";
import { logError, logInfo, logWarn } from "../../core/logging";
import type { DeliveryFailurePayload, ReplyTarget } from "../../core/runtime-types";
import { computeVisibleDeliveryDelta } from "./delta-merge";
import {
  buildCurrentSafeReplyText,
  buildReplyText,
  commitPreparedStreamingDelivery,
  normalizeDeliveryDelta,
  prefersSettledDelivery,
  prefersStreamingDelivery,
  prepareStreamingDelivery,
  type FlushTrigger,
} from "./delivery-transport";
import type { RunState } from "./run-state";
import {
  buildDeliveryTracePayload,
  buildSettledWeixinDeliveryKey,
  hashReplyText,
  rememberRecentDelivery,
  resolveLateRewriteDelta,
  wasRecentlyDelivered,
  type DeliveryTracePayload,
} from "./trace-abandonment";
import { sanitizeReplyText } from "./visible-text";

export interface StreamFlushExecutionContext {
  readonly channelAdapter: ChannelAdapterLike;
  readonly deliveryTraceEnabled: boolean;
  readonly flushScheduler: {
    serializeSend(state: RunState, sendOperation: () => Promise<void>): Promise<void>;
  };
  readonly ignoredRunKeys: Set<string>;
  readonly onDeliveryFailure: ((payload: DeliveryFailurePayload) => Promise<void> | void) | null;
  readonly recentSettledWeixinDeliveries: Map<string, number>;
  disposeRunState(runKey: unknown): void;
  logDeliveryTrace(stage: unknown, payload: DeliveryTracePayload | null, error?: unknown): void;
}

export async function executeStreamFlush(
  context: StreamFlushExecutionContext,
  state: RunState,
  { force, trigger = null }: { force: boolean; trigger?: FlushTrigger | null },
): Promise<void> {
  if (!state.replyTarget) {
    return;
  }
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
    logInfo(
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
  if (deliveryDedupKey && wasRecentlyDelivered(context.recentSettledWeixinDeliveries, deliveryDedupKey)) {
    state.sentText = safeText;
    logWarn(`[codeksei] suppress duplicate weixin delivery thread=${state.threadId}`);
    return;
  }

  const settledWechatDelivery = prefersSettledDelivery(state);
  const streamingPreserveBlock = Boolean(streamPrepared?.preserveBlock);
  const replyTarget = state.replyTarget;
  if (!replyTarget) {
    return;
  }
  if (!supportsChannelOperation(context.channelAdapter, "visibleTextDelivery")) {
    const error = new Error("当前宿主不支持可见文本回传。");
    logWarn(`[codeksei] skip stream delivery thread=${state.threadId} reason=text_delivery_unsupported`);
    handleStreamDeliveryFailure(context, state, error);
    return;
  }
  const tracePayload = buildDeliveryTracePayload(state, {
    force,
    trigger,
    traceId: context.deliveryTraceEnabled ? crypto.randomUUID().slice(0, 8) : "",
    safeText,
    delta,
    relation: deltaResult.relation,
    deliveredVisibleBefore: deltaResult.deliveredVisibleBefore,
    deliveredVisibleAfter: deltaResult.deliveredVisibleAfter,
  });
  await context.flushScheduler.serializeSend(state, async () => {
    context.logDeliveryTrace("attempt", tracePayload);
    try {
      await context.channelAdapter.sendText({
        userId: replyTarget.userId,
        text: delta,
        contextToken: replyTarget.contextToken,
        preserveBlock: settledWechatDelivery || streamingPreserveBlock,
        trace: context.deliveryTraceEnabled
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
      context.logDeliveryTrace("delivered", tracePayload);
      if (deliveryDedupKey) {
        rememberRecentDelivery(context.recentSettledWeixinDeliveries, deliveryDedupKey);
      }
      logInfo(
        `[codeksei] delivered weixin reply `
        + `thread=${state.threadId} turn=${state.turnId || "(pending)"} `
        + `mode=${prefersSettledDelivery(state) ? "settled" : (prefersStreamingDelivery(state) ? "stream" : "other")} `
        + `chars=${safeText.length} hash=${hashReplyText(safeText)}`
      );
    } catch (error) {
      if (streamPrepared) {
        commitPreparedStreamingDelivery(streamPrepared, { delivered: false });
      }
      context.logDeliveryTrace("failed", tracePayload, error);
      const errorMessage = error instanceof Error ? error.message : String(error || "");
      logError(`[codeksei] failed to deliver reply thread=${state.threadId}: ${errorMessage}`);
      handleStreamDeliveryFailure(context, state, error);
    }
  });
}

export function handleStreamDeliveryFailure(
  context: StreamFlushExecutionContext,
  state: RunState,
  error: unknown,
): void {
  if (!state?.runKey) {
    return;
  }
  context.ignoredRunKeys.add(state.runKey);
  context.disposeRunState(state.runKey);
  if (!context.onDeliveryFailure) {
    return;
  }
  Promise.resolve(context.onDeliveryFailure({
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
    logError(`[codeksei] delivery failure callback crashed thread=${state.threadId}: ${callbackErrorMessage}`);
  });
}
