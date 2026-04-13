import {
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
} from "../contracts/runtime-events";
import type {
  ChannelAdapterLike,
  RuntimeAdapterLike,
  StreamDeliveryLike,
  ThreadStateStoreLike,
} from "../core/app-service-contract";
import type {
  PendingApprovalState,
  PreparedRuntimeMessage,
  ReplyTarget,
  UnknownRecord,
} from "../core/runtime-types";
import {
  clearPendingApproval,
  handleApprovalRequested,
  restoreBoundThreadSubscriptions,
  sendApprovalPrompt,
  sendFailureToThread,
  stopTypingForThread,
  type RuntimeWatchdogApprovalDependencies,
} from "./runtime-watchdog-approval";
import {
  confirmPendingWorkspaceBootstrap,
  clearRuntimeEventWatchdog,
  clearTurnSettlementWatchdog,
  observeRuntimeEvent,
  queuePendingWorkspaceBootstrap,
  refreshTurnSettlementWatchdog,
  scheduleRuntimeEventWatchdog,
  type RuntimeEventWatchdogEntry,
  type RuntimeWatchdogTimerDependencies,
  type TurnSettlementWatchdogEntry,
  type WorkspaceBootstrapEntry,
} from "./runtime-watchdog-timers";

type BuildApprovalPromptSignature = (approval: PendingApprovalState) => string;
type BuildApprovalPromptText = (approval: PendingApprovalState) => string;
type MatchesBuiltInCommandPrefix = (commandTokens: unknown) => boolean;
type MatchesCommandPrefix = (commandTokens: unknown, allowlist: string[][]) => boolean;
type NormalizeCommandArgument = (value: unknown) => string;
type NormalizeText = (value: unknown) => string;
type ResolveReplyTargetForBinding = (bindingKey: string) => ReplyTarget | null;

interface RuntimeWatchdogLifecycleDependencies {
  buildApprovalPromptSignature: BuildApprovalPromptSignature;
  buildApprovalPromptText: BuildApprovalPromptText;
  channelAdapter: ChannelAdapterLike;
  matchesBuiltInCommandPrefix: MatchesBuiltInCommandPrefix;
  matchesCommandPrefix: MatchesCommandPrefix;
  normalizeCommandArgument: NormalizeCommandArgument;
  normalizeText: NormalizeText;
  resolveReplyTargetForBinding: ResolveReplyTargetForBinding;
  runtimeAdapter: RuntimeAdapterLike;
  streamDelivery: StreamDeliveryLike;
  streamSettlementTimeoutMs: number;
  threadStateStore: ThreadStateStoreLike;
  firstRuntimeEventFailureTimeoutMs: number;
  firstRuntimeEventNoticeTimeoutMs: number;
}

export class RuntimeWatchdogLifecycle {
  readonly approvalDependencies: RuntimeWatchdogApprovalDependencies;
  readonly buildApprovalPromptSignature: BuildApprovalPromptSignature;
  readonly buildApprovalPromptText: BuildApprovalPromptText;
  readonly channelAdapter: ChannelAdapterLike;
  readonly firstRuntimeEventFailureTimeoutMs: number;
  readonly firstRuntimeEventNoticeTimeoutMs: number;
  readonly matchesBuiltInCommandPrefix: MatchesBuiltInCommandPrefix;
  readonly matchesCommandPrefix: MatchesCommandPrefix;
  readonly normalizeCommandArgument: NormalizeCommandArgument;
  readonly normalizeText: NormalizeText;
  readonly pendingRuntimeEventWatchdogs: Map<string, RuntimeEventWatchdogEntry>;
  readonly pendingTurnSettlementWatchdogs: Map<string, TurnSettlementWatchdogEntry>;
  readonly pendingWorkspaceBootstrapByThreadId: Map<string, WorkspaceBootstrapEntry>;
  readonly resolveReplyTargetForBinding: ResolveReplyTargetForBinding;
  readonly runtimeAdapter: RuntimeAdapterLike;
  readonly streamDelivery: StreamDeliveryLike;
  readonly streamSettlementTimeoutMs: number;
  readonly threadStateStore: ThreadStateStoreLike;
  readonly timerDependencies: RuntimeWatchdogTimerDependencies;

  constructor({
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
    streamSettlementTimeoutMs,
    threadStateStore,
    firstRuntimeEventFailureTimeoutMs,
    firstRuntimeEventNoticeTimeoutMs,
  }: RuntimeWatchdogLifecycleDependencies) {
    this.buildApprovalPromptSignature = buildApprovalPromptSignature;
    this.buildApprovalPromptText = buildApprovalPromptText;
    this.channelAdapter = channelAdapter;
    this.matchesBuiltInCommandPrefix = matchesBuiltInCommandPrefix;
    this.matchesCommandPrefix = matchesCommandPrefix;
    this.normalizeCommandArgument = normalizeCommandArgument;
    this.normalizeText = normalizeText;
    this.resolveReplyTargetForBinding = resolveReplyTargetForBinding;
    this.runtimeAdapter = runtimeAdapter;
    this.streamDelivery = streamDelivery;
    this.streamSettlementTimeoutMs = streamSettlementTimeoutMs;
    this.threadStateStore = threadStateStore;
    this.firstRuntimeEventFailureTimeoutMs = firstRuntimeEventFailureTimeoutMs;
    this.firstRuntimeEventNoticeTimeoutMs = firstRuntimeEventNoticeTimeoutMs;
    this.pendingRuntimeEventWatchdogs = new Map();
    this.pendingTurnSettlementWatchdogs = new Map();
    this.pendingWorkspaceBootstrapByThreadId = new Map();
    this.approvalDependencies = {
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
      threadStateStore,
    };
    this.timerDependencies = {
      channelAdapter,
      runtimeAdapter,
      streamDelivery,
      threadStateStore,
      firstRuntimeEventFailureTimeoutMs,
      firstRuntimeEventNoticeTimeoutMs,
      streamSettlementTimeoutMs,
      normalizeCommandArgument,
      normalizeText,
      clearPendingApproval,
      stopTypingForThread: (threadId) => stopTypingForThread(this.approvalDependencies, threadId),
    };
  }

  observeRuntimeEvent(event: RuntimeEvent<UnknownRecord>): void {
    observeRuntimeEvent(
      this.timerDependencies,
      this.pendingRuntimeEventWatchdogs,
      this.pendingTurnSettlementWatchdogs,
      this.pendingWorkspaceBootstrapByThreadId,
      event,
    );
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
    scheduleRuntimeEventWatchdog(this.timerDependencies, this.pendingRuntimeEventWatchdogs, {
      bindingKey,
      workspaceRoot,
      normalized,
      threadId,
    });
  }

  clearRuntimeEventWatchdog(threadId: unknown): void {
    clearRuntimeEventWatchdog(
      this.normalizeCommandArgument,
      this.pendingRuntimeEventWatchdogs,
      threadId,
    );
  }

  refreshTurnSettlementWatchdog(event: RuntimeEvent<UnknownRecord>): void {
    refreshTurnSettlementWatchdog(
      this.timerDependencies,
      this.pendingTurnSettlementWatchdogs,
      event,
    );
  }

  clearTurnSettlementWatchdog(threadId: unknown, turnId: unknown): void {
    clearTurnSettlementWatchdog(
      this.normalizeCommandArgument,
      this.pendingTurnSettlementWatchdogs,
      threadId,
      turnId,
    );
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
    queuePendingWorkspaceBootstrap(
      this.normalizeText,
      this.pendingWorkspaceBootstrapByThreadId,
      { bindingKey, workspaceRoot, threadId },
    );
  }

  confirmPendingWorkspaceBootstrap(event: RuntimeEvent<UnknownRecord>): void {
    confirmPendingWorkspaceBootstrap(
      {
        normalizeText: this.normalizeText,
        runtimeAdapter: this.runtimeAdapter,
      },
      this.pendingWorkspaceBootstrapByThreadId,
      event,
    );
  }

  async handleRuntimeEvent(event: RuntimeEvent<UnknownRecord>): Promise<void> {
    await this.streamDelivery.handleRuntimeEvent(event);
    if (!event) {
      return;
    }
    if (event.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED || event.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
      clearPendingApproval(this.runtimeAdapter.getSessionStore(), event.payload.threadId);
      await this.stopTypingForThread(event.payload.threadId);
      if (event.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
        await this.sendFailureToThread(event.payload.threadId, event.payload.text || "执行失败");
      }
      return;
    }
    await handleApprovalRequested(this.approvalDependencies, event);
  }

  async stopTypingForThread(threadId: unknown): Promise<void> {
    await stopTypingForThread(this.approvalDependencies, threadId);
  }

  async sendFailureToThread(threadId: unknown, text: unknown): Promise<void> {
    await sendFailureToThread(this.approvalDependencies, threadId, text);
  }

  async sendApprovalPrompt({
    bindingKey,
    approval,
  }: {
    bindingKey: string;
    approval: PendingApprovalState;
  }): Promise<void> {
    await sendApprovalPrompt(this.approvalDependencies, { bindingKey, approval });
  }

  async restoreBoundThreadSubscriptions(): Promise<void> {
    await restoreBoundThreadSubscriptions(this.approvalDependencies);
  }
}
