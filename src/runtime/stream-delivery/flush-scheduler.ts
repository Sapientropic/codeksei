import {
  hasCompletedFlushTrigger,
  hasNaturalFlushBoundary,
  prefersFinalOnlyDelivery,
  prefersStreamingDelivery,
  prepareStreamingDelivery,
  shouldScheduleStreamingIdleFlush,
  type FlushTrigger,
} from "./delivery-transport";
import type { RunState } from "./run-state";
import { normalizeText } from "./visible-text";

type FlushState = RunState;

interface RuntimeEventTypes {
  REPLY_COMPLETED: string;
  TURN_COMPLETED: string;
}

interface FlushExecutionOptions {
  force: boolean;
  trigger?: FlushTrigger | null;
}

interface FlushSchedulerOptions {
  flushNow(state: FlushState, options: FlushExecutionOptions): Promise<void>;
  runtimeEventTypes: RuntimeEventTypes;
  streamIdleFlushMs: number;
  streamForceFlushChars: number;
  streamBoundaryFlushChars: number;
}

interface FlushScheduler {
  clearScheduledFlush(state: FlushState | null | undefined): void;
  flush(state: FlushState, options: FlushExecutionOptions): Promise<void>;
  scheduleStreamingFlush(state: FlushState, options?: Partial<FlushExecutionOptions>): void;
  serializeSend(state: FlushState, sendOperation: () => Promise<void>): Promise<void>;
}

function recoverSerializedWork(previous: Promise<void>): Promise<void> {
  return previous.catch(() => undefined);
}

function rememberSendChain(current: Promise<void>): Promise<void> {
  return current.catch(() => undefined);
}

function createFlushScheduler({
  flushNow,
  runtimeEventTypes,
  streamIdleFlushMs,
  streamForceFlushChars,
  streamBoundaryFlushChars,
}: FlushSchedulerOptions): FlushScheduler {
  function clearScheduledFlush(state: FlushState | null | undefined): void {
    if (!state?.scheduledFlushTimer) {
      return;
    }
    clearTimeout(state.scheduledFlushTimer);
    state.scheduledFlushTimer = null;
  }

  return {
    clearScheduledFlush,

    async flush(state: FlushState, { force, trigger = null }: FlushExecutionOptions): Promise<void> {
      const previous = state.flushPromise || Promise.resolve();
      const current = recoverSerializedWork(previous).then(() => flushNow(state, { force, trigger }));
      const tracked = current.finally(() => {
        if (state.flushPromise === tracked) {
          state.flushPromise = null;
        }
      });
      state.flushPromise = tracked;
      await tracked;
    },

    scheduleStreamingFlush(
      state: FlushState,
      { force = false, trigger = null }: Partial<FlushExecutionOptions> = {},
    ): void {
      if (prefersFinalOnlyDelivery(state)) {
        return;
      }
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

    serializeSend(state: FlushState, sendOperation: () => Promise<void>): Promise<void> {
      const previous = state.sendChain || Promise.resolve();
      const current = recoverSerializedWork(previous).then(() => sendOperation());
      state.sendChain = rememberSendChain(current);
      return current;
    },
  };
}

export {
  createFlushScheduler,
  type FlushExecutionOptions,
  type FlushScheduler,
  type FlushState,
  type RuntimeEventTypes,
};
