import {
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
} from "../../contracts/runtime-events";
import type { UnknownRecord } from "../../core/runtime-types";
import type { ReplyTarget } from "../../core/runtime-types";
import {
  buildRunKey,
  ensureRunState,
  upsertStateItem,
  type RunState,
} from "./run-state";
import { normalizeLineEndings, normalizeText } from "./visible-text";
import type { FlushTrigger } from "./delivery-transport";
import { disposeSupersededAbandonedRuns } from "./trace-abandonment";

export interface StreamRuntimeEventContext {
  readonly ignoredRunKeys: Set<string>;
  readonly stateByRunKey: Map<string, RunState>;
  readonly weixinReplyMode: "settled" | "stream";
  attachReplyTarget(state: RunState): ReplyTarget | null;
  clearScheduledFlush(state: RunState): void;
  disposeRunState(runKey: unknown): void;
  finishTurn(args: { threadId: unknown; finalText: unknown }): Promise<void>;
  flush(
    state: RunState,
    options: { force: boolean; trigger?: FlushTrigger | null },
  ): Promise<void>;
  scheduleStreamingFlush(
    state: RunState,
    options?: { force?: boolean; trigger?: FlushTrigger | null },
  ): void;
}

export async function applyRuntimeEventToStream(
  context: StreamRuntimeEventContext,
  event: RuntimeEvent<UnknownRecord>,
): Promise<void> {
  const threadId = normalizeText(event?.payload?.threadId);
  const turnId = normalizeText(event?.payload?.turnId);
  if (!threadId) {
    return;
  }
  const ignoredRunKey = turnId ? buildRunKey(threadId, turnId) : "";
  if (ignoredRunKey && context.ignoredRunKeys.has(ignoredRunKey)) {
    if (event.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED || event.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
      context.ignoredRunKeys.delete(ignoredRunKey);
    }
    return;
  }

  switch (event.type) {
    case RUNTIME_EVENT_TYPES.TURN_STARTED: {
      disposeSupersededAbandonedRuns({
        stateByRunKey: context.stateByRunKey,
        ignoredRunKeys: context.ignoredRunKeys,
        threadId,
        activeTurnId: turnId,
        onDisposeRunKey: (runKey) => context.disposeRunState(runKey),
      });
      const state = ensureRunState(context.stateByRunKey, {
        threadId,
        turnId,
        weixinReplyMode: context.weixinReplyMode,
      });
      state.turnId = turnId || state.turnId;
      state.abandonedAt = 0;
      context.attachReplyTarget(state);
      return;
    }
    case RUNTIME_EVENT_TYPES.REPLY_DELTA: {
      const state = ensureRunState(context.stateByRunKey, {
        threadId,
        turnId,
        weixinReplyMode: context.weixinReplyMode,
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
      context.scheduleStreamingFlush(state, {
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
      const state = ensureRunState(context.stateByRunKey, {
        threadId,
        turnId,
        weixinReplyMode: context.weixinReplyMode,
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
      context.clearScheduledFlush(state);
      await context.flush(state, {
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
      const state = ensureRunState(context.stateByRunKey, {
        threadId,
        turnId,
        weixinReplyMode: context.weixinReplyMode,
      });
      state.turnId = turnId || state.turnId;
      state.abandonedAt = 0;
      context.clearScheduledFlush(state);
      await context.flush(state, {
        force: true,
        trigger: { source: event.type },
      });
      context.disposeRunState(state.runKey);
      return;
    }
    case RUNTIME_EVENT_TYPES.TURN_FAILED:
      context.disposeRunState(buildRunKey(threadId, turnId));
      return;
    default:
      return;
  }
}
