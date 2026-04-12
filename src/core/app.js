const path = require("path");
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

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MIN_LONG_POLL_TIMEOUT_MS = 2_000;
const SESSION_EXPIRED_ERRCODE = -14;
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
      let consecutiveFailures = 0;
      while (!shutdown.stopped) {
        try {
          this.updateBridgeHeartbeat({
            pid: process.pid,
            status: "running",
            accountId: account.accountId,
            workspaceRoot: this.config.workspaceRoot,
            codexEndpoint: runtimeState.endpoint,
            lastPollStartedAt: new Date().toISOString(),
          });
          await this.flushDueReminders(account);
          await this.flushPendingSystemMessages();
          await this.flushPendingTimelineScreenshots(account);
          const response = await this.channelAdapter.getUpdates({
            syncBuffer: this.channelAdapter.loadSyncBuffer(),
            timeoutMs: this.resolveLongPollTimeoutMs(),
          });
          assertWeixinUpdateResponse(response);
          consecutiveFailures = 0;
          this.updateBridgeHeartbeat({
            pid: process.pid,
            status: "running",
            accountId: account.accountId,
            workspaceRoot: this.config.workspaceRoot,
            codexEndpoint: runtimeState.endpoint,
            lastPollSucceededAt: new Date().toISOString(),
            consecutiveFailures: 0,
            lastError: "",
          });
          const messages = Array.isArray(response?.msgs) ? response.msgs : [];
          for (const message of messages) {
            if (shutdown.stopped) {
              break;
            }
            await this.handleIncomingMessage(message);
          }
          await this.flushDueReminders(account);
          await this.flushPendingSystemMessages();
          await this.flushPendingTimelineScreenshots(account);
        } catch (error) {
          if (shutdown.stopped) {
            break;
          }

          if (isSessionExpiredError(error)) {
            throw new Error("微信会话已失效，请重新执行 `npm run login`");
          }

          consecutiveFailures += 1;
          const errorMessage = formatErrorMessage(error);
          this.updateBridgeHeartbeat({
            pid: process.pid,
            status: "degraded",
            accountId: account.accountId,
            workspaceRoot: this.config.workspaceRoot,
            codexEndpoint: runtimeState.endpoint,
            lastPollFailedAt: new Date().toISOString(),
            consecutiveFailures,
            lastError: errorMessage,
          });
          console.error(`[codeksei] poll failed: ${errorMessage}`);
          await sleep(consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS);
        }
      }
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
    if (this.systemMessageDispatcher?.hasPending()) {
      return MIN_LONG_POLL_TIMEOUT_MS;
    }
    if (this.activeAccountId && this.timelineScreenshotQueue.hasPendingForAccount(this.activeAccountId)) {
      return MIN_LONG_POLL_TIMEOUT_MS;
    }

    const nextDueAtMs = this.reminderQueue.peekNextDueAtMs();
    if (!nextDueAtMs) {
      return DEFAULT_LONG_POLL_TIMEOUT_MS;
    }

    const remainingMs = nextDueAtMs - Date.now();
    if (remainingMs <= MIN_LONG_POLL_TIMEOUT_MS) {
      return MIN_LONG_POLL_TIMEOUT_MS;
    }
    return Math.max(MIN_LONG_POLL_TIMEOUT_MS, Math.min(DEFAULT_LONG_POLL_TIMEOUT_MS, remainingMs));
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
    const normalizedThreadId = normalizeCommandArgument(threadId);
    const normalizedTurnId = normalizeCommandArgument(turnId);
    if (!normalizedThreadId) {
      return;
    }

    const messageText = error instanceof Error ? error.message : String(error || "unknown error");
    const deliveryFailureText = isPersistentWeixinSendFailure(error)
      ? "微信发送层连续失败（sendMessage ret=-2），本地已停止继续投递这轮回复。"
      : `回复投递失败：${messageText}`;
    const linked = this.runtimeAdapter.getSessionStore().findBindingForThreadId(normalizedThreadId);
    const workspaceRoot = normalizeText(linked?.workspaceRoot);

    console.error(
      `[codeksei] reply delivery degraded `
      + `thread=${normalizedThreadId} turn=${normalizedTurnId || "(pending)"} `
      + `workspace=${workspaceRoot || "(unknown)"} `
      + `sentChars=${String(sentText || "").length} `
      + `reason=${messageText}`
    );

    this.clearRuntimeEventWatchdog(normalizedThreadId);
    if (normalizedTurnId) {
      this.clearTurnSettlementWatchdog(normalizedThreadId, normalizedTurnId);
    }
    // Delivery failure is a local terminal state even if Codex later finishes
    // the turn, otherwise the bridge UI keeps showing a ghost "still replying".
    this.runtimeAdapter.getSessionStore().clearApprovalPrompt(normalizedThreadId);
    this.threadStateStore.markTurnFailed(normalizedThreadId, normalizedTurnId, deliveryFailureText);
    await this.stopTypingForThread(normalizedThreadId);
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

function assertWeixinUpdateResponse(response) {
  const ret = normalizeErrorCode(response?.ret);
  const errcode = normalizeErrorCode(response?.errcode);
  if ((ret !== 0 && ret !== null) || (errcode !== 0 && errcode !== null)) {
    const error = new Error(
      `weixin getUpdates ret=${ret ?? ""} errcode=${errcode ?? ""} errmsg=${normalizeText(response?.errmsg) || ""}`
    );
    error.ret = ret;
    error.errcode = errcode;
    throw error;
  }
}

function isSessionExpiredError(error) {
  const ret = normalizeErrorCode(error?.ret);
  const errcode = normalizeErrorCode(error?.errcode);
  return ret === SESSION_EXPIRED_ERRCODE
    || errcode === SESSION_EXPIRED_ERRCODE
    || String(error?.message || "").includes("session expired")
    || String(error?.message || "").includes("会话已失效");
}

function normalizeErrorCode(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error || "unknown error");
  if (isSessionExpiredError(error)) {
    return "微信会话已失效，请重新执行 `npm run login`";
  }
  return raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSystemMessageFailureRetryDelayMs(attemptCount) {
  const index = Math.max(0, Math.min(SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS.length - 1, Number(attemptCount) - 1));
  return SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS[index];
}

module.exports = { CyberbossApp };

function normalizeCommandArgument(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function matchesCommandPrefix(commandTokens, allowlist) {
  const normalizedCommandTokens = Array.isArray(commandTokens)
    ? commandTokens.map((part) => normalizeCommandArgument(part)).filter(Boolean)
    : [];
  if (!normalizedCommandTokens.length || !Array.isArray(allowlist) || !allowlist.length) {
    return false;
  }
  return allowlist.some((prefix) => {
    if (!Array.isArray(prefix) || !prefix.length || prefix.length > normalizedCommandTokens.length) {
      return false;
    }
    return prefix.every((part, index) => normalizeCommandArgument(part) === normalizedCommandTokens[index]);
  });
}

function matchesBuiltInCommandPrefix(commandTokens) {
  const normalized = normalizeCommandTokensForMatching(commandTokens);
  if (!normalized.length) {
    return false;
  }

  if (normalized[0] === "npm") {
    const runIndex = normalized.indexOf("run");
    if (runIndex >= 0) {
      const scriptName = normalizeCommandArgument(normalized[runIndex + 1]);
      return isBuiltInScriptName(scriptName);
    }
  }

  const executable = path.basename(normalized[0] || "");
  if ((executable === "sh" || executable === "bash" || executable === "zsh")
    && matchesBuiltInShellScript(normalized[1])) {
    return true;
  }
  if (executable === "node" || executable === "node.exe") {
    const binPath = normalizeCommandArgument(normalized[1]);
    if (binPath === "./bin/cyberboss.js"
      || binPath.endsWith("/bin/cyberboss.js")
      || binPath === "./bin/codeksei.js"
      || binPath.endsWith("/bin/codeksei.js")) {
      return matchesBuiltInCliCommand(normalized.slice(2));
    }
  }

  if (executable === "cyberboss"
    || executable === "cyberboss.js"
    || executable === "codeksei"
    || executable === "codeksei.js") {
    return matchesBuiltInCliCommand(normalized.slice(1));
  }

  return false;
}

function normalizeCommandTokensForMatching(commandTokens) {
  const normalized = Array.isArray(commandTokens)
    ? commandTokens.map((part) => normalizeCommandArgument(part)).filter(Boolean)
    : [];
  if (normalized.length >= 3 && isShellWrapper(normalized[0], normalized[1])) {
    return splitCommandLine(normalized.slice(2).join(" "));
  }
  return normalized;
}

function isShellWrapper(command, flag) {
  const executable = path.basename(normalizeCommandArgument(command));
  return (executable === "sh" || executable === "bash" || executable === "zsh") && flag === "-lc";
}

function isBuiltInScriptName(scriptName) {
  return scriptName === "reminder:write"
    || scriptName === "diary:write"
    || scriptName === "note:auto"
    || scriptName === "note:maybe"
    || scriptName === "note:sync"
    || scriptName === "project:radar"
    || scriptName === "review:nightly"
    || scriptName === "review:weekly"
    || scriptName === "review:monthly"
    || scriptName.startsWith("timeline:");
}

function matchesBuiltInShellScript(scriptPath) {
  const basename = path.basename(normalizeCommandArgument(scriptPath));
  return basename === "timeline-screenshot.sh";
}

function matchesBuiltInCliCommand(tokens) {
  if (!Array.isArray(tokens) || tokens.length < 2) {
    return false;
  }
  const topic = normalizeCommandArgument(tokens[0]);
  const action = normalizeCommandArgument(tokens[1]);
  if (topic === "timeline") {
    return action === "write"
      || action === "build"
      || action === "serve"
      || action === "dev"
      || action === "screenshot"
      || action === "read"
      || action === "categories"
      || action === "proposals";
  }
  if (topic === "project") {
    return action === "radar";
  }
  if (topic === "note") {
    return action === "sync";
  }
  return (topic === "reminder" && action === "write")
    || (topic === "diary" && action === "write")
    || false;
}

function splitCommandLine(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of String(input || "")) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function buildApprovalPromptText(approval) {
  const reasonText = normalizeText(approval?.reason);
  const commandText = normalizeText(approval?.command);
  const sections = ["Codex 请求授权"];

  if (reasonText && reasonText !== commandText) {
    sections.push(`操作说明：\n${reasonText}`);
  }

  if (commandText) {
    sections.push(`待执行命令：\n${commandText}`);
  } else if (!reasonText) {
    sections.push("(unknown)");
  }

  sections.push([
    "回复以下命令继续：",
    "/yes  本次允许",
    "/always  本项目后续同前缀自动允许",
    "/no  拒绝本次请求",
  ].join("\n"));

  return sections.join("\n\n");
}

function buildApprovalPromptSignature(approval) {
  const reasonText = normalizeText(approval?.reason);
  const commandText = normalizeText(approval?.command);
  const commandTokens = Array.isArray(approval?.commandTokens)
    ? approval.commandTokens.map((token) => normalizeCommandArgument(token)).filter(Boolean)
    : [];
  return JSON.stringify({
    reason: reasonText,
    command: commandText,
    commandTokens,
  });
}

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

function isPersistentWeixinSendFailure(error) {
  const message = String(error?.message || error || "");
  return message.includes("sendMessage ret=-2");
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
