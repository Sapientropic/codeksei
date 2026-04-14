import type { RuntimeEvent } from "../contracts/runtime-events";
import type { ReminderQueueEntry, SystemMessage } from "../contracts/queue-items";
import type { AvailableModelCatalogView } from "../contracts/model-catalog";
import type {
  CodekseiChannel,
  CodekseiChannelProvider,
  CodekseiRuntimeAccessMode,
  CodekseiRuntimeProvider,
  WeixinReplyMode,
} from "./config-value-types";
import type { ReviewSemanticHost } from "./review-semantic-host-policy";
import type {
  ChannelAdapterOperations,
  HostCapabilities,
  RuntimeAdapterOperations,
} from "./host-profile-matrix";
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
export interface AppRuntimeConfig {
  stateDir: string;
  codekseiHome: string;
  workspaceId: string;
  workspaceRoot: string;
  timezone: string;
  timezoneSource: string;
  timezoneExplicit: boolean;
  timelineStateTimezone: string;
  diaryDir: string;
  timelineStateDir: string;
  userName: string;
  userGender: string;
  allowedUserIds: string[];
  channel: CodekseiChannel;
  channelProvider: CodekseiChannelProvider;
  runtime: CodekseiRuntimeProvider;
  accountId: string;
  weixinBaseUrl: string;
  weixinCdnBaseUrl: string;
  weixinAdapterVariant: string;
  weixinReplyMode: WeixinReplyMode;
  weixinDeliveryTrace: boolean;
  weixinQrBotType: string;
  weixinRouteTag: string;
  weixinProtocolClientVersion: string;
  accountsDir: string;
  logDir: string;
  reminderQueueFile: string;
  checkinConfigFile: string;
  checkinScheduleStateFile: string;
  systemMessageQueueFile: string;
  systemMessageDeadLetterFile: string;
  timelineScreenshotQueueFile: string;
  cliIdempotencyLedgerFile: string;
  weixinInstructionsFile: string;
  weixinInstructionsOverlayFile: string;
  weixinOperationsFile: string;
  weixinOperationsOverlayFile: string;
  syncBufferDir: string;
  runtimeEndpoint: string;
  runtimeCommand: string;
  runtimeAccessMode: CodekseiRuntimeAccessMode;
  codexAccessMode: CodekseiRuntimeAccessMode;
  hermesCommand: string;
  hermesHome: string;
  hermesRepoRoot: string;
  hermesRepoLocalShimPath: string;
  hermesPythonCommand: string;
  sessionsFile: string;
  workspaceBootstrapConfigFile: string;
  projectRadarConfigFile: string;
  durableNoteSchemaConfigFile: string;
  reviewSchemaConfigFile: string;
  reviewSemanticMode: string;
  reviewSemanticHost: ReviewSemanticHost;
  reviewSemanticModel: string;
  reviewSemanticTimeoutMs: number;
  sharedBridgeHeartbeatFile: string;
  sharedWatchdogStateFile: string;
  startWithCheckin: boolean;
}

export interface ChannelAccount {
  accountId: string;
  baseUrl: string;
}

export interface ChannelAdapterDescriptor {
  id: string;
  kind: "channel";
  provider: string;
  operations: ChannelAdapterOperations;
  variant?: string | undefined;
  stateDir?: string | undefined;
  baseUrl?: string | undefined;
  accountsDir?: string | undefined;
  syncBufferDir?: string | undefined;
  protocolClientVersion?: string | undefined;
  routeTag?: string | undefined;
  profile?: string | undefined;
  mode?: string | undefined;
  supported?: boolean | undefined;
  channel?: string | undefined;
  capabilities?: HostCapabilities;
}

export interface RuntimeAdapterDescriptor {
  id: string;
  kind: "runtime";
  provider: string;
  operations: RuntimeAdapterOperations;
  endpoint?: string | undefined;
  sessionsFile?: string | undefined;
  profile?: string | undefined;
  mode?: string | undefined;
  supported?: boolean | undefined;
  channelProvider?: string | undefined;
  capabilities?: HostCapabilities;
}

export interface RuntimeAdapterState {
  endpoint: string;
  models: unknown[];
}

export interface SessionBindingSnapshot extends Record<string, unknown> {
  accountId?: string;
  activeWorkspaceRoot?: string;
  bindingKey?: string;
  runtimeParamsByWorkspaceRoot?: Record<string, unknown>;
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
  getAvailableModelCatalog(): AvailableModelCatalogView | null;
  getBinding(bindingKey: string): { senderId?: string } | null;
  getRuntimeParamsForWorkspace(bindingKey: string, workspaceRoot?: string): { model?: string; effort?: string };
  getPendingApprovalForThread(threadId: string): PendingApprovalState | null;
  getThreadIdForWorkspace(bindingKey: string, workspaceRoot: string): string;
  listBindings(): SessionBindingSnapshot[];
  listPendingApprovals(): Array<{ threadId: string; approval: PendingApprovalState }>;
}

export interface SessionStoreWriterLike {
  clearApprovalPrompt?(threadId: unknown): Promise<void>;
  clearPendingApprovalForThread?(threadId: unknown): Promise<void>;
  rememberApprovalPrefixForWorkspace(workspaceRoot: string, commandTokens: string[]): Promise<string[][]>;
  rememberPendingApprovalForThread(
    threadId: unknown,
    approval: unknown,
    options?: { signature?: unknown; promptedAt?: unknown },
  ): Promise<unknown>;
  rememberWorkspaceBootstrapForThread(bindingKey: string, workspaceRoot: string, threadId: string): Promise<unknown>;
  setActiveWorkspaceRoot(bindingKey: string, workspaceRoot: string): Promise<unknown>;
  setAvailableModelCatalog?(models: unknown): Promise<unknown>;
  setRuntimeParamsForWorkspace(
    bindingKey: string,
    workspaceRoot: string,
    params: { model?: string; effort?: string },
  ): Promise<unknown>;
  setThreadIdForWorkspace(
    bindingKey: string,
    workspaceRoot: string,
    threadId: string,
    extra?: Record<string, unknown>,
  ): Promise<unknown>;
  clearThreadIdForWorkspace(bindingKey: string, workspaceRoot: string): Promise<unknown>;
}

export interface ChannelAdapterLike {
  describe(): ChannelAdapterDescriptor;
  getKnownContextTokens(): Record<string, string>;
  getUpdates(args?: {
    syncBuffer?: string;
    timeoutMs?: number;
  }): Promise<UnknownRecord & {
    ret?: unknown;
    errcode?: unknown;
    errmsg?: unknown;
    msgs?: unknown[];
  }>;
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
    trace?: Record<string, unknown> | null;
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
  describe(): RuntimeAdapterDescriptor;
  getSessionStore(): SessionStoreLike;
  initialize(): Promise<RuntimeAdapterState>;
  onEvent(listener: (event: RuntimeEvent<UnknownRecord>) => void): unknown;
  probeRuntimeCapabilities?(command: string): unknown;
  refreshThreadInstructions(args: {
    bindingKey: string;
    threadId: string;
    workspaceRoot: string;
    model?: string;
    effort?: string;
    accessMode?: string;
  }): Promise<unknown>;
  respondApproval(args: { requestId: string; decision: "accept" | "decline" }): Promise<unknown>;
  resumeThread(args: { threadId: string }): Promise<unknown>;
  sendTextTurn(args: {
    bindingKey: string;
    workspaceRoot: string;
    text: string;
    model?: string;
    effort?: string;
    accessMode?: string;
    metadata?: Record<string, unknown>;
  }): Promise<RuntimeTurnSendState>;
}

export interface TimelineIntegrationLike {
  describe(): { id?: string } & Record<string, unknown>;
  runSubcommand(command: string, args: string[]): Promise<unknown>;
}

export function supportsChannelOperation(
  channelAdapter: Pick<ChannelAdapterLike, "describe">,
  operation: keyof ChannelAdapterOperations,
): boolean {
  return Boolean(channelAdapter.describe().operations[operation]);
}

export function supportsRuntimeOperation(
  runtimeAdapter: Pick<RuntimeAdapterLike, "describe">,
  operation: keyof RuntimeAdapterOperations,
): boolean {
  return Boolean(runtimeAdapter.describe().operations[operation]);
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
  complete(message: SystemMessage, options?: { nowMs?: number }): {
    status: string;
    message?: SystemMessage | null;
  };
  deadLetter(message: SystemMessage, options?: { reason?: string; nowMs?: number }): {
    status: string;
    message?: SystemMessage | null;
  };
  defer(
    message: SystemMessage,
    options?: { delayMs?: number; reason?: string; countAttempt?: boolean; nowMs?: number },
  ): {
    status: string;
    message?: SystemMessage | null;
  } | null;
  hasPendingForAccount(accountId: string): boolean;
  takeReadyForAccount(accountId: string, options?: { nowMs?: number }): SystemMessage[];
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
  confirmPendingWorkspaceBootstrap(event: RuntimeEvent<UnknownRecord>): Promise<void>;
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
  sessionWriter: SessionStoreWriterLike;
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
