import type {
  ChannelAdapterLike,
  RuntimeAdapterLike,
  SessionStoreWriterLike,
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
  restoreBoundThreadSubscriptions,
  sendApprovalPrompt,
  sendFailureToThread,
  stopTypingForThread,
  type RuntimeWatchdogApprovalDependencies,
} from "./runtime-watchdog-approval";
import { buildRuntimeWatchdogDependencies } from "./runtime-watchdog-deps";
import { handleRuntimeWatchdogEvent } from "./runtime-watchdog-event-flow";
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
import type { RuntimeEvent } from "../contracts/runtime-events";

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
  sessionWriter: SessionStoreWriterLike;
  streamDelivery: StreamDeliveryLike;
  streamSettlementTimeoutMs: number;
  threadStateStore: ThreadStateStoreLike;
  firstRuntimeEventFailureTimeoutMs: number;
  firstRuntimeEventNoticeTimeoutMs: number;
}

export class RuntimeWatchdogLifecycle {
  readonly approvalDependencies: RuntimeWatchdogApprovalDependencies;
  readonly normalizeCommandArgument: NormalizeCommandArgument;
  readonly normalizeText: NormalizeText;
  readonly pendingRuntimeEventWatchdogs: Map<string, RuntimeEventWatchdogEntry>;
  readonly pendingTurnSettlementWatchdogs: Map<string, TurnSettlementWatchdogEntry>;
  readonly pendingWorkspaceBootstrapByThreadId: Map<string, WorkspaceBootstrapEntry>;
  readonly timerDependencies: RuntimeWatchdogTimerDependencies;

  constructor(dependencies: RuntimeWatchdogLifecycleDependencies) {
    this.normalizeCommandArgument = dependencies.normalizeCommandArgument;
    this.normalizeText = dependencies.normalizeText;
    this.pendingRuntimeEventWatchdogs = new Map();
    this.pendingTurnSettlementWatchdogs = new Map();
    this.pendingWorkspaceBootstrapByThreadId = new Map();

    const built = buildRuntimeWatchdogDependencies(dependencies);
    this.approvalDependencies = built.approvalDependencies;
    this.timerDependencies = built.timerDependencies;
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

  async confirmPendingWorkspaceBootstrap(event: RuntimeEvent<UnknownRecord>): Promise<void> {
    await confirmPendingWorkspaceBootstrap(
      {
        normalizeText: this.normalizeText,
        rememberWorkspaceBootstrapForThread: (
          bindingKey,
          workspaceRoot,
          threadId,
        ) => this.approvalDependencies.sessionWriter.rememberWorkspaceBootstrapForThread(bindingKey, workspaceRoot, threadId),
      },
      this.pendingWorkspaceBootstrapByThreadId,
      event,
    );
  }

  async handleRuntimeEvent(event: RuntimeEvent<UnknownRecord>): Promise<void> {
    await this.confirmPendingWorkspaceBootstrap(event);
    await this.approvalDependencies.streamDelivery.handleRuntimeEvent(event);
    await handleRuntimeWatchdogEvent(this.approvalDependencies, event);
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
