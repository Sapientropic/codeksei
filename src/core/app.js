const { createWeixinChannelAdapter } = require("../adapters/channel/weixin");
const { persistIncomingWeixinAttachments } = require("../adapters/channel/weixin/media-receive");
const { createCodexRuntimeAdapter } = require("../adapters/runtime/codex");
const { createTimelineIntegration } = require("../integrations/timeline");
const { ChannelCommandRouter } = require("./channel-command-router");
const { createControlCommandHandlers } = require("./channel-command-control-handlers");
const { createWorkspaceCommandHandlers } = require("./channel-command-workspace-handlers");
const { resolvePreferredSenderId } = require("./default-targets");
const {
  resolveConfiguredPersonName,
  resolvePromptPersonEn,
} = require("./person-reference");
const { StreamDelivery } = require("./stream-delivery");
const { ThreadStateStore } = require("./thread-state-store");
const { SystemMessageQueueStore } = require("./system-message-queue-store");
const { SystemMessageDispatcher } = require("./system-message-dispatcher");
const { TimelineScreenshotQueueStore } = require("./timeline-screenshot-queue-store");
const { BackstageTaskLifecycle } = require("./backstage-task-lifecycle");
const { RuntimeTurnLifecycle } = require("./runtime-turn-lifecycle");
const { RuntimeWatchdogLifecycle } = require("./runtime-watchdog-lifecycle");
const { writeSharedBridgeHeartbeat } = require("./shared-bridge-heartbeat");
const { ReminderQueueStore } = require("../adapters/channel/weixin/reminder-queue-store");
const { runSystemCheckinPoller } = require("../app/system-checkin-poller");
const {
  LEGACY_TIMELINE_TIMEZONE,
  formatDateTimeInTimezone,
} = require("./timezone");
const {
  formatErrorMessage,
  resolveLongPollTimeoutMs: resolveAppLongPollTimeoutMs,
  runAppPollLoop,
} = require("./app-poll-loop");
const {
  buildApprovalPromptSignature,
  buildApprovalPromptText,
  matchesBuiltInCommandPrefix,
  matchesCommandPrefix,
  normalizeCommandArgument,
  normalizeText,
} = require("./approval-command-policy");
const { handleReplyDeliveryFailure: processReplyDeliveryFailure } = require("./reply-delivery-failure");

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MIN_LONG_POLL_TIMEOUT_MS = 2_000;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const FIRST_RUNTIME_EVENT_NOTICE_TIMEOUT_MS = 8_000;
const FIRST_RUNTIME_EVENT_FAILURE_TIMEOUT_MS = 45_000;
const SYSTEM_MESSAGE_BUSY_RETRY_MS = 30_000;
const SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 5 * 60_000];
// Once a reply has already started streaming, the common failure mode is a
// long tool / search / browser phase with no assistant text for a while. Keep
// the watchdog conservative so we do not prematurely cut off healthy turns.
const STREAM_SETTLEMENT_TIMEOUT_MS = 5 * 60_000;

class CyberbossApp {
  constructor(config) {
    this.config = config;
    this.channelAdapter = createWeixinChannelAdapter(config);
    this.runtimeAdapter = createCodexRuntimeAdapter(config);
    this.timelineIntegration = createTimelineIntegration(config);
    this.threadStateStore = new ThreadStateStore();
    this.systemMessageQueue = new SystemMessageQueueStore({
      filePath: config.systemMessageQueueFile,
      deadLetterFilePath: config.systemMessageDeadLetterFile,
    });
    this.timelineScreenshotQueue = new TimelineScreenshotQueueStore({ filePath: config.timelineScreenshotQueueFile });
    this.reminderQueue = new ReminderQueueStore({ filePath: config.reminderQueueFile });
    this.systemMessageDispatcher = null;
    this.streamDelivery = new StreamDelivery({
      channelAdapter: this.channelAdapter,
      sessionStore: this.runtimeAdapter.getSessionStore(),
      weixinReplyMode: config.weixinReplyMode,
      deliveryTraceEnabled: config.weixinDeliveryTrace,
      onDeliveryFailure: (payload) => this.handleReplyDeliveryFailure(payload),
    });
    // app.js keeps the top-level wiring and command routing, while the
    // stateful runtime / backstage lifecycles live in dedicated modules. This
    // avoids repeating the same typing, watchdog, and retry semantics in both
    // the constructor setup and the tail of this file.
    this.runtimeWatchdogLifecycle = new RuntimeWatchdogLifecycle({
      buildApprovalPromptSignature,
      buildApprovalPromptText,
      channelAdapter: this.channelAdapter,
      matchesBuiltInCommandPrefix,
      matchesCommandPrefix,
      normalizeCommandArgument,
      normalizeText,
      resolveReplyTargetForBinding: (bindingKey) => this.resolveReplyTargetForBinding(bindingKey),
      runtimeAdapter: this.runtimeAdapter,
      streamDelivery: this.streamDelivery,
      streamSettlementTimeoutMs: STREAM_SETTLEMENT_TIMEOUT_MS,
      threadStateStore: this.threadStateStore,
      firstRuntimeEventFailureTimeoutMs: FIRST_RUNTIME_EVENT_FAILURE_TIMEOUT_MS,
      firstRuntimeEventNoticeTimeoutMs: FIRST_RUNTIME_EVENT_NOTICE_TIMEOUT_MS,
    });
    this.channelCommandRouter = new ChannelCommandRouter({
      workspaceHandlers: createWorkspaceCommandHandlers({
        channelAdapter: this.channelAdapter,
        config: this.config,
        resolveWorkspaceRoot: (bindingKey) => this.resolveWorkspaceRoot(bindingKey),
        runtimeAdapter: this.runtimeAdapter,
        scheduleRuntimeEventWatchdog: (payload) => this.runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog(payload),
        streamDelivery: this.streamDelivery,
        threadStateStore: this.threadStateStore,
      }),
      controlHandlers: createControlCommandHandlers({
        channelAdapter: this.channelAdapter,
        resolveWorkspaceRoot: (bindingKey) => this.resolveWorkspaceRoot(bindingKey),
        runtimeAdapter: this.runtimeAdapter,
        threadStateStore: this.threadStateStore,
      }),
    });
    this.runtimeTurnLifecycle = new RuntimeTurnLifecycle({
      channelAdapter: this.channelAdapter,
      config: this.config,
      formatErrorMessage,
      maybeDispatchCommand: (normalized) => this.channelCommandRouter.maybeDispatchCommand(normalized),
      normalizeText,
      persistIncomingWeixinAttachments,
      queuePendingWorkspaceBootstrap: (payload) => this.runtimeWatchdogLifecycle.queuePendingWorkspaceBootstrap(payload),
      resolveDefaultTerminalUser: () => this.resolveDefaultTerminalUser(),
      resolveTimelineScreenshotOutput,
      resolveWorkspaceRoot: (bindingKey) => this.resolveWorkspaceRoot(bindingKey),
      runtimeAdapter: this.runtimeAdapter,
      scheduleRuntimeEventWatchdog: (payload) => this.runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog(payload),
      streamDelivery: this.streamDelivery,
      timelineIntegration: this.timelineIntegration,
      buildCodexInboundText,
    });
    this.backstageTaskLifecycle = new BackstageTaskLifecycle({
      channelAdapter: this.channelAdapter,
      config: this.config,
      formatErrorMessage,
      getSystemMessageDispatcher: () => this.systemMessageDispatcher,
      getSystemMessageFailureRetryDelayMs,
      handlePreparedMessage: (...args) => this.runtimeTurnLifecycle.handlePreparedMessage(...args),
      hasRpcId,
      normalizeText,
      reminderQueue: this.reminderQueue,
      runtimeAdapter: this.runtimeAdapter,
      sendTimelineScreenshot: (payload) => this.runtimeTurnLifecycle.sendTimelineScreenshot(payload),
      systemMessageBusyRetryMs: SYSTEM_MESSAGE_BUSY_RETRY_MS,
      systemMessageQueue: this.systemMessageQueue,
      threadStateStore: this.threadStateStore,
      timelineScreenshotQueue: this.timelineScreenshotQueue,
      buildReminderSystemTrigger,
      resolveWorkspaceRoot: (bindingKey) => this.resolveWorkspaceRoot(bindingKey),
    });
    this.runtimeEventChain = Promise.resolve();
    this.runtimeAdapter.onEvent((event) => {
      this.runtimeWatchdogLifecycle.observeRuntimeEvent(event);
      this.threadStateStore.applyRuntimeEvent(event);
      this.runtimeEventChain = this.runtimeEventChain
        .catch(() => {})
        .then(() => this.runtimeWatchdogLifecycle.handleRuntimeEvent(event))
        .catch((error) => {
          const message = error instanceof Error ? error.stack || error.message : String(error);
          console.error(`[codeksei] runtime event handling failed type=${event?.type || "(unknown)"} ${message}`);
        });
    });
  }

  printDoctor() {
    console.log(JSON.stringify({
      stateDir: this.config.stateDir,
      channel: this.channelAdapter.describe(),
      runtime: this.runtimeAdapter.describe(),
      timeline: this.timelineIntegration.describe(),
      threads: this.threadStateStore.snapshot(),
    }, null, 2));
  }

  async login() {
    await this.channelAdapter.login();
  }

  printAccounts() {
    this.channelAdapter.printAccounts();
  }

  updateBridgeHeartbeat(patch) {
    const filePath = normalizeText(this.config.sharedBridgeHeartbeatFile);
    if (!filePath) {
      return;
    }
    try {
      writeSharedBridgeHeartbeat(filePath, patch);
    } catch (error) {
      console.error(`[codeksei] bridge heartbeat write failed: ${formatErrorMessage(error)}`);
    }
  }

  async start() {
    const account = this.channelAdapter.resolveAccount();
    this.activeAccountId = account.accountId;
    this.updateBridgeHeartbeat({
      pid: process.pid,
      status: "starting",
      accountId: account.accountId,
      workspaceRoot: this.config.workspaceRoot,
      startedAt: new Date().toISOString(),
      consecutiveFailures: 0,
      lastError: "",
    });
    this.systemMessageDispatcher = new SystemMessageDispatcher({
      queueStore: this.systemMessageQueue,
      config: this.config,
      accountId: account.accountId,
    });
    const runtimeState = await this.runtimeAdapter.initialize();
    const knownContextTokens = Object.keys(this.channelAdapter.getKnownContextTokens()).length;
    const syncBuffer = this.channelAdapter.loadSyncBuffer();
    await this.restoreBoundThreadSubscriptions();
    this.updateBridgeHeartbeat({
      pid: process.pid,
      status: "running",
      accountId: account.accountId,
      workspaceRoot: this.config.workspaceRoot,
      codexEndpoint: runtimeState.endpoint,
      consecutiveFailures: 0,
      lastError: "",
    });

    console.log("[codeksei] bootstrap ok");
    console.log(`[codeksei] channel=${this.channelAdapter.describe().id}`);
    console.log(`[codeksei] runtime=${this.runtimeAdapter.describe().id}`);
    console.log(`[codeksei] timeline=${this.timelineIntegration.describe().id}`);
    console.log(`[codeksei] account=${account.accountId}`);
    console.log(`[codeksei] baseUrl=${account.baseUrl}`);
    console.log(`[codeksei] workspaceRoot=${this.config.workspaceRoot}`);
    console.log(`[codeksei] knownContextTokens=${knownContextTokens}`);
    console.log(`[codeksei] syncBuffer=${syncBuffer ? "ready" : "empty"}`);
    console.log(`[codeksei] weixinReplyMode=${this.config.weixinReplyMode}`);
    console.log(`[codeksei] weixinDeliveryTrace=${this.config.weixinDeliveryTrace ? "on" : "off"}`);
    console.log(`[codeksei] codexEndpoint=${runtimeState.endpoint}`);
    console.log(`[codeksei] codexModels=${runtimeState.models.length}`);
    console.log("[codeksei] 最小消息链路已启动，正在等待微信消息。");
    if (this.config.startWithCheckin) {
      console.log("[codeksei] checkin: enabled");
      void runSystemCheckinPoller(this.config).catch((error) => {
        console.error(`[codeksei] checkin poller stopped: ${error.message}`);
      });
    }

    const shutdown = createShutdownController(async () => {
      await this.runtimeAdapter.close();
    });

    try {
      await runAppPollLoop({
        account,
        runtimeState: {
          endpoint: runtimeState.endpoint,
          workspaceRoot: this.config.workspaceRoot,
        },
        shutdown,
        channelAdapter: this.channelAdapter,
        flushDueReminders: (currentAccount) => this.flushDueReminders(currentAccount),
        flushPendingSystemMessages: () => this.flushPendingSystemMessages(),
        flushPendingTimelineScreenshots: (currentAccount) => this.flushPendingTimelineScreenshots(currentAccount),
        resolveLongPollTimeoutMs: () => this.resolveLongPollTimeoutMs(),
        handleIncomingMessage: (message) => this.handleIncomingMessage(message),
        updateBridgeHeartbeat: (patch) => this.updateBridgeHeartbeat(patch),
        retryDelayMs: RETRY_DELAY_MS,
        backoffDelayMs: BACKOFF_DELAY_MS,
        maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
      });
    } finally {
      shutdown.dispose();
      this.updateBridgeHeartbeat({
        pid: process.pid,
        status: "stopped",
        stoppedAt: new Date().toISOString(),
      });
      await this.runtimeAdapter.close();
    }
  }

  async sendTimelineScreenshot({ senderId = "", args = [], outputFile = "" } = {}) {
    return this.runtimeTurnLifecycle.sendTimelineScreenshot({ senderId, args, outputFile });
  }

  async sendLocalFileToCurrentChat({ senderId = "", filePath = "" } = {}) {
    return this.runtimeTurnLifecycle.sendLocalFileToCurrentChat({ senderId, filePath });
  }

  async handleIncomingMessage(message) {
    const normalized = this.channelAdapter.normalizeIncomingMessage(message);
    if (!normalized) {
      return;
    }

    await this.handlePreparedMessage(normalized, { allowCommands: true });
  }

  resolveDefaultTerminalUser() {
    return resolvePreferredSenderId({
      config: this.config,
      accountId: this.channelAdapter.resolveAccount().accountId,
      sessionStore: this.runtimeAdapter.getSessionStore(),
    });
  }

  async handlePreparedMessage(normalized, {
    allowCommands,
    reportFailureToUser = true,
    throwOnFailure = false,
  }) {
    return this.runtimeTurnLifecycle.handlePreparedMessage(normalized, {
      allowCommands,
      reportFailureToUser,
      throwOnFailure,
    });
  }

  scheduleRuntimeEventWatchdog({ bindingKey, workspaceRoot, normalized, threadId = "" }) {
    this.runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog({
      bindingKey,
      workspaceRoot,
      normalized,
      threadId,
    });
  }

  clearRuntimeEventWatchdog(threadId) {
    this.runtimeWatchdogLifecycle.clearRuntimeEventWatchdog(threadId);
  }

  refreshTurnSettlementWatchdog(event) {
    this.runtimeWatchdogLifecycle.refreshTurnSettlementWatchdog(event);
  }

  clearTurnSettlementWatchdog(threadId, turnId) {
    this.runtimeWatchdogLifecycle.clearTurnSettlementWatchdog(threadId, turnId);
  }

  queuePendingWorkspaceBootstrap({ bindingKey, workspaceRoot, threadId }) {
    this.runtimeWatchdogLifecycle.queuePendingWorkspaceBootstrap({ bindingKey, workspaceRoot, threadId });
  }

  confirmPendingWorkspaceBootstrap(event) {
    this.runtimeWatchdogLifecycle.confirmPendingWorkspaceBootstrap(event);
  }

  async prepareIncomingMessageForRuntime(normalized, workspaceRoot) {
    return this.runtimeTurnLifecycle.prepareIncomingMessageForRuntime(normalized, workspaceRoot);
  }

  async flushPendingSystemMessages() {
    await this.backstageTaskLifecycle.flushPendingSystemMessages();
  }

  async flushPendingTimelineScreenshots(account) {
    await this.backstageTaskLifecycle.flushPendingTimelineScreenshots(account);
  }

  resolveLongPollTimeoutMs() {
    return resolveAppLongPollTimeoutMs({
      systemMessageDispatcher: this.systemMessageDispatcher,
      activeAccountId: this.activeAccountId,
      timelineScreenshotQueue: this.timelineScreenshotQueue,
      reminderQueue: this.reminderQueue,
      defaultLongPollTimeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS,
      minLongPollTimeoutMs: MIN_LONG_POLL_TIMEOUT_MS,
    });
  }

  async flushDueReminders(account) {
    await this.backstageTaskLifecycle.flushDueReminders(account);
  }

  async dispatchSystemMessage(message) {
    return this.backstageTaskLifecycle.dispatchSystemMessage(message);
  }

  async handleReplyDeliveryFailure({
    threadId,
    turnId = "",
    error,
    sentText = "",
  }) {
    await processReplyDeliveryFailure({
      threadId,
      turnId,
      error,
      sentText,
    }, {
      runtimeAdapter: this.runtimeAdapter,
      threadStateStore: this.threadStateStore,
      clearRuntimeEventWatchdog: (candidateThreadId) => this.clearRuntimeEventWatchdog(candidateThreadId),
      clearTurnSettlementWatchdog: (candidateThreadId, candidateTurnId) => {
        this.clearTurnSettlementWatchdog(candidateThreadId, candidateTurnId);
      },
      stopTypingForThread: (candidateThreadId) => this.stopTypingForThread(candidateThreadId),
    });
  }

  resolveWorkspaceRoot(bindingKey) {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    return sessionStore.getActiveWorkspaceRoot(bindingKey) || this.config.workspaceRoot;
  }

  async handleRuntimeEvent(event) {
    await this.runtimeWatchdogLifecycle.handleRuntimeEvent(event);
  }

  async stopTypingForThread(threadId) {
    await this.runtimeWatchdogLifecycle.stopTypingForThread(threadId);
  }

  async withUserTyping({
    userId,
    contextToken = "",
    clearOnSuccess = true,
  }, work) {
    return this.runtimeTurnLifecycle.withUserTyping({
      userId,
      contextToken,
      clearOnSuccess,
    }, work);
  }

  async sendPreparedMessageToRuntime({
    bindingKey,
    workspaceRoot,
    normalized,
    prepared,
  }) {
    return this.runtimeTurnLifecycle.sendPreparedMessageToRuntime({
      bindingKey,
      workspaceRoot,
      normalized,
      prepared,
    });
  }

  async sendFailureToThread(threadId, text) {
    await this.runtimeWatchdogLifecycle.sendFailureToThread(threadId, text);
  }

  async sendApprovalPrompt({ bindingKey, approval }) {
    await this.runtimeWatchdogLifecycle.sendApprovalPrompt({ bindingKey, approval });
  }

  async restoreBoundThreadSubscriptions() {
    await this.runtimeWatchdogLifecycle.restoreBoundThreadSubscriptions();
  }

  resolveReplyTargetForBinding(bindingKey) {
    const binding = this.runtimeAdapter.getSessionStore().getBinding(bindingKey) || null;
    const userId = normalizeCommandArgument(binding?.senderId);
    if (!userId) {
      return null;
    }
    const contextToken = this.channelAdapter.getKnownContextTokens()[userId] || "";
    if (!contextToken) {
      return null;
    }
    return {
      userId,
      contextToken,
      provider: "weixin",
    };
  }
}

function createShutdownController(onStop) {
  let stopped = false;
  let stoppingPromise = null;

  const stop = async () => {
    if (stopped) {
      return stoppingPromise;
    }
    stopped = true;
    stoppingPromise = Promise.resolve().then(onStop);
    return stoppingPromise;
  };

  const handleSignal = () => {
    stop().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  return {
    get stopped() {
      return stopped;
    },
    dispose() {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    },
  };
}

function getSystemMessageFailureRetryDelayMs(attemptCount) {
  const index = Math.max(0, Math.min(SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS.length - 1, Number(attemptCount) - 1));
  return SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS[index];
}

module.exports = { CyberbossApp };

function buildReminderSystemTrigger(reminder, config = {}) {
  const reminderText = String(reminder?.text || "").trim();
  const person = resolvePromptPersonEn(config);
  return [
    "A scheduled reminder is due.",
    `Decide the most useful next move for ${person} right now.`,
    "If a message is best, send one short and natural WeChat message.",
    "Do not mention internal triggers.",
    "Do not mechanically repeat the reminder text.",
    `Reminder: ${reminderText}`,
  ].join("\n");
}

function buildCodexInboundText(normalized, persisted = {}, config = {}) {
  const text = String(normalized?.text || "").trim();
  const saved = Array.isArray(persisted?.saved) ? persisted.saved : [];
  const failed = Array.isArray(persisted?.failed) ? persisted.failed : [];
  const configuredName = resolveConfiguredPersonName(config);
  const person = resolvePromptPersonEn(config);
  const localTime = formatWechatLocalTime(normalized?.receivedAt, config.timezone);
  const lines = [];
  if (localTime) {
    lines.push(`[${localTime}]`);
  }
  if (text) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(text);
  }

  if (saved.length) {
    if (lines.length) {
      lines.push("");
    }
    if (configuredName) {
      lines.push(`${configuredName} sent image/file attachments. They were saved under the local data directory:`);
    } else {
      lines.push("The person in this thread sent image/file attachments. They were saved under the local data directory:");
    }
    for (const item of saved) {
      const suffix = item.sourceFileName ? ` (original name: ${item.sourceFileName})` : "";
      lines.push(`- [${item.kind}] ${item.absolutePath}${suffix}`);
    }
    lines.push(`You must read these files before replying to ${person}. Do not skip the read step.`);
    lines.push(`If the required local tool is missing, tell ${person} exactly what is missing and that you cannot read the file yet. Do not pretend you already read it.`);
  }

  if (failed.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push("Attachment intake errors:");
    for (const item of failed) {
      const label = item.sourceFileName || item.kind || "attachment";
      lines.push(`- ${label}: ${item.reason}`);
    }
  }

  return lines.join("\n").trim();
}

function formatWechatLocalTime(receivedAt, timezone = LEGACY_TIMELINE_TIMEZONE) {
  const value = typeof receivedAt === "string" ? receivedAt.trim() : "";
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return formatDateTimeInTimezone(parsed, timezone).replace("T", " ");
}

function stringifyRpcId(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function hasRpcId(value) {
  return stringifyRpcId(value) !== "";
}

function resolveTimelineScreenshotOutput(args) {
  const normalizedArgs = Array.isArray(args) ? args : [];
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    if (String(normalizedArgs[index] || "").trim() !== "--output") {
      continue;
    }
    return String(normalizedArgs[index + 1] || "").trim();
  }
  return "";
}
