import { createAppServices } from "./app-runtime-factory";
import type {
  AppRuntimeConfig,
  AppServiceFactory,
  AppServices,
  BackstageTaskLifecycleLike,
  ChannelAdapterLike,
  ChannelCommandRouterLike,
  ReminderQueueLike,
  RuntimeAdapterLike,
  RuntimeTurnLifecycleLike,
  RuntimeWatchdogLifecycleLike,
  SessionStoreLike,
  SystemMessageDispatcherLike,
  SystemMessageDispatcherRef,
  SystemMessageQueueLike,
  ThreadStateStoreLike,
  TimelineIntegrationLike,
  TimelineScreenshotQueueLike,
} from "./app-service-contract";
import type {
  DeliveryFailurePayload,
  HandlePreparedMessageOptions,
  NormalizedIncomingMessage,
  PendingApprovalState,
  PreparedRuntimeMessage,
  ReplyTarget,
  RuntimeTurnSendState,
  RuntimeTurnSendResult,
  SendLocalFileRequest,
  SystemDispatchResult,
  TimelineScreenshotRequest,
  UnknownRecord,
} from "./runtime-types";
import type { RuntimeEvent } from "../contracts/runtime-events";
import type { SystemMessage } from "../contracts/queue-items";
import * as systemCheckinPollerModule from "../app/system-checkin-poller";
import * as defaultTargetsModule from "../workspace/default-targets";
import * as systemMessageDispatcherModule from "./system-message-dispatcher";
import * as sharedBridgeHeartbeatModule from "../shared/shared-bridge-heartbeat";
import * as replyDeliveryFailureModule from "./reply-delivery-failure";
import { normalizeText } from "./approval-command-policy";
import {
  formatErrorMessage,
  resolveLongPollTimeoutMs as resolveAppLongPollTimeoutMs,
  runAppPollLoop,
} from "./app-poll-loop";
import { createShutdownController } from "./app-runtime-helpers";

const { runSystemCheckinPoller } = systemCheckinPollerModule as {
  runSystemCheckinPoller: (config: AppConfig) => Promise<unknown>;
};
const { resolvePreferredSenderId } = defaultTargetsModule as {
  resolvePreferredSenderId: (args: {
    config: AppConfig;
    accountId: string;
    sessionStore: SessionStoreLike;
  }) => string;
};
const { SystemMessageDispatcher } = systemMessageDispatcherModule as {
  SystemMessageDispatcher: new (args: {
    queueStore: SystemMessageQueueLike;
    config: AppConfig;
    accountId: string;
  }) => SystemMessageDispatcherLike;
};
const { writeSharedBridgeHeartbeat } = sharedBridgeHeartbeatModule as {
  writeSharedBridgeHeartbeat: (filePath: string, patch: Record<string, unknown>) => void;
};
const { handleReplyDeliveryFailure: processReplyDeliveryFailure } = replyDeliveryFailureModule as {
  handleReplyDeliveryFailure: (
    payload: DeliveryFailurePayload,
    context: {
      runtimeAdapter: RuntimeAdapterLike;
      threadStateStore: ThreadStateStoreLike;
      clearRuntimeEventWatchdog: (threadId: string) => void;
      clearTurnSettlementWatchdog: (threadId: string, turnId: string) => void;
      stopTypingForThread: (threadId: string) => Promise<void>;
    },
  ) => Promise<void>;
};

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MIN_LONG_POLL_TIMEOUT_MS = 2_000;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;

type AppConfig = AppRuntimeConfig;

interface ShutdownController {
  dispose(): void;
}

interface CodekseiAppOptions {
  createAppServices?: AppServiceFactory;
}

export class CodekseiApp {
  activeAccountId: string;
  backstageTaskLifecycle!: BackstageTaskLifecycleLike;
  channelAdapter!: ChannelAdapterLike;
  channelCommandRouter!: ChannelCommandRouterLike;
  readonly config: AppConfig;
  reminderQueue!: ReminderQueueLike;
  runtimeAdapter!: RuntimeAdapterLike;
  runtimeEventChain: Promise<void>;
  runtimeTurnLifecycle!: RuntimeTurnLifecycleLike;
  runtimeWatchdogLifecycle!: RuntimeWatchdogLifecycleLike;
  streamDelivery!: AppServices["streamDelivery"];
  systemMessageDispatcher: SystemMessageDispatcherLike | null;
  systemMessageDispatcherState: SystemMessageDispatcherRef;
  systemMessageQueue!: SystemMessageQueueLike;
  threadStateStore!: ThreadStateStoreLike;
  timelineIntegration!: TimelineIntegrationLike;
  timelineScreenshotQueue!: TimelineScreenshotQueueLike;

  constructor(config: AppConfig, { createAppServices: createAppServicesOverride = createAppServices }: CodekseiAppOptions = {}) {
    this.config = config;
    this.activeAccountId = "";
    this.systemMessageDispatcher = null;
    this.systemMessageDispatcherState = { current: null };
    const services = createAppServicesOverride({
      config,
      resolveDefaultTerminalUser: () => this.resolveDefaultTerminalUser(),
      resolveReplyTargetForBinding: (bindingKey: string) => this.resolveReplyTargetForBinding(bindingKey),
      resolveWorkspaceRoot: (bindingKey: string) => this.resolveWorkspaceRoot(bindingKey),
      handlePreparedMessage: (
        normalized: NormalizedIncomingMessage,
        options: HandlePreparedMessageOptions,
      ) => this.runtimeTurnLifecycle.handlePreparedMessage(normalized, options),
      sendTimelineScreenshot: (payload: TimelineScreenshotRequest) => this.runtimeTurnLifecycle.sendTimelineScreenshot(payload),
      handleReplyDeliveryFailure: (payload: DeliveryFailurePayload) => this.handleReplyDeliveryFailure(payload),
    });
    Object.assign(this, services);
    this.runtimeEventChain = Promise.resolve();
    const runtimeAdapter = this.runtimeAdapter;
    const runtimeWatchdogLifecycle = this.runtimeWatchdogLifecycle;
    const threadStateStore = this.threadStateStore;
    if (!runtimeAdapter || !runtimeWatchdogLifecycle || !threadStateStore) {
      throw new Error("app services failed to initialize");
    }
    runtimeAdapter.onEvent((event) => {
      runtimeWatchdogLifecycle.observeRuntimeEvent(event);
      threadStateStore.applyRuntimeEvent(event);
      this.runtimeEventChain = this.runtimeEventChain
        .catch(() => {})
        .then(() => runtimeWatchdogLifecycle.handleRuntimeEvent(event))
        .catch((error) => {
          const message = error instanceof Error ? error.stack || error.message : String(error);
          console.error(`[codeksei] runtime event handling failed type=${event?.type || "(unknown)"} ${message}`);
        });
    });
  }

  printDoctor(): void {
    console.log(JSON.stringify({
      stateDir: this.config.stateDir,
      channel: this.channelAdapter.describe(),
      runtime: this.runtimeAdapter.describe(),
      timeline: this.timelineIntegration.describe(),
      threads: this.threadStateStore.snapshot(),
    }, null, 2));
  }

  async login(): Promise<void> {
    await this.channelAdapter.login();
  }

  printAccounts(): void {
    this.channelAdapter.printAccounts();
  }

  updateBridgeHeartbeat(patch: Record<string, unknown>): void {
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

  async start(): Promise<void> {
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
    console.log(`[codeksei] weixinReplyMode=${String(this.config.weixinReplyMode || "")}`);
    console.log(`[codeksei] weixinDeliveryTrace=${this.config.weixinDeliveryTrace ? "on" : "off"}`);
    console.log(`[codeksei] codexEndpoint=${runtimeState.endpoint}`);
    console.log(`[codeksei] codexModels=${runtimeState.models.length}`);
    console.log("[codeksei] 最小消息链路已启动，正在等待微信消息。");
    if (this.config.startWithCheckin) {
      console.log("[codeksei] checkin: enabled");
      void runSystemCheckinPoller(this.config).catch((error) => {
        console.error(`[codeksei] checkin poller stopped: ${error instanceof Error ? error.message : String(error)}`);
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
        flushDueReminders: (currentAccount: { accountId: string }) => this.flushDueReminders(currentAccount),
        flushPendingSystemMessages: () => this.flushPendingSystemMessages(),
        flushPendingTimelineScreenshots: (currentAccount: { accountId: string }) => this.flushPendingTimelineScreenshots(currentAccount),
        resolveLongPollTimeoutMs: () => this.resolveLongPollTimeoutMs(),
        handleIncomingMessage: (message: unknown) => this.handleIncomingMessage(message),
        updateBridgeHeartbeat: (patch: Record<string, unknown>) => this.updateBridgeHeartbeat(patch),
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

  async sendTimelineScreenshot({ senderId = "", args = [], outputFile = "" }: TimelineScreenshotRequest = {}) {
    return this.runtimeTurnLifecycle.sendTimelineScreenshot({ senderId, args, outputFile });
  }

  async sendLocalFileToCurrentChat({ senderId = "", filePath = "" }: SendLocalFileRequest = {}) {
    return this.runtimeTurnLifecycle.sendLocalFileToCurrentChat({ senderId, filePath });
  }

  async handleIncomingMessage(message: unknown): Promise<void> {
    const normalized = this.channelAdapter.normalizeIncomingMessage(message) as NormalizedIncomingMessage | null;
    if (!normalized) {
      return;
    }

    await this.handlePreparedMessage(normalized, { allowCommands: true });
  }

  resolveDefaultTerminalUser(): string {
    return resolvePreferredSenderId({
      config: this.config,
      accountId: this.channelAdapter.resolveAccount().accountId,
      sessionStore: this.runtimeAdapter.getSessionStore(),
    });
  }

  async handlePreparedMessage(
    normalized: NormalizedIncomingMessage,
    {
      allowCommands,
      reportFailureToUser = true,
      throwOnFailure = false,
    }: HandlePreparedMessageOptions,
  ) {
    return this.runtimeTurnLifecycle.handlePreparedMessage(normalized, {
      allowCommands,
      reportFailureToUser,
      throwOnFailure,
    });
  }

  scheduleRuntimeEventWatchdog({
    bindingKey,
    workspaceRoot,
    normalized,
    threadId = "",
  }: {
    bindingKey: string;
    workspaceRoot: string;
    normalized: PreparedRuntimeMessage;
    threadId?: string;
  }): void {
    this.runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog({
      bindingKey,
      workspaceRoot,
      normalized,
      threadId,
    });
  }

  clearRuntimeEventWatchdog(threadId: string): void {
    this.runtimeWatchdogLifecycle.clearRuntimeEventWatchdog(threadId);
  }

  refreshTurnSettlementWatchdog(event: RuntimeEvent<UnknownRecord>): void {
    this.runtimeWatchdogLifecycle.refreshTurnSettlementWatchdog(event);
  }

  clearTurnSettlementWatchdog(threadId: string, turnId: string): void {
    this.runtimeWatchdogLifecycle.clearTurnSettlementWatchdog(threadId, turnId);
  }

  queuePendingWorkspaceBootstrap({
    bindingKey,
    workspaceRoot,
    threadId,
  }: {
    bindingKey: string;
    workspaceRoot: string;
    threadId: string;
  }): void {
    this.runtimeWatchdogLifecycle.queuePendingWorkspaceBootstrap({ bindingKey, workspaceRoot, threadId });
  }

  confirmPendingWorkspaceBootstrap(event: RuntimeEvent<UnknownRecord>): void {
    this.runtimeWatchdogLifecycle.confirmPendingWorkspaceBootstrap(event);
  }

  async prepareIncomingMessageForRuntime(normalized: NormalizedIncomingMessage, workspaceRoot: string) {
    return this.runtimeTurnLifecycle.prepareIncomingMessageForRuntime(normalized, workspaceRoot);
  }

  async flushPendingSystemMessages(): Promise<void> {
    await this.backstageTaskLifecycle.flushPendingSystemMessages();
  }

  async flushPendingTimelineScreenshots(account: { accountId: string }): Promise<void> {
    await this.backstageTaskLifecycle.flushPendingTimelineScreenshots(account);
  }

  resolveLongPollTimeoutMs(): number {
    return resolveAppLongPollTimeoutMs({
      systemMessageDispatcher: this.systemMessageDispatcher,
      activeAccountId: this.activeAccountId,
      timelineScreenshotQueue: this.timelineScreenshotQueue,
      reminderQueue: this.reminderQueue,
      defaultLongPollTimeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS,
      minLongPollTimeoutMs: MIN_LONG_POLL_TIMEOUT_MS,
    });
  }

  async flushDueReminders(account: { accountId: string }): Promise<void> {
    await this.backstageTaskLifecycle.flushDueReminders(account);
  }

  async dispatchSystemMessage(message: SystemMessage): Promise<SystemDispatchResult> {
    return this.backstageTaskLifecycle.dispatchSystemMessage(message);
  }

  async handleReplyDeliveryFailure({
    threadId,
    turnId = "",
    error,
    sentText = "",
  }: DeliveryFailurePayload): Promise<void> {
    await processReplyDeliveryFailure({
      threadId,
      turnId,
      error,
      sentText,
    }, {
      runtimeAdapter: this.runtimeAdapter,
      threadStateStore: this.threadStateStore,
      clearRuntimeEventWatchdog: (candidateThreadId: string) => this.clearRuntimeEventWatchdog(candidateThreadId),
      clearTurnSettlementWatchdog: (candidateThreadId: string, candidateTurnId: string) => {
        this.clearTurnSettlementWatchdog(candidateThreadId, candidateTurnId);
      },
      stopTypingForThread: (candidateThreadId: string) => this.stopTypingForThread(candidateThreadId),
    });
  }

  resolveWorkspaceRoot(bindingKey: string): string {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    return sessionStore.getActiveWorkspaceRoot(bindingKey) || this.config.workspaceRoot;
  }

  async handleRuntimeEvent(event: RuntimeEvent<UnknownRecord>): Promise<void> {
    await this.runtimeWatchdogLifecycle.handleRuntimeEvent(event);
  }

  async stopTypingForThread(threadId: string): Promise<void> {
    await this.runtimeWatchdogLifecycle.stopTypingForThread(threadId);
  }

  async withUserTyping<T>(
    {
      userId,
      contextToken = "",
      clearOnSuccess = true,
    }: {
      userId: string;
      contextToken?: string;
      clearOnSuccess?: boolean;
    },
    work: () => Promise<T>,
  ): Promise<T> {
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
  }: {
    bindingKey: string;
    workspaceRoot: string;
    normalized: NormalizedIncomingMessage;
    prepared: PreparedRuntimeMessage;
  }): Promise<RuntimeTurnSendResult> {
    return this.runtimeTurnLifecycle.sendPreparedMessageToRuntime({
      bindingKey,
      workspaceRoot,
      normalized,
      prepared,
    });
  }

  async sendFailureToThread(threadId: string, text: string): Promise<void> {
    await this.runtimeWatchdogLifecycle.sendFailureToThread(threadId, text);
  }

  async sendApprovalPrompt({
    bindingKey,
    approval,
  }: {
    bindingKey: string;
    approval: PendingApprovalState;
  }): Promise<void> {
    await this.runtimeWatchdogLifecycle.sendApprovalPrompt({ bindingKey, approval });
  }

  async restoreBoundThreadSubscriptions(): Promise<void> {
    await this.runtimeWatchdogLifecycle.restoreBoundThreadSubscriptions();
  }

  resolveReplyTargetForBinding(bindingKey: string): ReplyTarget | null {
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
