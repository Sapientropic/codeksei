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
import { BackstageTaskLifecycle } from "../runtime/backstage-task-lifecycle";
import { RuntimeTurnLifecycle } from "../runtime/runtime-turn-lifecycle";
import type {
  DeliveryFailurePayload,
  HandlePreparedMessageOptions,
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
  ReplyTarget,
  TimelineScreenshotRequest,
} from "./runtime-types";
import { RuntimeWatchdogLifecycle } from "../runtime/runtime-watchdog-lifecycle";
import { createTimelineIntegration } from "../integrations/timeline";
import { ChannelCommandRouter } from "./channel-command-router";
import { createControlCommandHandlers } from "./channel-command-control-handlers";
import { createWorkspaceCommandHandlers } from "./channel-command-workspace-handlers";
import {
  buildApprovalPromptSignature,
  buildApprovalPromptText,
  matchesBuiltInCommandPrefix,
  matchesCommandPrefix,
  normalizeCommandArgument,
  normalizeTrimmedText,
} from "./approval-command-policy";
import { StreamDelivery } from "../runtime/stream-delivery";
import { ThreadStateStore } from "../runtime/thread-state-store";
import { ReminderQueueStore } from "../state/reminder-queue-store";
import { SystemMessageQueueStore } from "../state/system-message-queue-store";
import { TimelineScreenshotQueueStore } from "../state/timeline-screenshot-queue-store";
import { persistIncomingWeixinAttachments } from "../adapters/channel/weixin/media-receive";
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

interface AppInfrastructure {
  channelAdapter: AppServices["channelAdapter"];
  reminderQueue: AppServices["reminderQueue"];
  runtimeAdapter: AppServices["runtimeAdapter"];
  sessionWriter: AppServices["sessionWriter"];
  streamDelivery: AppServices["streamDelivery"];
  systemMessageQueue: AppServices["systemMessageQueue"];
  threadStateStore: AppServices["threadStateStore"];
  timelineIntegration: AppServices["timelineIntegration"];
  timelineScreenshotQueue: AppServices["timelineScreenshotQueue"];
}

interface AppWorkflowArgs {
  infrastructure: AppInfrastructure;
  config: AppFactoryConfig;
  resolveDefaultTerminalUser: ResolveDefaultTerminalUser;
  resolveReplyTargetForBinding: ResolveReplyTargetForBinding;
  resolveWorkspaceRoot: ResolveWorkspaceRoot;
  handlePreparedMessage: HandlePreparedMessage;
  sendTimelineScreenshot: SendTimelineScreenshot;
}

function createAppInfrastructure({
  config,
  handleReplyDeliveryFailure,
}: {
  config: AppFactoryConfig;
  handleReplyDeliveryFailure: HandleReplyDeliveryFailure;
}): AppInfrastructure {
  const systemMessageQueueFile = typeof config.systemMessageQueueFile === "string" ? config.systemMessageQueueFile : "";
  const systemMessageDeadLetterFile = typeof config.systemMessageDeadLetterFile === "string"
    ? config.systemMessageDeadLetterFile
    : "";
  const timelineScreenshotQueueFile = typeof config.timelineScreenshotQueueFile === "string"
    ? config.timelineScreenshotQueueFile
    : "";
  const reminderQueueFile = typeof config.reminderQueueFile === "string" ? config.reminderQueueFile : "";

  const channelAdapter = createWeixinChannelAdapter(config);
  const runtimeAdapter = createCodexRuntimeAdapter(config);
  const sessionWriter = runtimeAdapter.getSessionWriter();
  const timelineIntegration = createTimelineIntegration(config);
  const threadStateStore = new ThreadStateStore();
  const systemMessageQueue = new SystemMessageQueueStore({
    filePath: systemMessageQueueFile,
    deadLetterFilePath: systemMessageDeadLetterFile,
  });
  const timelineScreenshotQueue = new TimelineScreenshotQueueStore({ filePath: timelineScreenshotQueueFile });
  const reminderQueue = new ReminderQueueStore({ filePath: reminderQueueFile });
  const streamDelivery = new StreamDelivery({
    channelAdapter,
    sessionStore: runtimeAdapter.getSessionStore(),
    weixinReplyMode: typeof config.weixinReplyMode === "string" ? config.weixinReplyMode : "",
    deliveryTraceEnabled: Boolean(config.weixinDeliveryTrace),
    onDeliveryFailure: (payload: DeliveryFailurePayload) => handleReplyDeliveryFailure(payload),
  });

  return {
    channelAdapter,
    reminderQueue,
    runtimeAdapter,
    sessionWriter,
    streamDelivery,
    systemMessageQueue,
    threadStateStore,
    timelineIntegration,
    timelineScreenshotQueue,
  };
}

function createRuntimeWorkflowServices({
  infrastructure,
  config,
  resolveDefaultTerminalUser,
  resolveReplyTargetForBinding,
  resolveWorkspaceRoot,
  handlePreparedMessage,
  sendTimelineScreenshot,
}: AppWorkflowArgs): Pick<
  AppServices,
  "backstageTaskLifecycle" | "channelCommandRouter" | "runtimeTurnLifecycle" | "runtimeWatchdogLifecycle" | "systemMessageDispatcherState"
> {
  const {
    channelAdapter,
    reminderQueue,
    runtimeAdapter,
    sessionWriter,
    streamDelivery,
    systemMessageQueue,
    threadStateStore,
    timelineIntegration,
    timelineScreenshotQueue,
  } = infrastructure;

  const runtimeWatchdogLifecycle = new RuntimeWatchdogLifecycle({
    buildApprovalPromptSignature,
    buildApprovalPromptText,
    channelAdapter,
    matchesBuiltInCommandPrefix,
    matchesCommandPrefix,
    normalizeCommandArgument,
    normalizeText: normalizeTrimmedText,
    resolveReplyTargetForBinding,
    runtimeAdapter,
    sessionWriter,
    streamDelivery,
    streamSettlementTimeoutMs: STREAM_SETTLEMENT_TIMEOUT_MS,
    threadStateStore,
    firstRuntimeEventFailureTimeoutMs: FIRST_RUNTIME_EVENT_FAILURE_TIMEOUT_MS,
    firstRuntimeEventNoticeTimeoutMs: FIRST_RUNTIME_EVENT_NOTICE_TIMEOUT_MS,
  });
  const channelCommandRouter = new ChannelCommandRouter({
    workspaceHandlers: createWorkspaceCommandHandlers({
      channelAdapter,
      config,
      resolveWorkspaceRoot,
      runtimeAdapter,
      sessionWriter,
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
      config,
      resolveWorkspaceRoot,
      runtimeAdapter,
      sessionWriter,
      threadStateStore,
    }),
  }) as ChannelCommandRouterLike;
  const runtimeTurnLifecycle = new RuntimeTurnLifecycle({
    channelAdapter,
    config,
    formatErrorMessage,
    maybeDispatchCommand: (normalized: NormalizedIncomingMessage) => channelCommandRouter.maybeDispatchCommand(normalized),
    normalizeText: normalizeTrimmedText,
    persistIncomingWeixinAttachments,
    queuePendingWorkspaceBootstrap: (payload: {
      bindingKey: string;
      workspaceRoot: string;
      threadId: string;
    }) => runtimeWatchdogLifecycle.queuePendingWorkspaceBootstrap(payload),
    resolveDefaultTerminalUser,
    resolveTimelineScreenshotOutput,
    resolveWorkspaceRoot,
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
    config,
    formatErrorMessage,
    getSystemMessageDispatcher: () => systemMessageDispatcherState.current,
    getSystemMessageFailureRetryDelayMs,
    handlePreparedMessage,
    hasRpcId,
    normalizeText: normalizeTrimmedText,
    reminderQueue,
    runtimeAdapter,
    sendTimelineScreenshot,
    systemMessageBusyRetryMs: SYSTEM_MESSAGE_BUSY_RETRY_MS,
    systemMessageQueue,
    threadStateStore,
    timelineScreenshotQueue,
    buildReminderSystemTrigger,
    resolveWorkspaceRoot,
  });

  return {
    backstageTaskLifecycle,
    channelCommandRouter,
    runtimeTurnLifecycle,
    runtimeWatchdogLifecycle,
    systemMessageDispatcherState,
  };
}

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

  const infrastructure = createAppInfrastructure({
    config: typedConfig,
    handleReplyDeliveryFailure: typedHandleReplyDeliveryFailure,
  });
  const workflows = createRuntimeWorkflowServices({
    infrastructure,
    config: typedConfig,
    resolveDefaultTerminalUser: typedResolveDefaultTerminalUser,
    resolveReplyTargetForBinding: typedResolveReplyTargetForBinding,
    resolveWorkspaceRoot: typedResolveWorkspaceRoot,
    handlePreparedMessage: typedHandlePreparedMessage,
    sendTimelineScreenshot: typedSendTimelineScreenshot,
  });

  return {
    ...infrastructure,
    ...workflows,
  };
}
