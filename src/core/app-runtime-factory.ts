import { createWeixinChannelAdapter } from "../adapters/channel/weixin";
import { createCodexRuntimeAdapter } from "../adapters/runtime/codex";
import { createTimelineIntegration } from "../integrations/timeline";
import { BackstageTaskLifecycle } from "../runtime/backstage-task-lifecycle";
import { StreamDelivery } from "../runtime/stream-delivery";
import { ThreadStateStore } from "../runtime/thread-state-store";
import { RuntimeTurnLifecycle } from "../runtime/runtime-turn-lifecycle";
import { RuntimeWatchdogLifecycle } from "../runtime/runtime-watchdog-lifecycle";
import { ReminderQueueStore } from "../state/reminder-queue-store";
import { SystemMessageQueueStore } from "../state/system-message-queue-store";
import { persistIncomingWeixinAttachments } from "../adapters/channel/weixin/media-receive";
import type {
  AppRuntimeConfig,
  AppServices,
  ChannelCommandRouterLike,
  CreateAppServicesArgs,
  SystemMessageDispatcherRef,
} from "./app-service-contract";
import type {
  DeliveryFailurePayload,
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
  ReplyTarget,
} from "./runtime-types";
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
import {
  buildReminderSystemTrigger,
  buildRuntimeInboundText,
  getSystemMessageFailureRetryDelayMs,
  hasRpcId,
} from "./app-runtime-helpers";
import { formatErrorMessage } from "./app-poll-loop";
import { handleReplyDeliveryFailureDelegate } from "./app-runtime-delegates";
import {
  resolveAppDefaultTerminalUser,
  resolveAppWorkspaceRoot,
  resolveReplyTargetForBinding as resolveAppReplyTargetForBinding,
} from "./app-target-resolution";
import { createHostedChannelAdapter, createHostedRuntimeAdapter } from "./hosted-mode-adapters";
import { resolveHostMode } from "./host-mode";

const FIRST_RUNTIME_EVENT_NOTICE_TIMEOUT_MS = 8_000;
const FIRST_RUNTIME_EVENT_FAILURE_TIMEOUT_MS = 45_000;
const SYSTEM_MESSAGE_BUSY_RETRY_MS = 30_000;
// Once a reply has already started streaming, the common failure mode is a
// long tool / search / browser phase with no assistant text for a while. Keep
// the watchdog conservative so we do not prematurely cut off healthy turns.
const STREAM_SETTLEMENT_TIMEOUT_MS = 5 * 60_000;

type AppFactoryConfig = AppRuntimeConfig;
type ReplyFailureHandler = (payload: DeliveryFailurePayload) => Promise<void>;

interface ReplyFailureHandlerRef {
  current: ReplyFailureHandler;
}

interface AppInfrastructure {
  channelAdapter: AppServices["channelAdapter"];
  reminderQueue: AppServices["reminderQueue"];
  replyFailureHandlerRef: ReplyFailureHandlerRef;
  runtimeAdapter: AppServices["runtimeAdapter"];
  sessionWriter: AppServices["sessionWriter"];
  streamDelivery: AppServices["streamDelivery"];
  systemMessageQueue: AppServices["systemMessageQueue"];
  threadStateStore: AppServices["threadStateStore"];
  timelineIntegration: AppServices["timelineIntegration"];
}

function createAppInfrastructure({
  config,
}: {
  config: AppFactoryConfig;
}): AppInfrastructure {
  const hostMode = resolveHostMode(config);
  const channelAdapter = hostMode.mode === "codex"
    ? createWeixinChannelAdapter(config)
    : createHostedChannelAdapter(config);
  const runtimeAdapter = hostMode.mode === "codex"
    ? createCodexRuntimeAdapter(config)
    : createHostedRuntimeAdapter(config);
  const sessionWriter = runtimeAdapter.getSessionWriter();
  const timelineIntegration = createTimelineIntegration(config);
  const threadStateStore = new ThreadStateStore();
  const systemMessageQueue = new SystemMessageQueueStore({
    filePath: config.systemMessageQueueFile,
    deadLetterFilePath: config.systemMessageDeadLetterFile,
  });
  const reminderQueue = new ReminderQueueStore({ filePath: config.reminderQueueFile });
  const replyFailureHandlerRef: ReplyFailureHandlerRef = {
    current: async () => undefined,
  };
  const streamDelivery = new StreamDelivery({
    channelAdapter,
    sessionStore: runtimeAdapter.getSessionStore(),
    weixinReplyMode: config.weixinReplyMode,
    deliveryTraceEnabled: Boolean(config.weixinDeliveryTrace),
    onDeliveryFailure: (payload: DeliveryFailurePayload) => replyFailureHandlerRef.current(payload),
  });

  return {
    channelAdapter,
    reminderQueue,
    replyFailureHandlerRef,
    runtimeAdapter,
    sessionWriter,
    streamDelivery,
    systemMessageQueue,
    threadStateStore,
    timelineIntegration,
  };
}

function createRuntimeWorkflowServices({
  infrastructure,
  config,
}: {
  infrastructure: AppInfrastructure;
  config: AppFactoryConfig;
}): Pick<
  AppServices,
  "backstageTaskLifecycle" | "channelCommandRouter" | "runtimeTurnLifecycle" | "runtimeWatchdogLifecycle" | "systemMessageDispatcherState"
> {
  const {
    channelAdapter,
    reminderQueue,
    replyFailureHandlerRef,
    runtimeAdapter,
    sessionWriter,
    streamDelivery,
    systemMessageQueue,
    threadStateStore,
    timelineIntegration,
  } = infrastructure;

  const resolveDefaultTerminalUser = () => resolveAppDefaultTerminalUser({
    config,
    channelAdapter,
    runtimeAdapter,
  });
  const resolveReplyTargetForBinding = (bindingKey: string): ReplyTarget | null => resolveAppReplyTargetForBinding({
    bindingKey,
    channelAdapter,
    runtimeAdapter,
  });
  const resolveWorkspaceRoot = (bindingKey: string) => resolveAppWorkspaceRoot({
    bindingKey,
    config,
    runtimeAdapter,
  });

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
    resolveWorkspaceRoot,
    runtimeAdapter,
    scheduleRuntimeEventWatchdog: (payload: {
      bindingKey: string;
      workspaceRoot: string;
      normalized: PreparedRuntimeMessage;
      threadId?: string;
    }) => runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog(payload),
    streamDelivery,
    buildRuntimeInboundText: (normalized, persisted) => buildRuntimeInboundText(
      normalized,
      persisted,
      {
        timezone: config.timezone,
        userName: config.userName,
      },
    ),
  });

  replyFailureHandlerRef.current = (payload: DeliveryFailurePayload) => handleReplyDeliveryFailureDelegate({
    payload,
    runtimeAdapter,
    runtimeWatchdogLifecycle,
    sessionWriter,
    threadStateStore,
  });

  const systemMessageDispatcherState: SystemMessageDispatcherRef = { current: null };
  const backstageTaskLifecycle = new BackstageTaskLifecycle({
    channelAdapter,
    config,
    formatErrorMessage,
    getSystemMessageDispatcher: () => systemMessageDispatcherState.current,
    getSystemMessageFailureRetryDelayMs,
    handlePreparedMessage: (normalized, options) => runtimeTurnLifecycle.handlePreparedMessage(normalized, options),
    hasRpcId,
    normalizeText: normalizeTrimmedText,
    reminderQueue,
    runtimeAdapter,
    systemMessageBusyRetryMs: SYSTEM_MESSAGE_BUSY_RETRY_MS,
    systemMessageQueue,
    threadStateStore,
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
}: CreateAppServicesArgs): AppServices {
  const infrastructure = createAppInfrastructure({ config });
  const workflows = createRuntimeWorkflowServices({
    infrastructure,
    config,
  });

  return {
    ...infrastructure,
    ...workflows,
  };
}
