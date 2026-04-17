// @ts-check

import {
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
  normalizeRuntimeApprovalPayload,
  normalizeRuntimeIdentifier,
  normalizeRuntimeReplyText,
  normalizeRuntimeText,
} from "../contracts/runtime-events";
import type { PendingApprovalState, UnknownRecord } from "../core/runtime-types";

type ThreadStatus = "idle" | "running" | "waiting_approval" | "failed";

interface ThreadUsage extends UnknownRecord {
  updatedAt: string;
  threadId?: string;
}

interface ThreadState {
  threadId: string;
  turnId: string;
  status: ThreadStatus;
  lastReplyText: string;
  lastError: string;
  pendingApproval: PendingApprovalState | null;
  usage: ThreadUsage | null;
  updatedAt: string;
}

function normalizePendingApprovalState(value: unknown): PendingApprovalState | null {
  const normalized = normalizeRuntimeApprovalPayload(value);
  return typeof normalized.requestId === "string" && normalized.requestId
    ? {
      threadId: typeof normalized.threadId === "string" ? normalized.threadId : "",
      requestId: normalized.requestId,
      reason: typeof normalized.reason === "string" ? normalized.reason : "",
      command: typeof normalized.command === "string" ? normalized.command : "",
      commandTokens: Array.isArray(normalized.commandTokens) ? normalized.commandTokens : [],
      signature: typeof normalized.signature === "string" ? normalized.signature : "",
      promptedAt: typeof normalized.promptedAt === "string" ? normalized.promptedAt : "",
    }
    : null;
}

export class ThreadStateStore {
  orphanUsage: ThreadUsage | null;
  stateByThreadId: Map<string, ThreadState>;

  constructor() {
    this.stateByThreadId = new Map();
    this.orphanUsage = null;
  }

  applyRuntimeEvent(event: RuntimeEvent<UnknownRecord> | null | undefined): void {
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

    const current = this.stateByThreadId.get(threadId) || createEmptyThreadState(threadId);
    const next: ThreadState = {
      ...current,
      updatedAt: new Date().toISOString(),
    };

    switch (event.type) {
      case RUNTIME_EVENT_TYPES.TURN_STARTED:
        next.status = "running";
        next.turnId = normalizeRuntimeIdentifier(event.payload.turnId) || next.turnId;
        next.lastError = "";
        break;
      case RUNTIME_EVENT_TYPES.REPLY_DELTA:
      case RUNTIME_EVENT_TYPES.REPLY_COMPLETED:
        next.status = "running";
        next.turnId = normalizeRuntimeIdentifier(event.payload.turnId) || next.turnId;
        next.lastReplyText = normalizeRuntimeReplyText(event.payload.text) || next.lastReplyText;
        break;
      case RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED:
        next.status = "waiting_approval";
        next.pendingApproval = normalizePendingApprovalState(event.payload);
        break;
      case RUNTIME_EVENT_TYPES.TURN_COMPLETED:
        next.status = "idle";
        next.turnId = normalizeRuntimeIdentifier(event.payload.turnId) || next.turnId;
        next.pendingApproval = null;
        break;
      case RUNTIME_EVENT_TYPES.TURN_FAILED:
        next.status = "failed";
        next.turnId = normalizeRuntimeIdentifier(event.payload.turnId) || next.turnId;
        next.lastError = normalizeRuntimeText(event.payload.text) || "执行失败";
        next.pendingApproval = null;
        break;
      default:
        break;
    }

    this.stateByThreadId.set(threadId, next);
  }

  applyUsageEvent(event: RuntimeEvent<UnknownRecord>): void {
    const usage: ThreadUsage = {
      ...event.payload,
      updatedAt: new Date().toISOString(),
    };
    const threadId = normalizeRuntimeIdentifier(event?.payload?.threadId);
    if (!threadId) {
      this.orphanUsage = usage;
      return;
    }
    const current = this.stateByThreadId.get(threadId) || createEmptyThreadState(threadId);
    const next: ThreadState = {
      ...current,
      usage,
      updatedAt: usage.updatedAt,
    };
    this.stateByThreadId.set(threadId, next);
  }

  hydratePendingApproval(threadId: unknown, approval: unknown): ThreadState | null {
    const normalizedThreadId = normalizeRuntimeIdentifier(threadId);
    const normalizedApproval = normalizePendingApprovalState({
      ...(approval || {}),
      threadId: normalizedThreadId,
    });
    if (!normalizedThreadId || !normalizedApproval?.requestId) {
      return null;
    }
    const current = this.stateByThreadId.get(normalizedThreadId) || createEmptyThreadState(normalizedThreadId);
    const next: ThreadState = {
      ...current,
      status: "waiting_approval",
      pendingApproval: normalizedApproval,
      updatedAt: new Date().toISOString(),
    };
    this.stateByThreadId.set(normalizedThreadId, next);
    return next;
  }

  getThreadState(threadId: unknown): ThreadState | null {
    return this.stateByThreadId.get(normalizeRuntimeIdentifier(threadId)) || null;
  }

  getUsageForThread(threadId: unknown): ThreadUsage | null {
    const state = this.getThreadState(threadId);
    return state?.usage ? { ...state.usage } : null;
  }

  getLatestUsage(threadId: string = ""): ThreadUsage | null {
    if (!normalizeRuntimeIdentifier(threadId)) {
      return null;
    }
    return this.getUsageForThread(threadId);
  }

  resolveApproval(threadId: unknown, status: ThreadStatus = "running"): ThreadState | null {
    const current = this.stateByThreadId.get(normalizeRuntimeIdentifier(threadId));
    if (!current) {
      return null;
    }
    const next: ThreadState = {
      ...current,
      status,
      pendingApproval: null,
      updatedAt: new Date().toISOString(),
    };
    this.stateByThreadId.set(next.threadId, next);
    return next;
  }

  markTurnFailed(threadId: unknown, turnId: unknown, message: string = "执行失败"): ThreadState | null {
    const normalizedThreadId = normalizeRuntimeIdentifier(threadId);
    const normalizedTurnId = normalizeRuntimeIdentifier(turnId);
    if (!normalizedThreadId) {
      return null;
    }
    const current = this.stateByThreadId.get(normalizedThreadId) || createEmptyThreadState(normalizedThreadId);
    if (
      normalizedTurnId
      && normalizeRuntimeText(current.turnId)
      && normalizeRuntimeText(current.turnId) !== normalizedTurnId
    ) {
      return current;
    }
    const next: ThreadState = {
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

  snapshot(): ThreadState[] {
    return Array.from(this.stateByThreadId.values()).map((entry) => ({ ...entry }));
  }
}

function createEmptyThreadState(threadId: unknown): ThreadState {
  return {
    threadId: normalizeRuntimeIdentifier(threadId),
    turnId: "",
    status: "idle",
    lastReplyText: "",
    lastError: "",
    pendingApproval: null,
    usage: null,
    updatedAt: new Date().toISOString(),
  };
}
