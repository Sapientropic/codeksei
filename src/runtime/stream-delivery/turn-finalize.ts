import type { ReplyTarget } from "../../core/runtime-types";
import {
  ensureRunState,
  findRunState,
  removeStateItem,
  replaceStateItemText,
  upsertStateItem,
  type RunState,
} from "./run-state";
import { buildCurrentSafeReplyText, type FlushTrigger } from "./delivery-transport";
import { normalizeLineEndings, normalizeText } from "./visible-text";

export interface StreamTurnFinalizeContext {
  readonly stateByRunKey: Map<string, RunState>;
  readonly weixinReplyMode: "settled" | "stream";
  attachReplyTarget(state: RunState): ReplyTarget | null;
  clearScheduledFlush(state: RunState): void;
  disposeRunState(runKey: unknown): void;
  flush(
    state: RunState,
    options: { force: boolean; trigger?: FlushTrigger | null },
  ): Promise<void>;
}

export async function finishStreamTurn(
  context: StreamTurnFinalizeContext,
  { threadId, finalText }: { threadId: unknown; finalText: unknown },
): Promise<void> {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedFinalText = normalizeLineEndings(finalText);
  if (!normalizedThreadId || !normalizedFinalText) {
    return;
  }

  const state = ensureRunState(context.stateByRunKey, {
    threadId: normalizedThreadId,
    turnId: "",
    weixinReplyMode: context.weixinReplyMode,
  });
  context.attachReplyTarget(state);
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

  await context.flush(state, {
    force: true,
    trigger: {
      source: "finishTurn",
      itemId: state.itemOrder[state.itemOrder.length - 1] || "final",
      fragmentKind: "completed_snapshot",
    },
  });
  context.disposeRunState(state.runKey);
}

export async function finalizeAbandonedStreamTurn(
  context: StreamTurnFinalizeContext,
  {
    threadId,
    turnId = "",
    trailingText = "",
  }: {
    threadId: unknown;
    turnId?: string;
    trailingText?: string;
  },
): Promise<void> {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const normalizedTrailingText = normalizeLineEndings(trailingText).trim();
  if (!normalizedThreadId) {
    return;
  }

  const state = findRunState(context.stateByRunKey, normalizedThreadId, normalizedTurnId);
  if (!state) {
    if (normalizedTurnId) {
      return;
    }
    if (normalizedTrailingText) {
      await finishStreamTurn(context, {
        threadId: normalizedThreadId,
        finalText: normalizedTrailingText,
      });
    }
    return;
  }

  context.attachReplyTarget(state);
  context.clearScheduledFlush(state);
  if (normalizedTrailingText) {
    upsertStateItem(state, {
      itemId: "__watchdog__",
      text: normalizedTrailingText,
      completed: true,
      fragmentKind: "completed_snapshot",
    });
  }
  await context.flush(state, {
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
