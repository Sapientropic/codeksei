import type {
  BackstageTaskLifecycleLike,
  ChannelAdapterLike,
  ReminderQueueLike,
  RuntimeAdapterLike,
  RuntimeTurnLifecycleLike,
  RuntimeWatchdogLifecycleLike,
  SessionStoreWriterLike,
  ThreadStateStoreLike,
} from "./app-service-contract";
import type {
  DeliveryFailurePayload,
  HandlePreparedMessageOptions,
  NormalizedIncomingMessage,
  RuntimeTurnSendResult,
  SendLocalFileRequest,
  SystemDispatchResult,
} from "./runtime-types";
import { handleReplyDeliveryFailure as processReplyDeliveryFailure } from "./reply-delivery-failure";
import { resolveLongPollTimeoutMs as resolveAppLongPollTimeoutMs } from "./app-poll-loop";
import type { SystemMessage } from "../contracts/queue-items";

export async function handleIncomingRuntimeMessage({
  channelAdapter,
  message,
  runtimeTurnLifecycle,
}: {
  channelAdapter: Pick<ChannelAdapterLike, "normalizeIncomingMessage">;
  message: unknown;
  runtimeTurnLifecycle: Pick<RuntimeTurnLifecycleLike, "handlePreparedMessage">;
}): Promise<void> {
  const normalized = channelAdapter.normalizeIncomingMessage(message);
  if (!normalized) {
    return;
  }
  await runtimeTurnLifecycle.handlePreparedMessage(normalized, { allowCommands: true });
}

export async function handlePreparedRuntimeMessage({
  normalized,
  options,
  runtimeTurnLifecycle,
}: {
  normalized: NormalizedIncomingMessage;
  options: HandlePreparedMessageOptions;
  runtimeTurnLifecycle: Pick<RuntimeTurnLifecycleLike, "handlePreparedMessage">;
}): Promise<void | RuntimeTurnSendResult> {
  return runtimeTurnLifecycle.handlePreparedMessage(normalized, options);
}

export async function sendRuntimeLocalFile({
  payload,
  runtimeTurnLifecycle,
}: {
  payload: SendLocalFileRequest;
  runtimeTurnLifecycle: Pick<RuntimeTurnLifecycleLike, "sendLocalFileToCurrentChat">;
}): Promise<unknown> {
  return runtimeTurnLifecycle.sendLocalFileToCurrentChat(payload);
}

export function resolveAppLongPollWindow({
  activeAccountId,
  reminderQueue,
  systemMessageDispatcher,
}: {
  activeAccountId: string;
  reminderQueue: ReminderQueueLike;
  systemMessageDispatcher: { hasPending(): boolean } | null;
}): number {
  return resolveAppLongPollTimeoutMs({
    systemMessageDispatcher,
    activeAccountId,
    reminderQueue,
    defaultLongPollTimeoutMs: 35_000,
    minLongPollTimeoutMs: 2_000,
  });
}

export async function handleReplyDeliveryFailureDelegate({
  payload,
  runtimeAdapter,
  runtimeWatchdogLifecycle,
  sessionWriter,
  threadStateStore,
}: {
  payload: DeliveryFailurePayload;
  runtimeAdapter: RuntimeAdapterLike;
  runtimeWatchdogLifecycle: Pick<
    RuntimeWatchdogLifecycleLike,
    "clearRuntimeEventWatchdog" | "clearTurnSettlementWatchdog" | "stopTypingForThread"
  >;
  sessionWriter: SessionStoreWriterLike;
  threadStateStore: ThreadStateStoreLike;
}): Promise<void> {
  await processReplyDeliveryFailure({
    threadId: payload.threadId,
    turnId: payload.turnId || "",
    error: payload.error,
    sentText: payload.sentText || "",
  }, {
    runtimeAdapter,
    sessionWriter,
    threadStateStore,
    clearRuntimeEventWatchdog: (threadId: string) => runtimeWatchdogLifecycle.clearRuntimeEventWatchdog(threadId),
    clearTurnSettlementWatchdog: (threadId: string, turnId: string) => {
      runtimeWatchdogLifecycle.clearTurnSettlementWatchdog(threadId, turnId);
    },
    stopTypingForThread: (threadId: string) => runtimeWatchdogLifecycle.stopTypingForThread(threadId),
  });
}

export async function dispatchSystemMessageViaBackstage({
  backstageTaskLifecycle,
  message,
}: {
  backstageTaskLifecycle: Pick<BackstageTaskLifecycleLike, "dispatchSystemMessage">;
  message: SystemMessage;
}): Promise<SystemDispatchResult> {
  return backstageTaskLifecycle.dispatchSystemMessage(message);
}
