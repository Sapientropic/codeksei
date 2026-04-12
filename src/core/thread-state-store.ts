// @ts-check

const {
  RUNTIME_EVENT_TYPES,
  normalizeRuntimeApprovalPayload,
  normalizeRuntimeIdentifier,
  normalizeRuntimeText,
} = require("../contracts/runtime-events");

/**
 * @typedef {"idle" | "running" | "waiting_approval" | "failed"} ThreadStatus
 */

/**
 * @typedef {{
 *   requestId?: string,
 *   threadId?: string,
 *   signature?: string,
 *   promptedAt?: string,
 *   command?: string,
 *   commandTokens?: string[],
 *   reason?: string,
 *   [key: string]: unknown,
 * } | null} PendingApprovalState
 */

/**
 * @typedef {{
 *   updatedAt: string,
 *   threadId?: string,
 *   [key: string]: unknown,
 * } | null} ThreadUsage
 */

/**
 * @typedef {{
 *   threadId: string,
 *   turnId: string,
 *   status: ThreadStatus,
 *   lastReplyText: string,
 *   lastError: string,
 *   pendingApproval: PendingApprovalState,
 *   usage: ThreadUsage,
 *   updatedAt: string,
 * }} ThreadState
 */

class ThreadStateStore {
  orphanUsage: any;
  stateByThreadId: Map<any, any>;

  constructor() {
    /** @type {Map<string, ThreadState>} */
    this.stateByThreadId = new Map();
    /** @type {ThreadUsage} */
    this.orphanUsage = null;
  }

  applyRuntimeEvent(event: any) {
    if (!event) {
      return;
    }

    if (event.type === RUNTIME_EVENT_TYPES.USAGE_UPDATED) {
      this.applyUsageEvent(event);
      return;
    }

    const threadId = normalizeRuntimeIdentifier(event?.payload?.threadId);
    if (!threadId) {
      return;
    }

    /** @type {ThreadState} */
    const current = this.stateByThreadId.get(threadId) || createEmptyThreadState(threadId);
    /** @type {ThreadState} */
    const next = {
      ...current,
      updatedAt: new Date().toISOString(),
    };

    switch (event.type) {
      case RUNTIME_EVENT_TYPES.TURN_STARTED:
        next.status = "running";
        next.turnId = event.payload.turnId || next.turnId;
        next.lastError = "";
        break;
      case RUNTIME_EVENT_TYPES.REPLY_DELTA:
        next.status = "running";
        next.turnId = event.payload.turnId || next.turnId;
        next.lastReplyText = event.payload.text || next.lastReplyText;
        break;
      case RUNTIME_EVENT_TYPES.REPLY_COMPLETED:
        next.status = "running";
        next.turnId = event.payload.turnId || next.turnId;
        next.lastReplyText = event.payload.text || next.lastReplyText;
        break;
      case RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED:
        next.status = "waiting_approval";
        next.pendingApproval = normalizeRuntimeApprovalPayload(event.payload);
        break;
      case RUNTIME_EVENT_TYPES.TURN_COMPLETED:
        next.status = "idle";
        next.turnId = event.payload.turnId || next.turnId;
        next.pendingApproval = null;
        break;
      case RUNTIME_EVENT_TYPES.TURN_FAILED:
        next.status = "failed";
        next.turnId = event.payload.turnId || next.turnId;
        next.lastError = event.payload.text || "执行失败";
        next.pendingApproval = null;
        break;
      default:
        break;
    }

    this.stateByThreadId.set(threadId, next);
  }

  applyUsageEvent(event: any) {
    /** @type {ThreadUsage} */
    const usage = {
      ...event.payload,
      updatedAt: new Date().toISOString(),
    };
    const threadId = normalizeRuntimeIdentifier(event?.payload?.threadId);
    if (!threadId) {
      this.orphanUsage = usage;
      return;
    }
    /** @type {ThreadState} */
    const current = this.stateByThreadId.get(threadId) || createEmptyThreadState(threadId);
    /** @type {ThreadState} */
    const next = {
      ...current,
      usage,
      updatedAt: usage.updatedAt,
    };
    this.stateByThreadId.set(threadId, next);
  }

  hydratePendingApproval(threadId: any, approval: any) {
    const normalizedThreadId = normalizeRuntimeIdentifier(threadId);
    const normalizedApproval = normalizeRuntimeApprovalPayload({
      ...(approval || {}),
      threadId: normalizedThreadId,
    });
    if (!normalizedThreadId || !normalizedApproval?.requestId) {
      return null;
    }
    /** @type {ThreadState} */
    const current = this.stateByThreadId.get(normalizedThreadId) || createEmptyThreadState(normalizedThreadId);
    /** @type {ThreadState} */
    const next = {
      ...current,
      status: "waiting_approval",
      pendingApproval: normalizedApproval,
      updatedAt: new Date().toISOString(),
    };
    this.stateByThreadId.set(normalizedThreadId, next);
    return next;
  }

  getThreadState(threadId: any) {
    return this.stateByThreadId.get(normalizeRuntimeIdentifier(threadId)) || null;
  }

  getUsageForThread(threadId: any) {
    const state = this.getThreadState(threadId);
    return state?.usage ? { ...state.usage } : null;
  }

  getLatestUsage(threadId: string = "") {
    if (!normalizeRuntimeIdentifier(threadId)) {
      return null;
    }
    return this.getUsageForThread(threadId);
  }

  /**
   * @param {string} threadId
   * @param {ThreadStatus} [status]
   */
  resolveApproval(threadId: any, status: string = "running") {
    const current = this.stateByThreadId.get(normalizeRuntimeIdentifier(threadId));
    if (!current) {
      return null;
    }
    /** @type {ThreadState} */
    const next = {
      ...current,
      status,
      pendingApproval: null,
      updatedAt: new Date().toISOString(),
    };
    this.stateByThreadId.set(next.threadId, next);
    return next;
  }

  markTurnFailed(threadId: any, turnId: any, message: string = "执行失败") {
    const normalizedThreadId = normalizeRuntimeIdentifier(threadId);
    const normalizedTurnId = normalizeRuntimeIdentifier(turnId);
    if (!normalizedThreadId) {
      return null;
    }
    /** @type {ThreadState} */
    const current = this.stateByThreadId.get(normalizedThreadId) || createEmptyThreadState(normalizedThreadId);
    if (normalizedTurnId && normalizeRuntimeText(current.turnId) && normalizeRuntimeText(current.turnId) !== normalizedTurnId) {
      return current;
    }
    /** @type {ThreadState} */
    const next = {
      ...current,
      status: "failed",
      turnId: normalizedTurnId || current.turnId,
      lastError: normalizeRuntimeText(message) || "执行失败",
      pendingApproval: null,
      updatedAt: new Date().toISOString(),
    };
    this.stateByThreadId.set(normalizedThreadId, next);
    return next;
  }

  snapshot() {
    return Array.from(this.stateByThreadId.values()).map((entry: any) => ({ ...entry }));
  }
}

/**
 * @param {string} threadId
 * @returns {ThreadState}
 */
function createEmptyThreadState(threadId: any) {
  return {
    threadId,
    turnId: "",
    status: /** @type {ThreadStatus} */ ("idle"),
    lastReplyText: "",
    lastError: "",
    pendingApproval: null,
    usage: null,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { ThreadStateStore };

export {};
