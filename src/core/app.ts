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
import { resolvePreferredSenderId } from "../workspace/default-targets";
import * as systemMessageDispatcherModule from "./system-message-dispatcher";
import { writeSharedBridgeHeartbeat } from "../shared/shared-bridge-heartbeat";
import { handleReplyDeliveryFailure as processReplyDeliveryFailure } from "./reply-delivery-failure";
import { normalizeTrimmedText } from "./approval-command-policy";
import { runCodekseiAppLifecycle } from "./app-lifecycle-runner";
import { attachRuntimeEventPipeline } from "./app-runtime-event-pipeline";
import {
  formatErrorMessage,
  resolveLongPollTimeoutMs as resolveAppLongPollTimeoutMs,
} from "./app-poll-loop";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MIN_LONG_POLL_TIMEOUT_MS = 2_000;
type AppConfig = AppRuntimeConfig;

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
  sessionWriter!: AppServices["sessionWriter"];
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
    attachRuntimeEventPipeline({
      runtimeAdapter,
      runtimeWatchdogLifecycle,
      threadStateStore,
      getRuntimeEventChain: () => this.runtimeEventChain,
      setRuntimeEventChain: (chain) => {
        this.runtimeEventChain = chain;
      },
      logRuntimeEventFailure: (event, error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        console.error(`[codeksei] runtime event handling failed type=${event?.type || "(unknown)"} ${message}`);
      },
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
    const filePath = normalizeTrimmedText(this.config.sharedBridgeHeartbeatFile);
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
    await runCodekseiAppLifecycle({
      config: this.config,
      channelAdapter: this.channelAdapter,
      runtimeAdapter: this.runtimeAdapter,
      timelineIntegration: this.timelineIntegration,
      systemMessageQueue: this.systemMessageQueue,
      setActiveAccountId: (accountId: string) => {
        this.activeAccountId = accountId;
      },
      setSystemMessageDispatcher: (dispatcher) => {
        this.systemMessageDispatcher = dispatcher;
        this.systemMessageDispatcherState.current = dispatcher;
      },
      updateBridgeHeartbeat: (patch: Record<string, unknown>) => this.updateBridgeHeartbeat(patch),
      restoreBoundThreadSubscriptions: () => this.restoreBoundThreadSubscriptions(),
      resolveLongPollTimeoutMs: () => this.resolveLongPollTimeoutMs(),
      handleIncomingMessage: (message: unknown) => this.handleIncomingMessage(message),
      flushDueReminders: (currentAccount: { accountId: string }) => this.flushDueReminders(currentAccount),
      flushPendingSystemMessages: () => this.flushPendingSystemMessages(),
      flushPendingTimelineScreenshots: (currentAccount: { accountId: string }) => this.flushPendingTimelineScreenshots(currentAccount),
    });
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
    const sessionStore = (this.runtimeAdapter.getSessionStore()
      ?? null) as Exclude<Parameters<typeof resolvePreferredSenderId>[0]["sessionStore"], undefined>;
    return resolvePreferredSenderId({
      config: this.config,
      accountId: this.channelAdapter.resolveAccount().accountId,
      sessionStore,
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
    void this.runtimeWatchdogLifecycle.confirmPendingWorkspaceBootstrap(event);
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
      sessionWriter: this.sessionWriter,
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
    const userId = normalizeTrimmedText(binding?.senderId);
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
