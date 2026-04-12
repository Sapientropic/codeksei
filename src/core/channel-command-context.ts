import type { NormalizedIncomingMessage, PendingApprovalState } from "./runtime-types";

export interface ChannelCommandUsageSnapshot extends Record<string, unknown> {
  modelContextWindow?: number;
  lastTotalTokens?: number;
  primaryUsedPercent?: number;
  secondaryUsedPercent?: number;
  threadId?: string;
  updatedAt?: string;
}

export interface ChannelCommandThreadState {
  lastReplyText?: string;
  lastError?: string;
  pendingApproval?: PendingApprovalState | null;
  status?: string;
  threadId?: string;
  turnId?: string;
  updatedAt?: string;
  usage?: ChannelCommandUsageSnapshot | null;
}

export interface ChannelCommandSessionStore {
  buildBindingKey(args: { workspaceId: string; accountId: string; senderId: string }): string;
  getPendingApprovalForThread(threadId: string): PendingApprovalState | null;
  getThreadIdForWorkspace(bindingKey: string, workspaceRoot: string): string;
}

export interface ChannelCommandRuntimeAdapter<SessionStoreT extends ChannelCommandSessionStore = ChannelCommandSessionStore> {
  getSessionStore(): SessionStoreT;
}

export interface ChannelCommandThreadStateStore {
  getLatestUsage?(threadId?: string): ChannelCommandUsageSnapshot | null;
  getThreadState(threadId: string): ChannelCommandThreadState | null;
  getUsageForThread?(threadId: string): ChannelCommandUsageSnapshot | null;
}

export interface BuildChannelCommandContextArgs<
  SessionStoreT extends ChannelCommandSessionStore = ChannelCommandSessionStore,
  ThreadStateStoreT extends ChannelCommandThreadStateStore = ChannelCommandThreadStateStore,
> {
  normalized: Pick<NormalizedIncomingMessage, "workspaceId" | "accountId" | "senderId">;
  resolveWorkspaceRoot(bindingKey: string): string;
  runtimeAdapter: ChannelCommandRuntimeAdapter<SessionStoreT>;
  threadStateStore: ThreadStateStoreT;
}

export interface ChannelCommandContext<
  SessionStoreT extends ChannelCommandSessionStore = ChannelCommandSessionStore,
> {
  bindingKey: string;
  sessionStore: SessionStoreT;
  threadId: string;
  threadState: ChannelCommandThreadState | null;
  usage: ChannelCommandUsageSnapshot | null;
  workspaceRoot: string;
}

function buildChannelCommandContext<
  SessionStoreT extends ChannelCommandSessionStore,
  ThreadStateStoreT extends ChannelCommandThreadStateStore,
>({
  normalized,
  resolveWorkspaceRoot,
  runtimeAdapter,
  threadStateStore,
}: BuildChannelCommandContextArgs<SessionStoreT, ThreadStateStoreT>): ChannelCommandContext<SessionStoreT> {
  const sessionStore = runtimeAdapter.getSessionStore();
  const bindingKey = sessionStore.buildBindingKey({
    workspaceId: normalized.workspaceId,
    accountId: normalized.accountId,
    senderId: normalized.senderId,
  });
  const workspaceRoot = resolveWorkspaceRoot(bindingKey);
  const threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
  const inMemoryThreadState = threadId ? threadStateStore.getThreadState(threadId) : null;
  const persistedPendingApproval = threadId && typeof sessionStore.getPendingApprovalForThread === "function"
    ? sessionStore.getPendingApprovalForThread(threadId)
    : null;

  return {
    bindingKey,
    sessionStore,
    threadId,
    threadState: mergeThreadState(inMemoryThreadState, threadId, persistedPendingApproval),
    usage: resolveThreadUsage(threadStateStore, threadId),
    workspaceRoot,
  };
}

function mergeThreadState(
  threadState: ChannelCommandThreadState | null,
  threadId: string,
  pendingApproval: PendingApprovalState | null,
): ChannelCommandThreadState | null {
  if (threadState && (!threadState.pendingApproval || !pendingApproval)) {
    return threadState;
  }
  if (threadState && pendingApproval) {
    return {
      ...threadState,
      status: "waiting_approval",
      pendingApproval,
    };
  }
  if (!threadId || !pendingApproval) {
    return threadState || null;
  }
  return {
    threadId,
    turnId: "",
    status: "waiting_approval",
    lastReplyText: "",
    lastError: "",
    pendingApproval,
    usage: null,
    updatedAt: pendingApproval.promptedAt || "",
  };
}

function resolveThreadUsage(
  threadStateStore: ChannelCommandThreadStateStore,
  threadId: string,
): ChannelCommandUsageSnapshot | null {
  if (!threadId) {
    return null;
  }
  if (typeof threadStateStore?.getUsageForThread === "function") {
    return threadStateStore.getUsageForThread(threadId);
  }
  if (typeof threadStateStore?.getLatestUsage === "function") {
    return threadStateStore.getLatestUsage(threadId);
  }
  return null;
}

export {
  buildChannelCommandContext,
};
