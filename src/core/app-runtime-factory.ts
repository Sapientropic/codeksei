// @ts-check

const FIRST_RUNTIME_EVENT_NOTICE_TIMEOUT_MS = 8_000;
const FIRST_RUNTIME_EVENT_FAILURE_TIMEOUT_MS = 45_000;
const SYSTEM_MESSAGE_BUSY_RETRY_MS = 30_000;
// Once a reply has already started streaming, the common failure mode is a
// long tool / search / browser phase with no assistant text for a while. Keep
// the watchdog conservative so we do not prematurely cut off healthy turns.
const STREAM_SETTLEMENT_TIMEOUT_MS = 5 * 60_000;

function createAppServices({
  config,
  resolveDefaultTerminalUser,
  resolveReplyTargetForBinding,
  resolveWorkspaceRoot,
  handlePreparedMessage,
  sendTimelineScreenshot,
  handleReplyDeliveryFailure,
}: any) {
  const { createWeixinChannelAdapter } = require("../adapters/channel/weixin");
  const { ReminderQueueStore } = require("../state/reminder-queue-store");
  const { createCodexRuntimeAdapter } = require("../adapters/runtime/codex");
  const { createTimelineIntegration } = require("../integrations/timeline");
  const { ChannelCommandRouter } = require("./channel-command-router");
  const { createControlCommandHandlers } = require("./channel-command-control-handlers");
  const { createWorkspaceCommandHandlers } = require("./channel-command-workspace-handlers");
  const { StreamDelivery } = require("./stream-delivery");
  const { ThreadStateStore } = require("./thread-state-store");
  const { SystemMessageQueueStore } = require("../state/system-message-queue-store");
  const { TimelineScreenshotQueueStore } = require("../state/timeline-screenshot-queue-store");
  const { BackstageTaskLifecycle } = require("./backstage-task-lifecycle");
  const { RuntimeTurnLifecycle } = require("./runtime-turn-lifecycle");
  const { RuntimeWatchdogLifecycle } = require("./runtime-watchdog-lifecycle");
  const { persistIncomingWeixinAttachments } = require("../adapters/channel/weixin/media-receive");
  const {
    buildApprovalPromptSignature,
    buildApprovalPromptText,
    matchesBuiltInCommandPrefix,
    matchesCommandPrefix,
    normalizeCommandArgument,
    normalizeText,
  } = require("./approval-command-policy");
  const {
    buildCodexInboundText,
    buildReminderSystemTrigger,
    getSystemMessageFailureRetryDelayMs,
    hasRpcId,
    resolveTimelineScreenshotOutput,
  } = require("./app-runtime-helpers");
  const { formatErrorMessage } = require("./app-poll-loop");

  const channelAdapter = createWeixinChannelAdapter(config);
  const runtimeAdapter = createCodexRuntimeAdapter(config);
  const timelineIntegration = createTimelineIntegration(config);
  const threadStateStore = new ThreadStateStore();
  const systemMessageQueue = new SystemMessageQueueStore({
    filePath: config.systemMessageQueueFile,
    deadLetterFilePath: config.systemMessageDeadLetterFile,
  });
  const timelineScreenshotQueue = new TimelineScreenshotQueueStore({ filePath: config.timelineScreenshotQueueFile });
  const reminderQueue = new ReminderQueueStore({ filePath: config.reminderQueueFile });
  const streamDelivery = new StreamDelivery({
    channelAdapter,
    sessionStore: runtimeAdapter.getSessionStore(),
    weixinReplyMode: config.weixinReplyMode,
    deliveryTraceEnabled: config.weixinDeliveryTrace,
    onDeliveryFailure: (payload: any) => handleReplyDeliveryFailure(payload),
  });
  const runtimeWatchdogLifecycle = new RuntimeWatchdogLifecycle({
    buildApprovalPromptSignature,
    buildApprovalPromptText,
    channelAdapter,
    matchesBuiltInCommandPrefix,
    matchesCommandPrefix,
    normalizeCommandArgument,
    normalizeText,
    resolveReplyTargetForBinding,
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
      config,
      resolveWorkspaceRoot,
      runtimeAdapter,
      scheduleRuntimeEventWatchdog: (payload: any) => runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog(payload),
      streamDelivery,
      threadStateStore,
    }),
    controlHandlers: createControlCommandHandlers({
      channelAdapter,
      resolveWorkspaceRoot,
      runtimeAdapter,
      threadStateStore,
    }),
  });
  const runtimeTurnLifecycle = new RuntimeTurnLifecycle({
    channelAdapter,
    config,
    formatErrorMessage,
    maybeDispatchCommand: (normalized: any) => channelCommandRouter.maybeDispatchCommand(normalized),
    normalizeText,
    persistIncomingWeixinAttachments,
    queuePendingWorkspaceBootstrap: (payload: any) => runtimeWatchdogLifecycle.queuePendingWorkspaceBootstrap(payload),
    resolveDefaultTerminalUser,
    resolveTimelineScreenshotOutput,
    resolveWorkspaceRoot,
    runtimeAdapter,
    scheduleRuntimeEventWatchdog: (payload: any) => runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog(payload),
    streamDelivery,
    timelineIntegration,
    buildCodexInboundText,
  });
  const backstageTaskLifecycle = new BackstageTaskLifecycle({
    channelAdapter,
    config,
    formatErrorMessage,
    getSystemMessageDispatcher: () => systemMessageDispatcherState.current,
    getSystemMessageFailureRetryDelayMs,
    handlePreparedMessage,
    hasRpcId,
    normalizeText,
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

  const systemMessageDispatcherState = { current: null };

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

module.exports = {
  createAppServices,
};

export {};
