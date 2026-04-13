import {
  isRuntimeFirstProgressEventType,
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
} from "../contracts/runtime-events";
import { ignoreBestEffortError } from "../core/error-handling";
import type { ChannelAdapterLike, RuntimeAdapterLike, StreamDeliveryLike, ThreadStateStoreLike } from "../core/app-service-contract";
import { operatorMessages, userFacingMessages } from "../core/message-catalog";
import type {
  PreparedRuntimeMessage,
  UnknownRecord,
} from "../core/runtime-types";

interface ThreadStateSnapshot {
  status?: string;
  turnId?: string;
}

export interface RuntimeEventWatchdogEntry {
  noticeTimer: NodeJS.Timeout;
  failureTimer: NodeJS.Timeout;
  noticeSent: boolean;
}

export interface TurnSettlementWatchdogEntry {
  timer: NodeJS.Timeout;
}

export interface WorkspaceBootstrapEntry {
  bindingKey: string;
  workspaceRoot: string;
}

type NormalizeCommandArgument = (value: unknown) => string;
type NormalizeText = (value: unknown) => string;

export interface RuntimeWatchdogTimerDependencies {
  channelAdapter: ChannelAdapterLike;
  runtimeAdapter: RuntimeAdapterLike;
  streamDelivery: StreamDeliveryLike;
  threadStateStore: ThreadStateStoreLike;
  firstRuntimeEventFailureTimeoutMs: number;
  firstRuntimeEventNoticeTimeoutMs: number;
  streamSettlementTimeoutMs: number;
  normalizeCommandArgument: NormalizeCommandArgument;
  normalizeText: NormalizeText;
  clearPendingApproval: (threadId: unknown) => Promise<void>;
  rememberWorkspaceBootstrapForThread: (
    bindingKey: string,
    workspaceRoot: string,
    threadId: string,
  ) => Promise<unknown>;
  stopTypingForThread: (threadId: unknown) => Promise<void>;
}

export function observeRuntimeEvent(
  dependencies: RuntimeWatchdogTimerDependencies,
  pendingRuntimeEventWatchdogs: Map<string, RuntimeEventWatchdogEntry>,
  pendingTurnSettlementWatchdogs: Map<string, TurnSettlementWatchdogEntry>,
  pendingWorkspaceBootstrapByThreadId: Map<string, WorkspaceBootstrapEntry>,
  event: RuntimeEvent<UnknownRecord>,
): void {
  if (isRuntimeFirstProgressEventType(event?.type)) {
    clearRuntimeEventWatchdog(
      dependencies.normalizeCommandArgument,
      pendingRuntimeEventWatchdogs,
      event?.payload?.threadId,
    );
  }
  refreshTurnSettlementWatchdog(
    dependencies,
    pendingTurnSettlementWatchdogs,
    event,
  );
}

export function scheduleRuntimeEventWatchdog(
  dependencies: RuntimeWatchdogTimerDependencies,
  pendingRuntimeEventWatchdogs: Map<string, RuntimeEventWatchdogEntry>,
  {
    bindingKey,
    workspaceRoot,
    normalized,
    threadId = "",
  }: {
    bindingKey: string;
    workspaceRoot: string;
    normalized: PreparedRuntimeMessage;
    threadId?: string;
  },
): void {
  const sessionStore = dependencies.runtimeAdapter.getSessionStore();
  const candidateThreadId = dependencies.normalizeCommandArgument(threadId)
    || sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
  const normalizedThreadId = dependencies.normalizeCommandArgument(candidateThreadId);
  if (!normalizedThreadId) {
    return;
  }

  clearRuntimeEventWatchdog(
    dependencies.normalizeCommandArgument,
    pendingRuntimeEventWatchdogs,
    normalizedThreadId,
  );
  const noticeTimer = setTimeout(async () => {
    const watchdog = pendingRuntimeEventWatchdogs.get(normalizedThreadId);
    if (!watchdog) {
      return;
    }
    const currentThreadState = dependencies.threadStateStore.getThreadState(normalizedThreadId);
    if (hasObservedInitialRuntimeProgress(currentThreadState)) {
      return;
    }
    watchdog.noticeSent = true;
    await ignoreBestEffortError(dependencies.channelAdapter.sendText({
      userId: normalized.senderId,
      contextToken: normalized.contextToken,
      preserveBlock: true,
      text: userFacingMessages.runtimeFirstEventNotice(workspaceRoot, normalizedThreadId),
    }), {
      label: "runtime first-event notice",
      reason: "first-event notice is best-effort; watchdog timing should continue even if chat delivery fails",
    });
  }, dependencies.firstRuntimeEventNoticeTimeoutMs);
  const failureTimer = setTimeout(async () => {
    pendingRuntimeEventWatchdogs.delete(normalizedThreadId);
    const currentThreadState = dependencies.threadStateStore.getThreadState(normalizedThreadId);
    if (hasObservedInitialRuntimeProgress(currentThreadState)) {
      return;
    }
    await ignoreBestEffortError(dependencies.channelAdapter.sendTyping({
      userId: normalized.senderId,
      status: 0,
      contextToken: normalized.contextToken,
    }), {
      label: "runtime watchdog typing stop",
      reason: "typing stop is best-effort cleanup before the failure escalation notice",
    });
    await ignoreBestEffortError(dependencies.channelAdapter.sendText({
      userId: normalized.senderId,
      contextToken: normalized.contextToken,
      preserveBlock: true,
      text: userFacingMessages.runtimeFirstEventFailure(workspaceRoot, normalizedThreadId),
    }), {
      label: "runtime first-event failure notice",
      reason: "the escalation notice is best-effort after the watchdog already concluded this turn is stuck",
    });
  }, dependencies.firstRuntimeEventFailureTimeoutMs);
  pendingRuntimeEventWatchdogs.set(normalizedThreadId, {
    noticeTimer,
    failureTimer,
    noticeSent: false,
  });
}

export function clearRuntimeEventWatchdog(
  normalizeCommandArgument: NormalizeCommandArgument,
  pendingRuntimeEventWatchdogs: Map<string, RuntimeEventWatchdogEntry>,
  threadId: unknown,
): void {
  const normalizedThreadId = normalizeCommandArgument(threadId);
  if (!normalizedThreadId) {
    return;
  }
  const watchdog = pendingRuntimeEventWatchdogs.get(normalizedThreadId);
  if (!watchdog) {
    return;
  }
  clearTimeout(watchdog.noticeTimer);
  clearTimeout(watchdog.failureTimer);
  pendingRuntimeEventWatchdogs.delete(normalizedThreadId);
}

export function refreshTurnSettlementWatchdog(
  dependencies: RuntimeWatchdogTimerDependencies,
  pendingTurnSettlementWatchdogs: Map<string, TurnSettlementWatchdogEntry>,
  event: RuntimeEvent<UnknownRecord>,
): void {
  const threadId = dependencies.normalizeCommandArgument(event?.payload?.threadId);
  const turnId = dependencies.normalizeCommandArgument(event?.payload?.turnId);
  if (!threadId || !turnId) {
    return;
  }

  if (
    event.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED
    || event.type === RUNTIME_EVENT_TYPES.TURN_FAILED
    || event.type === RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED
  ) {
    clearTurnSettlementWatchdog(
      dependencies.normalizeCommandArgument,
      pendingTurnSettlementWatchdogs,
      threadId,
      turnId,
    );
    return;
  }
  if (
    event.type !== RUNTIME_EVENT_TYPES.REPLY_DELTA
    && event.type !== RUNTIME_EVENT_TYPES.REPLY_COMPLETED
  ) {
    return;
  }

  const watchdogKey = buildTurnSettlementWatchdogKey(threadId, turnId, dependencies.normalizeCommandArgument);
  clearTurnSettlementWatchdog(
    dependencies.normalizeCommandArgument,
    pendingTurnSettlementWatchdogs,
    threadId,
    turnId,
  );
  const timer = setTimeout(async () => {
    pendingTurnSettlementWatchdogs.delete(watchdogKey);
    const currentThreadState = dependencies.threadStateStore.getThreadState(threadId);
    if (!currentThreadState || currentThreadState.turnId !== turnId || currentThreadState.status !== "running") {
      return;
    }

    const linked = dependencies.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
    const workspaceRoot = dependencies.normalizeText(linked?.workspaceRoot);
    // Once a reply has already started streaming, hanging forever is worse
    // than surfacing a partial answer. We only trip this guard after a long
    // quiet period to avoid fighting normal long-running tool calls.
    console.error(operatorMessages.runtimeSettlementWatchdogExpired(threadId, turnId, workspaceRoot));
    await dependencies.streamDelivery.finalizeAbandonedTurn({
      threadId,
      turnId,
      trailingText: [
        "【系统提示】",
        "这一轮回复已经开始输出，但 Codex runtime 一直没有发回完成或失败事件。",
        "我先把目前拿到的内容停在这里，避免你继续看到假 typing。",
        "如果 runtime 稍后恢复并补发完成事件，我会自动续发剩下的内容。",
        "只有在长时间都没有新内容时，再发一句“继续刚才那条未完回复”就行。",
      ].join("\n"),
    });
    dependencies.threadStateStore.markTurnFailed(
      threadId,
      turnId,
      "这轮回复已经开始输出，但 Codex runtime 一直没有发回完成或失败事件。",
    );
    await dependencies.clearPendingApproval(threadId);
    await dependencies.stopTypingForThread(threadId);
  }, dependencies.streamSettlementTimeoutMs);
  pendingTurnSettlementWatchdogs.set(watchdogKey, { timer });
}

export function clearTurnSettlementWatchdog(
  normalizeCommandArgument: NormalizeCommandArgument,
  pendingTurnSettlementWatchdogs: Map<string, TurnSettlementWatchdogEntry>,
  threadId: unknown,
  turnId: unknown,
): void {
  const watchdogKey = buildTurnSettlementWatchdogKey(threadId, turnId, normalizeCommandArgument);
  if (!watchdogKey) {
    return;
  }
  const watchdog = pendingTurnSettlementWatchdogs.get(watchdogKey);
  if (!watchdog) {
    return;
  }
  clearTimeout(watchdog.timer);
  pendingTurnSettlementWatchdogs.delete(watchdogKey);
}

export function queuePendingWorkspaceBootstrap(
  normalizeText: NormalizeText,
  pendingWorkspaceBootstrapByThreadId: Map<string, WorkspaceBootstrapEntry>,
  {
    bindingKey,
    workspaceRoot,
    threadId,
  }: {
    bindingKey: string;
    workspaceRoot: string;
    threadId: string;
  },
): void {
  const normalizedBindingKey = normalizeText(bindingKey);
  const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedBindingKey || !normalizedWorkspaceRoot || !normalizedThreadId) {
    return;
  }
  pendingWorkspaceBootstrapByThreadId.set(normalizedThreadId, {
    bindingKey: normalizedBindingKey,
    workspaceRoot: normalizedWorkspaceRoot,
  });
}

export async function confirmPendingWorkspaceBootstrap(
  dependencies: Pick<RuntimeWatchdogTimerDependencies, "normalizeText" | "rememberWorkspaceBootstrapForThread">,
  pendingWorkspaceBootstrapByThreadId: Map<string, WorkspaceBootstrapEntry>,
  event: RuntimeEvent<UnknownRecord>,
): Promise<void> {
  if (!event || event.type === RUNTIME_EVENT_TYPES.USAGE_UPDATED) {
    return;
  }
  const threadId = dependencies.normalizeText(event?.payload?.threadId);
  if (!threadId) {
    return;
  }
  const pending = pendingWorkspaceBootstrapByThreadId.get(threadId);
  if (!pending?.bindingKey || !pending?.workspaceRoot) {
    return;
  }
  // Do not mark workspace bootstrap as done when sendUserMessage merely
  // returns. In shared mode the runtime can still stall before emitting the
  // first real thread event, and prematurely persisting success would skip the
  // next retry's continuity bootstrap.
  await dependencies.rememberWorkspaceBootstrapForThread(
    pending.bindingKey,
    pending.workspaceRoot,
    threadId,
  );
  pendingWorkspaceBootstrapByThreadId.delete(threadId);
}

export function buildTurnSettlementWatchdogKey(
  threadId: unknown,
  turnId: unknown,
  normalizeCommandArgument: NormalizeCommandArgument,
): string {
  const normalizedThreadId = normalizeCommandArgument(threadId);
  const normalizedTurnId = normalizeCommandArgument(turnId);
  if (!normalizedThreadId || !normalizedTurnId) {
    return "";
  }
  return `${normalizedThreadId}:${normalizedTurnId}`;
}

export function hasObservedInitialRuntimeProgress(
  threadState: ThreadStateSnapshot | null | undefined,
): boolean {
  // The "first runtime event" watchdog is only meant to answer one question:
  // did this new send receive any live runtime progress yet? Old terminal turn
  // ids linger in thread state after completion/failure, so using a non-empty
  // historical turnId here suppresses the watchdog on every later send for the
  // same thread. Only live, non-terminal states should short-circuit it.
  return threadState?.status === "running" || threadState?.status === "waiting_approval";
}
