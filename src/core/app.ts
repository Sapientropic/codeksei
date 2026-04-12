const { runSystemCheckinPoller } = require("../app/system-checkin-poller");
const { resolvePreferredSenderId } = require("./default-targets");
const { SystemMessageDispatcher } = require("./system-message-dispatcher");
const { normalizeText } = require("./approval-command-policy");
const {
  formatErrorMessage,
  resolveLongPollTimeoutMs: resolveAppLongPollTimeoutMs,
  runAppPollLoop,
} = require("./app-poll-loop");
const { createAppServices } = require("./app-runtime-factory");
const {
  createShutdownController,
} = require("./app-runtime-helpers");
const { writeSharedBridgeHeartbeat } = require("./shared-bridge-heartbeat");
const { handleReplyDeliveryFailure: processReplyDeliveryFailure } = require("./reply-delivery-failure");

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MIN_LONG_POLL_TIMEOUT_MS = 2_000;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;
class CyberbossApp {
  activeAccountId: any;
  backstageTaskLifecycle: any;
  channelAdapter: any;
  channelCommandRouter: any;
  config: any;
  reminderQueue: any;
  runtimeAdapter: any;
  runtimeEventChain: any;
  runtimeTurnLifecycle: any;
  runtimeWatchdogLifecycle: any;
  streamDelivery: any;
  systemMessageDispatcher: any;
  systemMessageDispatcherState: Record<string, any>;
  systemMessageQueue: any;
  threadStateStore: any;
  timelineIntegration: any;
  timelineScreenshotQueue: any;

  constructor(config: any) {
    this.config = config;
    this.activeAccountId = "";
    this.channelAdapter = null;
    this.runtimeAdapter = null;
    this.timelineIntegration = null;
    this.threadStateStore = null;
    this.systemMessageQueue = null;
    this.timelineScreenshotQueue = null;
    this.reminderQueue = null;
    this.systemMessageDispatcher = null;
    this.systemMessageDispatcherState = { current: null };
    this.streamDelivery = null;
    this.runtimeWatchdogLifecycle = null;
    this.channelCommandRouter = null;
    this.runtimeTurnLifecycle = null;
    this.backstageTaskLifecycle = null;
    Object.assign(this, createAppServices({
      config,
      resolveDefaultTerminalUser: () => this.resolveDefaultTerminalUser(),
      resolveReplyTargetForBinding: (bindingKey: any) => this.resolveReplyTargetForBinding(bindingKey),
      resolveWorkspaceRoot: (bindingKey: any) => this.resolveWorkspaceRoot(bindingKey),
      handlePreparedMessage: (...args: any[]) => this.runtimeTurnLifecycle.handlePreparedMessage(...args),
      sendTimelineScreenshot: (payload: any) => this.runtimeTurnLifecycle.sendTimelineScreenshot(payload),
      handleReplyDeliveryFailure: (payload: any) => this.handleReplyDeliveryFailure(payload),
    }));
    this.runtimeEventChain = Promise.resolve();
    const runtimeAdapter = this.runtimeAdapter;
    const runtimeWatchdogLifecycle = this.runtimeWatchdogLifecycle;
    const threadStateStore = this.threadStateStore;
    if (!runtimeAdapter || !runtimeWatchdogLifecycle || !threadStateStore) {
      throw new Error("app services failed to initialize");
    }
    runtimeAdapter.onEvent((event: any) => {
      runtimeWatchdogLifecycle.observeRuntimeEvent(event);
      threadStateStore.applyRuntimeEvent(event);
      this.runtimeEventChain = this.runtimeEventChain
        .catch(() => {})
        .then(() => runtimeWatchdogLifecycle.handleRuntimeEvent(event))
        .catch((error: any) => {
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

  updateBridgeHeartbeat(patch: any) {
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
    this.systemMessageDispatcherState.current = this.systemMessageDispatcher;
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
      void runSystemCheckinPoller(this.config).catch((error: any) => {
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
        flushDueReminders: (currentAccount: any) => this.flushDueReminders(currentAccount),
        flushPendingSystemMessages: () => this.flushPendingSystemMessages(),
        flushPendingTimelineScreenshots: (currentAccount: any) => this.flushPendingTimelineScreenshots(currentAccount),
        resolveLongPollTimeoutMs: () => this.resolveLongPollTimeoutMs(),
        handleIncomingMessage: (message: any) => this.handleIncomingMessage(message),
        updateBridgeHeartbeat: (patch: any) => this.updateBridgeHeartbeat(patch),
        retryDelayMs: RETRY_DELAY_MS,
        backoffDelayMs: BACKOFF_DELAY_MS,
        maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
      });
    } finally {
      shutdown.dispose();
      this.systemMessageDispatcherState.current = null;
      this.updateBridgeHeartbeat({
        pid: process.pid,
        status: "stopped",
        stoppedAt: new Date().toISOString(),
      });
      await this.runtimeAdapter.close();
    }
  }

  async sendTimelineScreenshot({ senderId = "", args = [], outputFile = "" }: any = {}) {
    return this.runtimeTurnLifecycle.sendTimelineScreenshot({ senderId, args, outputFile });
  }

  async sendLocalFileToCurrentChat({ senderId = "", filePath = "" }: any = {}) {
    return this.runtimeTurnLifecycle.sendLocalFileToCurrentChat({ senderId, filePath });
  }

  async handleIncomingMessage(message: any) {
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

  async handlePreparedMessage(normalized: any, {
    allowCommands,
    reportFailureToUser = true,
    throwOnFailure = false,
  }: any) {
    return this.runtimeTurnLifecycle.handlePreparedMessage(normalized, {
      allowCommands,
      reportFailureToUser,
      throwOnFailure,
    });
  }

  scheduleRuntimeEventWatchdog({ bindingKey, workspaceRoot, normalized, threadId = "" }: any) {
    this.runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog({
      bindingKey,
      workspaceRoot,
      normalized,
      threadId,
    });
  }

  clearRuntimeEventWatchdog(threadId: any) {
    this.runtimeWatchdogLifecycle.clearRuntimeEventWatchdog(threadId);
  }

  refreshTurnSettlementWatchdog(event: any) {
    this.runtimeWatchdogLifecycle.refreshTurnSettlementWatchdog(event);
  }

  clearTurnSettlementWatchdog(threadId: any, turnId: any) {
    this.runtimeWatchdogLifecycle.clearTurnSettlementWatchdog(threadId, turnId);
  }

  queuePendingWorkspaceBootstrap({ bindingKey, workspaceRoot, threadId }: any) {
    this.runtimeWatchdogLifecycle.queuePendingWorkspaceBootstrap({ bindingKey, workspaceRoot, threadId });
  }

  confirmPendingWorkspaceBootstrap(event: any) {
    this.runtimeWatchdogLifecycle.confirmPendingWorkspaceBootstrap(event);
  }

  async prepareIncomingMessageForRuntime(normalized: any, workspaceRoot: any) {
    return this.runtimeTurnLifecycle.prepareIncomingMessageForRuntime(normalized, workspaceRoot);
  }

  async flushPendingSystemMessages() {
    await this.backstageTaskLifecycle.flushPendingSystemMessages();
  }

  async flushPendingTimelineScreenshots(account: any) {
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

  async flushDueReminders(account: any) {
    await this.backstageTaskLifecycle.flushDueReminders(account);
  }

  async dispatchSystemMessage(message: any) {
    return this.backstageTaskLifecycle.dispatchSystemMessage(message);
  }

  async handleReplyDeliveryFailure({
    threadId,
    turnId = "",
    error,
    sentText = "",
  }: any) {
    await processReplyDeliveryFailure({
      threadId,
      turnId,
      error,
      sentText,
    }, {
      runtimeAdapter: this.runtimeAdapter,
      threadStateStore: this.threadStateStore,
      clearRuntimeEventWatchdog: (candidateThreadId: any) => this.clearRuntimeEventWatchdog(candidateThreadId),
      clearTurnSettlementWatchdog: (candidateThreadId: any, candidateTurnId: any) => {
        this.clearTurnSettlementWatchdog(candidateThreadId, candidateTurnId);
      },
      stopTypingForThread: (candidateThreadId: any) => this.stopTypingForThread(candidateThreadId),
    });
  }

  resolveWorkspaceRoot(bindingKey: any) {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    return sessionStore.getActiveWorkspaceRoot(bindingKey) || this.config.workspaceRoot;
  }

  async handleRuntimeEvent(event: any) {
    await this.runtimeWatchdogLifecycle.handleRuntimeEvent(event);
  }

  async stopTypingForThread(threadId: any) {
    await this.runtimeWatchdogLifecycle.stopTypingForThread(threadId);
  }

  async withUserTyping({
    userId,
    contextToken = "",
    clearOnSuccess = true,
  }: any, work: any) {
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
  }: any) {
    return this.runtimeTurnLifecycle.sendPreparedMessageToRuntime({
      bindingKey,
      workspaceRoot,
      normalized,
      prepared,
    });
  }

  async sendFailureToThread(threadId: any, text: any) {
    await this.runtimeWatchdogLifecycle.sendFailureToThread(threadId, text);
  }

  async sendApprovalPrompt({ bindingKey, approval }: any) {
    await this.runtimeWatchdogLifecycle.sendApprovalPrompt({ bindingKey, approval });
  }

  async restoreBoundThreadSubscriptions() {
    await this.runtimeWatchdogLifecycle.restoreBoundThreadSubscriptions();
  }

  resolveReplyTargetForBinding(bindingKey: any) {
    const binding = this.runtimeAdapter.getSessionStore().getBinding(bindingKey) || null;
    const userId = normalizeText(binding?.senderId);
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

module.exports = { CyberbossApp };

export {};
