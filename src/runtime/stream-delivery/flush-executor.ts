import * as crypto from "crypto";
import type { ChannelAdapterLike } from "../../core/app-service-contract";
import { supportsChannelOperation } from "../../core/app-service-contract";
import { logError, logInfo, logWarn } from "../../core/logging";
import type { DeliveryFailurePayload, ReplyTarget } from "../../core/runtime-types";
import {
  buildPageArtifactUri,
  formatWeixinPageMessage,
  type PageArtifactStore,
} from "../../state/page-artifacts";
import { resolveWeixinDeliveryConfig } from "../../state/weixin-delivery-config";
import { computeVisibleDeliveryDelta } from "./delta-merge";
import {
  buildCurrentSafeReplyText,
  buildReplyText,
  commitPreparedStreamingDelivery,
  normalizeDeliveryDelta,
  prefersFinalOnlyDelivery,
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
  readonly pageArtifactStore?: PageArtifactStore | null;
  readonly recentSettledWeixinDeliveries: Map<string, number>;
  readonly runtimeId?: string;
  readonly weixinDeliveryConfigFile?: string;
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
  const finalOnlyDelivery = prefersFinalOnlyDelivery(state);
  if (!force && finalOnlyDelivery) {
    return;
  }
  if (!force && prefersSettledDelivery(state)) {
    return;
  }

  const completedOnly = finalOnlyDelivery ? true : (prefersSettledDelivery(state) ? !force : false);
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
      preferLatestMessage: prefersSettledDelivery(state) || finalOnlyDelivery,
      force,
    });
  const sanitized = sanitizeReplyText(state.replyTarget, plainText);
  const streamDeliveredVisibleAfter = streamPrepared
    ? sanitizeReplyText(state.replyTarget, streamPrepared.deliveredVisibleAfter).text
    : "";
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
    if (streamPrepared) {
      // SILENT/protocol sentinels are model-visible control tokens, not
      // user-visible text. Consume them in the stream cursor after sanitizing
      // so the same completed item is not retried or leaked on a later flush.
      state.sentText = streamDeliveredVisibleAfter || state.lastDeliveredVisibleText || "";
      state.lastDeliveredVisibleText = streamDeliveredVisibleAfter || state.lastDeliveredVisibleText || "";
      commitPreparedStreamingDelivery(streamPrepared, { delivered: true });
    }
    return;
  }

  let deltaResult = streamPrepared
    ? {
      delta: safeText,
      relation: streamPrepared.relation,
      deliveredVisibleBefore: state.lastDeliveredVisibleText,
      deliveredVisibleAfter: streamDeliveredVisibleAfter,
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
  const preserveFinalOnlyBlock = finalOnlyDelivery;
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
  const pagedDelivery = preparePagedWeixinDelivery(context, state, {
    delta,
    force,
    safeText,
    streamPrepared,
    trigger,
  });
  const outboundText = pagedDelivery?.text || delta;
  const outboundPreserveBlock = pagedDelivery ? true : (
    settledWechatDelivery || preserveFinalOnlyBlock || streamingPreserveBlock
  );
  await context.flushScheduler.serializeSend(state, async () => {
    context.logDeliveryTrace("attempt", tracePayload);
    try {
      await context.channelAdapter.sendText({
        userId: replyTarget.userId,
        text: outboundText,
        contextToken: replyTarget.contextToken,
        preserveBlock: outboundPreserveBlock,
        trace: context.deliveryTraceEnabled
          ? {
            ...tracePayload,
            origin: "stream-delivery",
            preserveBlock: outboundPreserveBlock,
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

function preparePagedWeixinDelivery(
  context: StreamFlushExecutionContext,
  state: RunState,
  {
    delta,
    force,
    safeText,
    streamPrepared,
    trigger,
  }: {
    delta: string;
    force: boolean;
    safeText: string;
    streamPrepared: ReturnType<typeof prepareStreamingDelivery> | null;
    trigger: FlushTrigger | null | undefined;
  },
): { text: string } | null {
  const replyTarget = state.replyTarget;
  if (!replyTarget || replyTarget.provider !== "weixin") {
    return null;
  }
  if (!context.pageArtifactStore || !state.bindingKey) {
    return null;
  }
  const resolvedConfig = resolveWeixinDeliveryConfig({
    filePath: context.weixinDeliveryConfigFile || "",
    defaultReplyMode: state.weixinReplyMode,
  });
  if (resolvedConfig.pageMode !== "auto") {
    return null;
  }
  if (delta.length <= resolvedConfig.pageChars * 2) {
    return null;
  }
  if (!isFinalVisibleDelivery({ force, streamPrepared, trigger })) {
    return null;
  }

  const artifact = context.pageArtifactStore.createTextArtifact({
    sourceKind: "weixin_reply",
    sourceName: "runtime reply",
    runtimeId: normalizeContextString(context.runtimeId) || "unknown",
    workspaceRoot: "",
    bindingKey: state.bindingKey,
    threadId: state.threadId,
    userId: replyTarget.userId,
    contextToken: replyTarget.contextToken,
    pageChars: resolvedConfig.pageChars,
    text: delta,
    metadata: {
      safeChars: safeText.length,
      turnId: state.turnId,
      triggerSource: trigger?.source || "",
    },
  });
  if (artifact.totalPages <= 1) {
    return null;
  }
  context.pageArtifactStore.activatePointer(state.bindingKey, artifact.id, 1);
  const firstPage = context.pageArtifactStore.readTextResourcePage(buildPageArtifactUri(artifact.id, 1));
  if (!firstPage) {
    return null;
  }
  return { text: formatWeixinPageMessage(firstPage) };
}

function isFinalVisibleDelivery({
  force,
  streamPrepared,
  trigger,
}: {
  force: boolean;
  streamPrepared: ReturnType<typeof prepareStreamingDelivery> | null;
  trigger: FlushTrigger | null | undefined;
}): boolean {
  const triggerPhase = normalizeContextString(trigger?.phase);
  if (triggerPhase && triggerPhase !== "final") {
    return false;
  }
  if (streamPrepared) {
    return streamPrepared.deliveredItems.some((item) => item.phase === "final");
  }
  return force || !triggerPhase || triggerPhase === "final";
}

function normalizeContextString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
