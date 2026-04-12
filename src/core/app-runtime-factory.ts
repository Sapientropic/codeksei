import { createWeixinChannelAdapter } from "../adapters/channel/weixin";
import { createCodexRuntimeAdapter } from "../adapters/runtime/codex";
import type {
  AppRuntimeConfig,
  AppServices,
  ChannelAdapterLike,
  ChannelCommandRouterLike,
  CreateAppServicesArgs,
  ReminderQueueLike,
  RuntimeAdapterLike,
  StreamDeliveryLike,
  SystemMessageDispatcherLike,
  SystemMessageDispatcherRef,
  SystemMessageQueueLike,
  ThreadStateStoreLike,
  TimelineIntegrationLike,
  TimelineScreenshotQueueLike,
} from "./app-service-contract";
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
import * as reminderQueueStoreModule from "../state/reminder-queue-store";
import * as systemMessageQueueStoreModule from "../state/system-message-queue-store";
import * as timelineScreenshotQueueStoreModule from "../state/timeline-screenshot-queue-store";
import * as mediaReceiveModule from "../adapters/channel/weixin/media-receive";
import * as approvalCommandPolicyModule from "./approval-command-policy";
import { StreamDelivery } from "./stream-delivery";
import { ThreadStateStore } from "./thread-state-store";
import {
  buildCodexInboundText,
  buildReminderSystemTrigger,
  getSystemMessageFailureRetryDelayMs,
  hasRpcId,
  resolveTimelineScreenshotOutput,
} from "./app-runtime-helpers";
import { formatErrorMessage } from "./app-poll-loop";

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

type AppFactoryConfig = AppRuntimeConfig;

type ResolveDefaultTerminalUser = () => string;
type ResolveReplyTargetForBinding = (bindingKey: string) => ReplyTarget | null;
type ResolveWorkspaceRoot = (bindingKey: string) => string;
type HandlePreparedMessage = (
  normalized: NormalizedIncomingMessage,
  options: HandlePreparedMessageOptions,
) => Promise<{ status: string; reason?: string } | void>;
type SendTimelineScreenshot = (payload: TimelineScreenshotRequest) => Promise<unknown>;
type HandleReplyDeliveryFailure = (payload: DeliveryFailurePayload) => Promise<void>;

export function createAppServices({
  config,
  resolveDefaultTerminalUser,
  resolveReplyTargetForBinding,
  resolveWorkspaceRoot,
  handlePreparedMessage,
  sendTimelineScreenshot,
  handleReplyDeliveryFailure,
}: CreateAppServicesArgs): AppServices {
  const typedConfig = config;
  const typedResolveDefaultTerminalUser = resolveDefaultTerminalUser;
  const typedResolveReplyTargetForBinding = resolveReplyTargetForBinding;
  const typedResolveWorkspaceRoot = resolveWorkspaceRoot;
  const typedHandlePreparedMessage = handlePreparedMessage;
  const typedSendTimelineScreenshot = sendTimelineScreenshot;
  const typedHandleReplyDeliveryFailure = handleReplyDeliveryFailure;

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
  });
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
  });
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
  }) as ChannelCommandRouterLike;
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
  });

  const systemMessageDispatcherState: SystemMessageDispatcherRef = { current: null };
  const backstageTaskLifecycle = new BackstageTaskLifecycle({
    channelAdapter,
    config: typedConfig,
    formatErrorMessage,
    getSystemMessageDispatcher: () => systemMessageDispatcherState.current,
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
  });

  return {
    backstageTaskLifecycle,
    channelAdapter,
    channelCommandRouter,
    reminderQueue,
    runtimeAdapter,
    runtimeTurnLifecycle,
    runtimeWatchdogLifecycle,
    streamDelivery,
    systemMessageDispatcherState,
    systemMessageQueue,
    threadStateStore,
    timelineIntegration,
    timelineScreenshotQueue,
  };
}
