import { normalizeText } from "./visible-text";

interface ReplyTarget {
  userId: string;
  contextToken: string;
  provider: string;
  deliveryPolicy?: "normal" | "final_only";
}

interface ReplyTargetState {
  threadId: string;
  bindingKey: string;
  replyTarget: ReplyTarget | null;
}

interface ReplyTargetSessionStore {
  findBindingForThreadId(threadId: string): { bindingKey?: string } | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeReplyTarget(value: unknown): ReplyTarget | null {
  const record = asRecord(value);
  const userId = normalizeText(record.userId);
  const contextToken = normalizeText(record.contextToken);
  if (!userId || !contextToken) {
    return null;
  }
  const deliveryPolicy = normalizeDeliveryPolicy(record.deliveryPolicy);
  return {
    userId,
    contextToken,
    provider: normalizeText(record.provider),
    ...(deliveryPolicy ? { deliveryPolicy } : {}),
  };
}

function normalizeDeliveryPolicy(value: unknown): "normal" | "final_only" | undefined {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "final_only" || normalized === "final-only") {
    return "final_only";
  }
  if (normalized === "normal") {
    return "normal";
  }
  return undefined;
}

function createReplyTargetRegistry({ sessionStore }: { sessionStore: ReplyTargetSessionStore }) {
  const replyTargetByBindingKey = new Map<string, ReplyTarget>();
  const pendingReplyTargetsByThreadId = new Map<string, ReplyTarget[]>();

  return {
    setReplyTarget(bindingKey: unknown, target: unknown): void {
      const normalizedBindingKey = normalizeText(bindingKey);
      const normalizedTarget = normalizeReplyTarget(target);
      if (!normalizedBindingKey || !normalizedTarget) {
        return;
      }
      replyTargetByBindingKey.set(normalizedBindingKey, normalizedTarget);
    },

    queueReplyTargetForThread(threadId: unknown, target: unknown): void {
      const normalizedThreadId = normalizeText(threadId);
      const normalizedTarget = normalizeReplyTarget(target);
      if (!normalizedThreadId || !normalizedTarget) {
        return;
      }
      const queue = pendingReplyTargetsByThreadId.get(normalizedThreadId) || [];
      queue.push(normalizedTarget);
      pendingReplyTargetsByThreadId.set(normalizedThreadId, queue);
    },

    attachReplyTarget(state: ReplyTargetState): ReplyTarget | null {
      if (!state.replyTarget) {
        const queue = pendingReplyTargetsByThreadId.get(state.threadId) || [];
        if (queue.length) {
          state.replyTarget = queue.shift() || null;
          if (queue.length) {
            pendingReplyTargetsByThreadId.set(state.threadId, queue);
          } else {
            pendingReplyTargetsByThreadId.delete(state.threadId);
          }
        }
      }

      const linked = sessionStore.findBindingForThreadId(state.threadId);
      const bindingKey = normalizeText(linked?.bindingKey);
      if (!bindingKey) {
        return state.replyTarget;
      }
      state.bindingKey = bindingKey;
      if (!state.replyTarget) {
        state.replyTarget = replyTargetByBindingKey.get(bindingKey) || null;
      }
      return state.replyTarget;
    },
  };
}

export {
  createReplyTargetRegistry,
};
