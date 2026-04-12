import type { RuntimeEvent } from "../contracts/runtime-events";
import type { ReminderQueueEntry, SystemMessage } from "../contracts/queue-items";
import type {
  DeliveryFailurePayload,
  HandlePreparedMessageOptions,
  NormalizedIncomingMessage,
  PendingApprovalState,
  PreparedRuntimeMessage,
  ReplyTarget,
  RuntimeTurnSendResult,
  RuntimeTurnSendState,
  SendLocalFileRequest,
  SystemDispatchResult,
  ThreadBindingRef,
  TimelineScreenshotRequest,
  UnknownRecord,
} from "./runtime-types";

// Keep the app/runtime/store seam in one place so app.ts, the factory, and the
// three lifecycle classes do not silently drift into incompatible local *Like
// copies again.
export interface AppRuntimeConfig extends Record<string, unknown> {
  stateDir: string;
  workspaceId: string;
  workspaceRoot: string;
  sessionsFile: string;
  allowedUserIds?: unknown;
  codexAccessMode?: string;
  sharedBridgeHeartbeatFile?: string;
  startWithCheckin?: boolean;
  systemMessageDeadLetterFile?: string;
  systemMessageQueueFile?: string;
  reminderQueueFile?: string;
  timelineScreenshotQueueFile?: string;
  weixinCdnBaseUrl?: string;
  weixinDeliveryTrace?: boolean;
  weixinReplyMode?: string;
}

export interface ChannelAccount {
  accountId: string;
  baseUrl: string;
}

export interface RuntimeAdapterState {
  endpoint: string;
  models: unknown[];
}

export interface SessionBindingSnapshot extends Record<string, unknown> {
  accountId?: string;
  activeWorkspaceRoot?: string;
  bindingKey?: string;
  codexParamsByWorkspaceRoot?: Record<string, unknown>;
  senderId?: string;
  threadIdByWorkspaceRoot?: Record<string, string>;
  workspaceId?: string;
}

export interface SessionStoreLike {
  state?: {
    bindings?: Record<string, SessionBindingSnapshot>;
  };
  buildBindingKey(args: { workspaceId: string; accountId: string; senderId: string }): string;
  findBindingForThreadId(threadId: unknown): ThreadBindingRef | null;
  getActiveWorkspaceRoot(bindingKey: string): string;
  getApprovalCommandAllowlistForWorkspace(workspaceRoot: string): string[][];
  getBinding(bindingKey: string): { senderId?: string } | null;
  getCodexParamsForWorkspace(bindingKey: string, workspaceRoot?: string): { model?: string };
  getPendingApprovalForThread(threadId: string): PendingApprovalState | null;
  getThreadIdForWorkspace(bindingKey: string, workspaceRoot: string): string;
  listBindings(): SessionBindingSnapshot[];
  listPendingApprovals(): Array<{ threadId: string; approval: PendingApprovalState }>;
  rememberPendingApprovalForThread(
    threadId: unknown,
    approval: unknown,
    options?: { signature?: unknown; promptedAt?: unknown },
  ): unknown;
  rememberWorkspaceBootstrapForThread(bindingKey: string, workspaceRoot: string, threadId: string): void;
  clearApprovalPrompt?(threadId: unknown): void;
  clearPendingApprovalForThread?(threadId: unknown): void;
}

export interface ChannelAdapterLike {
  describe(): { id?: string } & Record<string, unknown>;
  getKnownContextTokens(): Record<string, string>;
  loadSyncBuffer(): string;
  login(): Promise<unknown>;
  normalizeIncomingMessage(message: unknown): unknown;
  printAccounts(): void;
  resolveAccount(): ChannelAccount;
  sendFile(payload: { userId: string; filePath: string; contextToken?: string }): Promise<unknown>;
  sendText(payload: {
    userId: string;
    text: string;
    contextToken?: string;
    preserveBlock?: boolean;
  }): Promise<unknown>;
  sendTyping(payload: {
    userId: string;
    status: number;
    contextToken?: string;
  }): Promise<unknown>;
}

export interface RuntimeAdapterLike {
  cancelTurn(args: { threadId: string; turnId: string }): Promise<unknown>;
  close(): Promise<void>;
  describe(): { id?: string } & Record<string, unknown>;
  getSessionStore(): SessionStoreLike;
  initialize(): Promise<RuntimeAdapterState>;
  onEvent(listener: (event: RuntimeEvent<UnknownRecord>) => void): unknown;
  refreshThreadInstructions(args: {
    bindingKey: string;
    threadId: string;
    workspaceRoot: string;
    model?: string;
    accessMode?: string;
  }): Promise<unknown>;
  respondApproval(args: { requestId: string; decision: "accept" | "decline" }): Promise<unknown>;
  resumeThread(args: { threadId: string }): Promise<unknown>;
  sendTextTurn(args: {
    bindingKey: string;
    workspaceRoot: string;
    text: string;
    model?: string;
    accessMode?: string;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeTurnSendState>;
}

export interface TimelineIntegrationLike {
  describe(): { id?: string } & Record<string, unknown>;
  runSubcommand(command: string, args: string[]): Promise<unknown>;
}

export interface ThreadStateSnapshot {
  lastError?: string;
  pendingApproval?: PendingApprovalState | null;
  status?: string;
  turnId?: string;
}

export interface ThreadStateStoreLike {
  applyRuntimeEvent(event: unknown): void;
  getThreadState(threadId: string): ThreadStateSnapshot | null;
  hydratePendingApproval(threadId: string, approval: PendingApprovalState): unknown;
  markTurnFailed(threadId: string, turnId: string, message?: string): unknown;
  resolveApproval(threadId: string, status?: string): unknown;
  snapshot(): unknown;
}

export interface ReminderQueueLike {
  enqueue(reminder: ReminderQueueEntry): void;
  listDue(nowMs: number): ReminderQueueEntry[];
  peekNextDueAtMs(): number;
}

export interface SystemMessageQueueLike {
  enqueue(message: Record<string, unknown>): void;
}

export interface TimelineScreenshotQueueLike {
  drainForAccount(accountId: string): Array<{
    id: string;
    senderId: string;
    outputFile: string;
    args: string[];
  }>;
  hasPendingForAccount?(accountId: string): boolean;
}

export interface SystemMessageDispatcherLike {
  buildPreparedMessage(message: SystemMessage, contextToken?: string): NormalizedIncomingMessage | null;
  complete(message: SystemMessage): void;
  deadLetter(message: SystemMessage, options: { reason: string }): void;
  defer(
    message: SystemMessage,
    options: { delayMs: number; reason: string; countAttempt: boolean },
  ): { status: string } | null;
  hasPending(): boolean;
  takeReadyPending(nowMs?: number): SystemMessage[];
}

export interface ChannelCommandRouterLike {
  maybeDispatchCommand(normalized: NormalizedIncomingMessage): Promise<boolean>;
}

export interface RuntimeTurnLifecycleLike {
  handlePreparedMessage(
    normalized: NormalizedIncomingMessage,
    options: HandlePreparedMessageOptions,
  ): Promise<void | RuntimeTurnSendResult>;
  prepareIncomingMessageForRuntime(
    normalized: NormalizedIncomingMessage,
    workspaceRoot: string,
  ): Promise<PreparedRuntimeMessage | null>;
  sendLocalFileToCurrentChat(payload?: SendLocalFileRequest): Promise<unknown>;
  sendPreparedMessageToRuntime(args: {
    bindingKey: string;
    workspaceRoot: string;
    normalized: NormalizedIncomingMessage;
    prepared: PreparedRuntimeMessage;
  }): Promise<RuntimeTurnSendResult>;
  sendTimelineScreenshot(payload?: TimelineScreenshotRequest): Promise<unknown>;
  withUserTyping<T>(
    options: { userId: string; contextToken?: string; clearOnSuccess?: boolean },
    work: () => Promise<T>,
  ): Promise<T>;
}

export interface RuntimeWatchdogLifecycleLike {
  clearRuntimeEventWatchdog(threadId: unknown): void;
  clearTurnSettlementWatchdog(threadId: unknown, turnId: unknown): void;
  confirmPendingWorkspaceBootstrap(event: RuntimeEvent<UnknownRecord>): void;
  handleRuntimeEvent(event: RuntimeEvent<UnknownRecord>): Promise<void>;
  observeRuntimeEvent(event: RuntimeEvent<UnknownRecord>): void;
  queuePendingWorkspaceBootstrap(payload: {
    bindingKey: string;
    workspaceRoot: string;
    threadId: string;
  }): void;
  refreshTurnSettlementWatchdog(event: RuntimeEvent<UnknownRecord>): void;
  restoreBoundThreadSubscriptions(): Promise<void>;
  scheduleRuntimeEventWatchdog(payload: {
    bindingKey: string;
    workspaceRoot: string;
    normalized: PreparedRuntimeMessage;
    threadId?: string;
  }): void;
  sendApprovalPrompt(args: { bindingKey: string; approval: PendingApprovalState }): Promise<void>;
  sendFailureToThread(threadId: string, text: string): Promise<void>;
  stopTypingForThread(threadId: string): Promise<void>;
}

export interface BackstageTaskLifecycleLike {
  dispatchSystemMessage(message: SystemMessage): Promise<SystemDispatchResult>;
  flushDueReminders(account: { accountId: string }): Promise<void>;
  flushPendingSystemMessages(): Promise<void>;
  flushPendingTimelineScreenshots(account: { accountId: string }): Promise<void>;
}

export interface SystemMessageDispatcherRef {
  current: SystemMessageDispatcherLike | null;
}

export interface AppServices {
  backstageTaskLifecycle: BackstageTaskLifecycleLike;
  channelAdapter: ChannelAdapterLike;
  channelCommandRouter: ChannelCommandRouterLike;
  reminderQueue: ReminderQueueLike;
  runtimeAdapter: RuntimeAdapterLike;
  runtimeTurnLifecycle: RuntimeTurnLifecycleLike;
  runtimeWatchdogLifecycle: RuntimeWatchdogLifecycleLike;
  streamDelivery: StreamDeliveryLike;
  systemMessageDispatcherState: SystemMessageDispatcherRef;
  systemMessageQueue: SystemMessageQueueLike;
  threadStateStore: ThreadStateStoreLike;
  timelineIntegration: TimelineIntegrationLike;
  timelineScreenshotQueue: TimelineScreenshotQueueLike;
}

export interface StreamDeliveryLike {
  finalizeAbandonedTurn(args: {
    threadId: string;
    turnId?: string;
    trailingText?: string;
  }): Promise<unknown>;
  handleRuntimeEvent(event: RuntimeEvent<UnknownRecord>): Promise<void>;
  queueReplyTargetForThread(threadId: string, target: ReplyTarget): void;
  setReplyTarget(bindingKey: string, target: ReplyTarget): void;
}

export interface CreateAppServicesArgs {
  config: AppRuntimeConfig;
  handlePreparedMessage(
    normalized: NormalizedIncomingMessage,
    options: HandlePreparedMessageOptions,
  ): Promise<void | RuntimeTurnSendResult>;
  handleReplyDeliveryFailure(payload: DeliveryFailurePayload): Promise<void>;
  resolveDefaultTerminalUser(): string;
  resolveReplyTargetForBinding(bindingKey: string): ReplyTarget | null;
  resolveWorkspaceRoot(bindingKey: string): string;
  sendTimelineScreenshot(payload: TimelineScreenshotRequest): Promise<unknown>;
}

export type AppServiceFactory = (args: CreateAppServicesArgs) => AppServices;
