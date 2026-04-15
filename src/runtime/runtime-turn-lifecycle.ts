import { ignoreBestEffortError } from "../core/error-handling";
import { userFacingMessages } from "../core/message-catalog";
import type {
  ChannelAdapterLike,
  RuntimeAdapterLike,
  StreamDeliveryLike,
  TimelineIntegrationLike,
} from "../core/app-service-contract";
import { supportsChannelOperation as canUseChannelOperation } from "../core/app-service-contract";
import type {
  HandlePreparedMessageOptions,
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
  RuntimeTurnSendResult,
  SendLocalFileRequest,
  TimelineScreenshotRequest,
  UserTypingOptions,
} from "../core/runtime-types";
import {
  createRuntimeTurnActions,
  type RuntimeTurnActions,
} from "./runtime-turn-actions";
import {
  createRuntimeTurnPreparation,
  type RuntimeTurnPreparation,
} from "./runtime-turn-preparation";
import {
  createRuntimeTurnSend,
  type RuntimeTurnSend,
} from "./runtime-turn-send";
import type {
  BuildRuntimeInboundText,
  FormatErrorMessage,
  HandlePreparedMessageResult,
  MaybeDispatchCommand,
  NormalizeText,
  PersistIncomingWeixinAttachments,
  QueuePendingWorkspaceBootstrap,
  ResolveDefaultTerminalUser,
  ResolveTimelineScreenshotOutput,
  ResolveWorkspaceRoot,
  RuntimeTurnConfig,
  RuntimeTurnLifecycleDependencies,
  ScheduleRuntimeEventWatchdog,
} from "./runtime-turn-contract";

export class RuntimeTurnLifecycle {
  readonly actions: RuntimeTurnActions;
  readonly channelAdapter: ChannelAdapterLike;
  readonly config: RuntimeTurnConfig;
  readonly formatErrorMessage: FormatErrorMessage;
  readonly maybeDispatchCommand: MaybeDispatchCommand;
  readonly normalizeText: NormalizeText;
  readonly preparation: RuntimeTurnPreparation;
  readonly queuePendingWorkspaceBootstrap: QueuePendingWorkspaceBootstrap;
  readonly resolveWorkspaceRoot: ResolveWorkspaceRoot;
  readonly runtimeAdapter: RuntimeAdapterLike;
  readonly scheduleRuntimeEventWatchdog: ScheduleRuntimeEventWatchdog;
  readonly send: RuntimeTurnSend;
  readonly streamDelivery: StreamDeliveryLike;

  constructor({
    channelAdapter,
    config,
    formatErrorMessage,
    maybeDispatchCommand,
    normalizeText,
    persistIncomingWeixinAttachments,
    queuePendingWorkspaceBootstrap,
    resolveDefaultTerminalUser,
    resolveTimelineScreenshotOutput,
    resolveWorkspaceRoot,
    runtimeAdapter,
    scheduleRuntimeEventWatchdog,
    streamDelivery,
    timelineIntegration,
    buildRuntimeInboundText,
  }: RuntimeTurnLifecycleDependencies) {
    this.channelAdapter = channelAdapter;
    this.config = config;
    this.formatErrorMessage = formatErrorMessage;
    this.maybeDispatchCommand = maybeDispatchCommand;
    this.normalizeText = normalizeText;
    this.queuePendingWorkspaceBootstrap = queuePendingWorkspaceBootstrap;
    this.resolveWorkspaceRoot = resolveWorkspaceRoot;
    this.runtimeAdapter = runtimeAdapter;
    this.scheduleRuntimeEventWatchdog = scheduleRuntimeEventWatchdog;
    this.streamDelivery = streamDelivery;
    // Keep the public lifecycle seam stable, but move owner logic into
    // dedicated siblings so future tests and refactors land on the real
    // subsystem boundary instead of re-growing one mixed orchestrator file.
    this.actions = createRuntimeTurnActions({
      channelAdapter,
      normalizeText,
      resolveDefaultTerminalUser,
      resolveTimelineScreenshotOutput,
      timelineIntegration,
    });
    this.preparation = createRuntimeTurnPreparation({
      buildRuntimeInboundText,
      channelAdapter,
      config,
      persistIncomingWeixinAttachments,
    });
    this.send = createRuntimeTurnSend({
      config,
      formatErrorMessage,
      normalizeText,
      queuePendingWorkspaceBootstrap,
      runtimeAdapter,
      scheduleRuntimeEventWatchdog,
      streamDelivery,
      withUserTyping: (options, work) => this.actions.withUserTyping(options, work),
    });
  }

  async sendTimelineScreenshot({ senderId = "", args = [], outputFile = "" }: TimelineScreenshotRequest = {}) {
    return this.actions.sendTimelineScreenshot({ senderId, args, outputFile });
  }

  async sendLocalFileToCurrentChat({ senderId = "", filePath = "" }: SendLocalFileRequest = {}) {
    return this.actions.sendLocalFileToCurrentChat({ senderId, filePath });
  }

  async handlePreparedMessage(
    normalized: NormalizedIncomingMessage,
    {
      allowCommands,
      reportFailureToUser = true,
      throwOnFailure = false,
    }: HandlePreparedMessageOptions,
  ): Promise<HandlePreparedMessageResult> {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    this.streamDelivery.setReplyTarget(bindingKey, {
      userId: normalized.senderId,
      contextToken: normalized.contextToken,
      provider: normalized.provider,
    });

    if (allowCommands && await this.maybeDispatchCommand(normalized)) {
      return;
    }

    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const prepared = await this.prepareIncomingMessageForRuntime(normalized, workspaceRoot);
    if (!prepared) {
      return { status: "skipped", reason: "not_prepared" };
    }

    const sendResult = await this.sendPreparedMessageToRuntime({
      bindingKey,
      workspaceRoot,
      normalized,
      prepared,
    });
    if (sendResult.status === "sent") {
      return sendResult;
    }

    if (reportFailureToUser && canUseChannelOperation(this.channelAdapter, "visibleTextDelivery")) {
      const messageText = this.normalizeText(sendResult.reason) || "unknown error";
      await ignoreBestEffortError(this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: userFacingMessages.runtimeSendFailed(messageText),
        contextToken: normalized.contextToken,
      }), {
        label: "runtime turn failure notice",
        reason: "user-visible retry notice is best-effort cleanup after a failed send",
      });
    }
    if (throwOnFailure) {
      if ("error" in sendResult && sendResult.error) {
        throw sendResult.error;
      }
      throw new Error(this.normalizeText(sendResult.reason) || "runtime_send_failed");
    }
    return sendResult;
  }

  async prepareIncomingMessageForRuntime(
    normalized: NormalizedIncomingMessage,
    workspaceRoot: string,
  ): Promise<PreparedRuntimeMessage | null> {
    return this.preparation.prepareIncomingMessageForRuntime(normalized, workspaceRoot);
  }

  async withUserTyping<T>(
    {
      userId,
      contextToken = "",
      clearOnSuccess = true,
    }: UserTypingOptions,
    work: (() => Promise<T>) | null | undefined,
  ): Promise<T> {
    return this.actions.withUserTyping({ userId, contextToken, clearOnSuccess }, work);
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
    return this.send.sendPreparedMessageToRuntime({
      bindingKey,
      workspaceRoot,
      normalized,
      prepared,
    });
  }
}
