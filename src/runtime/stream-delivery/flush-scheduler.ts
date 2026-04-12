// @ts-check

import {
  hasCompletedFlushTrigger,
  hasNaturalFlushBoundary,
  prefersStreamingDelivery,
  prepareStreamingDelivery,
  shouldScheduleStreamingIdleFlush,
  type FlushTrigger,
} from "./delivery-transport";
import { normalizeText } from "./visible-text";

/**
/**
 * @typedef {{
 *   scheduledFlushTimer: NodeJS.Timeout | null,
 *   flushPromise: Promise<void> | null,
 *   sendChain: Promise<void>,
 *   replyTarget?: { provider?: string } | null,
 *   weixinReplyMode?: string,
 *   items: Map<string, unknown>,
 * }} FlushState
 */

/**
 * @typedef {{
 *   REPLY_COMPLETED: string,
 *   TURN_COMPLETED: string,
 * }} RuntimeEventTypes
 */

/**
 * @param {{
 *   flushNow(state: FlushState, options: { force: boolean, trigger?: FlushTrigger }): Promise<void>,
 *   runtimeEventTypes: RuntimeEventTypes,
 *   streamIdleFlushMs: number,
 *   streamForceFlushChars: number,
 *   streamBoundaryFlushChars: number,
 * }} options
 */
function createFlushScheduler({
  flushNow,
  runtimeEventTypes,
  streamIdleFlushMs,
  streamForceFlushChars,
  streamBoundaryFlushChars,
}: any) {
  /**
   * @param {FlushState | null | undefined} state
   */
  function clearScheduledFlush(state: any) {
    if (!state?.scheduledFlushTimer) {
      return;
    }
    clearTimeout(state.scheduledFlushTimer);
    state.scheduledFlushTimer = null;
  }

  return {
    clearScheduledFlush,

    /**
     * Serialize flush work per run so REPLY_COMPLETED / TURN_COMPLETED cannot
     * overlap with an earlier idle flush. Future callers should keep this queue
     * local to run-state instead of inventing another scheduler layer.
     *
     * @param {FlushState} state
     * @param {{ force: boolean, trigger?: FlushTrigger | null }} options
     */
    async flush(state: any, { force, trigger = null }: any) {
      const previous = state.flushPromise || Promise.resolve();
      const current = previous
        .catch(() => {})
        .then(() => flushNow(state, { force, trigger }));
      const tracked = current.finally(() => {
        if (state.flushPromise === tracked) {
          state.flushPromise = null;
        }
      });
      state.flushPromise = tracked;
      await tracked;
    },

    /**
     * @param {FlushState} state
     * @param {{ force?: boolean, trigger?: FlushTrigger | null }} [options]
     */
    scheduleStreamingFlush(state: any, { force = false, trigger = null }: any = {}) {
      if (!prefersStreamingDelivery(state)) {
        return;
      }
      const prepared = prepareStreamingDelivery(state, { completedOnly: false, force });
      if (!prepared.safeText) {
        return;
      }
      const flushImmediately = force
        || hasCompletedFlushTrigger(trigger, runtimeEventTypes)
        || (
          prepared.safeText.length >= streamBoundaryFlushChars
          && hasNaturalFlushBoundary(prepared.safeText)
        );
      if (flushImmediately) {
        clearScheduledFlush(state);
        void this.flush(state, { force, trigger });
        return;
      }
      if (!shouldScheduleStreamingIdleFlush(prepared)) {
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
      }, streamIdleFlushMs);
    },

    /**
     * Serialize actual sends per run. The chain intentionally swallows the
     * previous failure when scheduling the next send so a single WeChat send
     * error does not poison the rest of the local cleanup path.
     *
     * @param {FlushState} state
     * @param {() => Promise<void>} sendOperation
     */
    serializeSend(state: any, sendOperation: any) {
      const previous = state.sendChain || Promise.resolve();
      const current = previous
        .catch(() => {})
        .then(() => sendOperation());
      state.sendChain = current.catch(() => {});
      return current;
    },
  };
}

export {
  createFlushScheduler,
};
