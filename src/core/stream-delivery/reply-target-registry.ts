// @ts-check

import { normalizeText } from "./visible-text";

/**
 * @typedef {{
 *   userId: string,
 *   contextToken: string,
 *   provider: string,
 * }} ReplyTarget
 */

/**
 * @typedef {{
 *   threadId: string,
 *   bindingKey: string,
 *   replyTarget: ReplyTarget | null,
 * }} ReplyTargetState
 */

/**
 * @typedef {{
 *   findBindingForThreadId(threadId: string): { bindingKey?: string } | null,
 * }} ReplyTargetSessionStore
 */

/**
 * @param {unknown} value
 * @returns {ReplyTarget | null}
 */
function normalizeReplyTarget(value: any) {
  const userId = String(value && typeof value === "object" && "userId" in value ? value.userId : "").trim();
  const contextToken = String(
    value && typeof value === "object" && "contextToken" in value ? value.contextToken : ""
  ).trim();
  if (!userId || !contextToken) {
    return null;
  }
  return {
    userId,
    contextToken,
    provider: normalizeText(value && typeof value === "object" && "provider" in value ? value.provider : ""),
  };
}

/**
 * @param {{
 *   sessionStore: ReplyTargetSessionStore,
 * }} options
 */
function createReplyTargetRegistry({ sessionStore }: any) {
  /** @type {Map<string, ReplyTarget>} */
  const replyTargetByBindingKey = new Map();
  /** @type {Map<string, ReplyTarget[]>} */
  const pendingReplyTargetsByThreadId = new Map();

  return {
    /**
     * @param {string} bindingKey
     * @param {unknown} target
     */
    setReplyTarget(bindingKey: any, target: any) {
      const normalizedBindingKey = normalizeText(bindingKey);
      const normalizedTarget = normalizeReplyTarget(target);
      if (!normalizedBindingKey || !normalizedTarget) {
        return;
      }
      replyTargetByBindingKey.set(normalizedBindingKey, normalizedTarget);
    },

    /**
     * @param {string} threadId
     * @param {unknown} target
     */
    queueReplyTargetForThread(threadId: any, target: any) {
      const normalizedThreadId = normalizeText(threadId);
      const normalizedTarget = normalizeReplyTarget(target);
      if (!normalizedThreadId || !normalizedTarget) {
        return;
      }
      const queue = pendingReplyTargetsByThreadId.get(normalizedThreadId) || [];
      queue.push(normalizedTarget);
      pendingReplyTargetsByThreadId.set(normalizedThreadId, queue);
    },

    /**
     * Keep reply-target recovery order stable: first consume the thread-local
     * queue captured from the incoming message, then restore the binding key
     * from the persisted session map, and only then fall back to the latest
     * reply target cached for that binding. Reordering these steps would risk
     * reviving an older target ahead of the message that actually reopened the
     * thread.
     *
     * @param {ReplyTargetState} state
     * @returns {ReplyTarget | null}
     */
    attachReplyTarget(state: any) {
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
