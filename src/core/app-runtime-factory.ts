import { createWeixinChannelAdapter } from "../adapters/channel/weixin";
import { createCodexRuntimeAdapter } from "../adapters/runtime/codex";
import { BackstageTaskLifecycle } from "./backstage-task-lifecycle";
import { RuntimeTurnLifecycle } from "./runtime-turn-lifecycle";
import type {
  DeliveryFailurePayload,
  HandlePreparedMessageOptions,
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
  ReplyTarget,
  TimelineScreenshotRequest,
} from "./runtime-types";
import { RuntimeWatchdogLifecycle } from "./runtime-watchdog-lifecycle";
import * as timelineIntegrationModule from "../integrations/timeline";
import * as channelCommandRouterModule from "./channel-command-router";
import * as controlCommandHandlersModule from "./channel-command-control-handlers";
import * as workspaceCommandHandlersModule from "./channel-command-workspace-handlers";
import * as streamDeliveryModule from "./stream-delivery";
import * as threadStateStoreModule from "./thread-state-store";
import * as reminderQueueStoreModule from "../state/reminder-queue-store";
import * as systemMessageQueueStoreModule from "../state/system-message-queue-store";
import * as timelineScreenshotQueueStoreModule from "../state/timeline-screenshot-queue-store";
import * as mediaReceiveModule from "../adapters/channel/weixin/media-receive";
import * as approvalCommandPolicyModule from "./approval-command-policy";
import * as appRuntimeHelpersModule from "./app-runtime-helpers";
import * as appPollLoopModule from "./app-poll-loop";

const FIRST_RUNTIME_EVENT_NOTICE_TIMEOUT_MS = 8_000;
const FIRST_RUNTIME_EVENT_FAILURE_TIMEOUT_MS = 45_000;
const SYSTEM_MESSAGE_BUSY_RETRY_MS = 30_000;
// Once a reply has already started streaming, the common failure mode is a
// long tool / search / browser phase with no assistant text for a while. Keep
// the watchdog conservative so we do not prematurely cut off healthy turns.
const STREAM_SETTLEMENT_TIMEOUT_MS = 5 * 60_000;

const { createTimelineIntegration } = timelineIntegrationModule as {
  createTimelineIntegration: (config: AppFactoryConfig) => TimelineIntegrationLike;
};
const { ChannelCommandRouter } = channelCommandRouterModule as {
  ChannelCommandRouter: new (args: {
    workspaceHandlers: unknown;
    controlHandlers: unknown;
  }) => {
    maybeDispatchCommand(normalized: NormalizedIncomingMessage): Promise<boolean>;
  };
};
const { createControlCommandHandlers } = controlCommandHandlersModule as {
  createControlCommandHandlers: (args: Record<string, unknown>) => unknown;
};
const { createWorkspaceCommandHandlers } = workspaceCommandHandlersModule as {
  createWorkspaceCommandHandlers: (args: Record<string, unknown>) => unknown;
};
const { StreamDelivery } = streamDeliveryModule as {
  StreamDelivery: new (args: {
    channelAdapter: ChannelAdapterLike;
    sessionStore: unknown;
    weixinReplyMode?: unknown;
    deliveryTraceEnabled?: unknown;
    onDeliveryFailure?: (payload: DeliveryFailurePayload) => Promise<void> | void;
  }) => StreamDeliveryLike;
};
const { ThreadStateStore } = threadStateStoreModule as {
  ThreadStateStore: new () => ThreadStateStoreLike;
};
const { ReminderQueueStore } = reminderQueueStoreModule as {
  ReminderQueueStore: new (args: { filePath: unknown }) => ReminderQueueLike;
};
const { SystemMessageQueueStore } = systemMessageQueueStoreModule as {
  SystemMessageQueueStore: new (args: {
    filePath: unknown;
    deadLetterFilePath: unknown;
  }) => SystemMessageQueueLike;
};
const { TimelineScreenshotQueueStore } = timelineScreenshotQueueStoreModule as {
  TimelineScreenshotQueueStore: new (args: { filePath: unknown }) => TimelineScreenshotQueueLike;
};
const { persistIncomingWeixinAttachments } = mediaReceiveModule as {
  persistIncomingWeixinAttachments: (
    args: Record<string, unknown>,
  ) => Promise<{ saved: unknown[]; failed: Array<{ reason: string }> }>;
};
const {
  buildApprovalPromptSignature,
  buildApprovalPromptText,
  matchesBuiltInCommandPrefix,
  matchesCommandPrefix,
  normalizeCommandArgument,
  normalizeText,
} = approvalCommandPolicyModule as {
  buildApprovalPromptSignature: (approval: unknown) => string;
  buildApprovalPromptText: (approval: unknown) => string;
  matchesBuiltInCommandPrefix: (commandTokens: unknown) => boolean;
  matchesCommandPrefix: (commandTokens: unknown, allowlist: string[][]) => boolean;
  normalizeCommandArgument: (value: unknown) => string;
  normalizeText: (value: unknown) => string;
};
const {
  buildCodexInboundText,
  buildReminderSystemTrigger,
  getSystemMessageFailureRetryDelayMs,
  hasRpcId,
  resolveTimelineScreenshotOutput,
} = appRuntimeHelpersModule as {
  buildCodexInboundText: (
    normalized: NormalizedIncomingMessage,
    persisted: { saved: unknown[]; failed: Array<{ reason: string }> },
    config: AppFactoryConfig,
  ) => string;
  buildReminderSystemTrigger: (reminder: unknown, config: AppFactoryConfig) => string;
  getSystemMessageFailureRetryDelayMs: (attemptCount: number) => number;
  hasRpcId: (requestId: unknown) => boolean;
  resolveTimelineScreenshotOutput: (args: string[]) => string;
};
const { formatErrorMessage } = appPollLoopModule as {
  formatErrorMessage: (error: unknown) => string;
};

interface AppFactoryConfig extends Record<string, unknown> {
  stateDir: string;
  sessionsFile: string;
  workspaceId: string;
  workspaceRoot: string;
  systemMessageQueueFile?: unknown;
  systemMessageDeadLetterFile?: unknown;
  timelineScreenshotQueueFile?: unknown;
  reminderQueueFile?: unknown;
  weixinReplyMode?: unknown;
  weixinDeliveryTrace?: unknown;
}

type ResolveDefaultTerminalUser = () => string;
type ResolveReplyTargetForBinding = (bindingKey: string) => ReplyTarget | null;
type ResolveWorkspaceRoot = (bindingKey: string) => string;
type HandlePreparedMessage = (
  normalized: NormalizedIncomingMessage,
  options: HandlePreparedMessageOptions,
) => Promise<{ status: string; reason?: string } | void>;
type SendTimelineScreenshot = (payload: TimelineScreenshotRequest) => Promise<unknown>;
type HandleReplyDeliveryFailure = (payload: DeliveryFailurePayload) => Promise<void>;

interface CreateAppServicesArgs extends Record<string, unknown> {
  config: AppFactoryConfig;
  resolveDefaultTerminalUser: ResolveDefaultTerminalUser;
  resolveReplyTargetForBinding: ResolveReplyTargetForBinding;
  resolveWorkspaceRoot: ResolveWorkspaceRoot;
  handlePreparedMessage: HandlePreparedMessage;
  sendTimelineScreenshot: SendTimelineScreenshot;
  handleReplyDeliveryFailure: HandleReplyDeliveryFailure;
}

interface ChannelAdapterLike {
  describe(): { id: string };
  login(): Promise<unknown>;
  printAccounts(): void;
  resolveAccount(): { accountId: string; baseUrl: string };
  getKnownContextTokens(): Record<string, string>;
  loadSyncBuffer(): string;
  normalizeIncomingMessage(message: unknown): NormalizedIncomingMessage | null;
  sendText(payload: {
    userId: string;
    text: string;
    contextToken: string;
    preserveBlock?: boolean;
  }): Promise<unknown>;
  sendTyping(payload: { userId: string; status: number; contextToken: string }): Promise<unknown>;
  sendFile(payload: { userId: string; filePath: string; contextToken?: string }): Promise<unknown>;
}

interface ReminderQueueLike extends Record<string, unknown> {
  listDue(nowMs: number): unknown[];
  peekNextDueAtMs(): number;
  enqueue(reminder: unknown): void;
}

interface SystemMessageQueueLike extends Record<string, unknown> {
  enqueue(message: Record<string, unknown>): void;
}

interface TimelineScreenshotQueueLike extends Record<string, unknown> {
  drainForAccount(accountId: string): Array<{
    id: string;
    senderId: string;
    outputFile: string;
    args: string[];
  }>;
}

interface StreamDeliveryLike {
  setReplyTarget(bindingKey: string, target: ReplyTarget): void;
  queueReplyTargetForThread(threadId: string, target: ReplyTarget): void;
  handleRuntimeEvent(event: unknown): Promise<void>;
  finalizeAbandonedTurn(args: {
    threadId: string;
    turnId?: string;
    trailingText?: string;
  }): Promise<unknown>;
}

interface ThreadStateStoreLike extends Record<string, unknown> {
  snapshot(): unknown;
  applyRuntimeEvent(event: unknown): void;
  getThreadState(threadId: string): {
    status?: string;
    turnId?: string;
    pendingApproval?: unknown;
  } | null;
  markTurnFailed(threadId: string, turnId: string, message?: string): unknown;
  resolveApproval(threadId: string, status?: string): unknown;
  hydratePendingApproval(threadId: string, approval: unknown): unknown;
}

interface TimelineIntegrationLike {
  describe(): { id: string };
  runSubcommand(command: string, args: string[]): Promise<unknown>;
}

export function createAppServices({
  config,
  resolveDefaultTerminalUser,
  resolveReplyTargetForBinding,
  resolveWorkspaceRoot,
  handlePreparedMessage,
  sendTimelineScreenshot,
  handleReplyDeliveryFailure,
}: Record<string, unknown>) {
  const typedArgs = {
    config,
    resolveDefaultTerminalUser,
    resolveReplyTargetForBinding,
    resolveWorkspaceRoot,
    handlePreparedMessage,
    sendTimelineScreenshot,
    handleReplyDeliveryFailure,
  } as CreateAppServicesArgs;
  const {
    config: typedConfig,
    resolveDefaultTerminalUser: typedResolveDefaultTerminalUser,
    resolveReplyTargetForBinding: typedResolveReplyTargetForBinding,
    resolveWorkspaceRoot: typedResolveWorkspaceRoot,
    handlePreparedMessage: typedHandlePreparedMessage,
    sendTimelineScreenshot: typedSendTimelineScreenshot,
    handleReplyDeliveryFailure: typedHandleReplyDeliveryFailure,
  } = typedArgs;
  const channelAdapter = createWeixinChannelAdapter(typedConfig);
  const runtimeAdapter = createCodexRuntimeAdapter(typedConfig);
  const timelineIntegration = createTimelineIntegration(typedConfig);
  const threadStateStore = new ThreadStateStore();
  const systemMessageQueue = new SystemMessageQueueStore({
    filePath: typedConfig.systemMessageQueueFile,
    deadLetterFilePath: typedConfig.systemMessageDeadLetterFile,
  });
  const timelineScreenshotQueue = new TimelineScreenshotQueueStore({ filePath: typedConfig.timelineScreenshotQueueFile });
  const reminderQueue = new ReminderQueueStore({ filePath: typedConfig.reminderQueueFile });
  const streamDelivery = new StreamDelivery({
    channelAdapter,
    sessionStore: runtimeAdapter.getSessionStore(),
    weixinReplyMode: typedConfig.weixinReplyMode,
    deliveryTraceEnabled: typedConfig.weixinDeliveryTrace,
    onDeliveryFailure: (payload: DeliveryFailurePayload) => typedHandleReplyDeliveryFailure(payload),
  } as any);
  const runtimeWatchdogLifecycle = new RuntimeWatchdogLifecycle({
    buildApprovalPromptSignature,
    buildApprovalPromptText,
    channelAdapter,
    matchesBuiltInCommandPrefix,
    matchesCommandPrefix,
    normalizeCommandArgument,
    normalizeText,
    resolveReplyTargetForBinding: typedResolveReplyTargetForBinding,
    runtimeAdapter,
    streamDelivery,
    streamSettlementTimeoutMs: STREAM_SETTLEMENT_TIMEOUT_MS,
    threadStateStore,
    firstRuntimeEventFailureTimeoutMs: FIRST_RUNTIME_EVENT_FAILURE_TIMEOUT_MS,
    firstRuntimeEventNoticeTimeoutMs: FIRST_RUNTIME_EVENT_NOTICE_TIMEOUT_MS,
  } as any);
  const channelCommandRouter = new ChannelCommandRouter({
    workspaceHandlers: createWorkspaceCommandHandlers({
      channelAdapter,
      config: typedConfig,
      resolveWorkspaceRoot: typedResolveWorkspaceRoot,
      runtimeAdapter,
      scheduleRuntimeEventWatchdog: (payload: {
        bindingKey: string;
        workspaceRoot: string;
        normalized: PreparedRuntimeMessage;
        threadId?: string;
      }) => runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog(payload),
      streamDelivery,
      threadStateStore,
    }),
    controlHandlers: createControlCommandHandlers({
      channelAdapter,
      resolveWorkspaceRoot: typedResolveWorkspaceRoot,
      runtimeAdapter,
      threadStateStore,
    }),
  } as any);
  const runtimeTurnLifecycle = new RuntimeTurnLifecycle({
    channelAdapter,
    config: typedConfig,
    formatErrorMessage,
    maybeDispatchCommand: (normalized: NormalizedIncomingMessage) => channelCommandRouter.maybeDispatchCommand(normalized),
    normalizeText,
    persistIncomingWeixinAttachments,
    queuePendingWorkspaceBootstrap: (payload: {
      bindingKey: string;
      workspaceRoot: string;
      threadId: string;
    }) => runtimeWatchdogLifecycle.queuePendingWorkspaceBootstrap(payload),
    resolveDefaultTerminalUser: typedResolveDefaultTerminalUser,
    resolveTimelineScreenshotOutput,
    resolveWorkspaceRoot: typedResolveWorkspaceRoot,
    runtimeAdapter,
    scheduleRuntimeEventWatchdog: (payload: {
      bindingKey: string;
      workspaceRoot: string;
      normalized: PreparedRuntimeMessage;
      threadId?: string;
    }) => runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog(payload),
    streamDelivery,
    timelineIntegration,
    buildCodexInboundText,
  } as any);

  const systemMessageDispatcherState: { current: unknown } = { current: null };
  const backstageTaskLifecycle = new BackstageTaskLifecycle({
    channelAdapter,
    config: typedConfig,
    formatErrorMessage,
    getSystemMessageDispatcher: () => systemMessageDispatcherState.current as any,
    getSystemMessageFailureRetryDelayMs,
    handlePreparedMessage: typedHandlePreparedMessage,
    hasRpcId,
    normalizeText,
    reminderQueue,
    runtimeAdapter,
    sendTimelineScreenshot: typedSendTimelineScreenshot,
    systemMessageBusyRetryMs: SYSTEM_MESSAGE_BUSY_RETRY_MS,
    systemMessageQueue,
    threadStateStore,
    timelineScreenshotQueue,
    buildReminderSystemTrigger,
    resolveWorkspaceRoot: typedResolveWorkspaceRoot,
  } as any);

  return {
    backstageTaskLifecycle,
    channelAdapter: channelAdapter as unknown as ChannelAdapterLike,
    channelCommandRouter,
    reminderQueue,
    runtimeAdapter,
    runtimeTurnLifecycle,
    runtimeWatchdogLifecycle,
    streamDelivery: streamDelivery as unknown as StreamDeliveryLike,
    systemMessageDispatcherState,
    systemMessageQueue,
    threadStateStore: threadStateStore as unknown as ThreadStateStoreLike,
    timelineIntegration,
    timelineScreenshotQueue: timelineScreenshotQueue as unknown as TimelineScreenshotQueueLike,
  };
}
