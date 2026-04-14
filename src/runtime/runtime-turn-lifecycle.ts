import * as os from "node:os";
import * as path from "node:path";
import { ignoreBestEffortError } from "../core/error-handling";
import { resolveRequiredFilePath } from "../core/local-file-path";
import { userFacingMessages } from "../core/message-catalog";
import type {
  RuntimeHostConfig,
  WeixinBridgeConfig,
  WorkspacePathsConfig,
} from "../core/config-slices";
import type { SessionStore } from "../adapters/runtime/codex/session-store";
import type {
  ChannelAdapterLike,
  RuntimeAdapterLike,
  StreamDeliveryLike,
  TimelineIntegrationLike,
} from "../core/app-service-contract";
import type {
  HandlePreparedMessageOptions,
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
  ReplyTarget,
  RuntimeTurnSendResult,
  SendLocalFileRequest,
  TimelineScreenshotRequest,
  RuntimeTurnSendState,
  UserTypingOptions,
} from "../core/runtime-types";
import type {
  IncomingWeixinAttachment,
  PersistIncomingWeixinAttachmentsResult,
} from "../contracts/weixin-media";
import { supportsChannelOperation as canUseChannelOperation, supportsRuntimeOperation as canUseRuntimeOperation } from "../core/app-service-contract";

type PersistedAttachmentResult = PersistIncomingWeixinAttachmentsResult;

type RuntimeTurnConfig =
  & Pick<WorkspacePathsConfig, "stateDir" | "workspaceId" | "workspaceRoot">
  & Pick<RuntimeHostConfig, "runtimeAccessMode">
  & Pick<WeixinBridgeConfig, "weixinCdnBaseUrl">;

type FormatErrorMessage = (error: unknown) => string;
type MaybeDispatchCommand = (normalized: NormalizedIncomingMessage) => Promise<boolean>;
type NormalizeText = (value: unknown) => string;
type PersistIncomingWeixinAttachments = (args: {
  attachments: IncomingWeixinAttachment[];
  stateDir: string;
  cdnBaseUrl: unknown;
  messageId: string;
  receivedAt: string;
  workspaceRoot: string;
}) => Promise<PersistedAttachmentResult>;
type QueuePendingWorkspaceBootstrap = (payload: {
  bindingKey: string;
  workspaceRoot: string;
  threadId: string;
}) => void;
type ResolveDefaultTerminalUser = () => string;
type ResolveTimelineScreenshotOutput = (args: string[]) => string;
type ResolveWorkspaceRoot = (bindingKey: string) => string;
type ScheduleRuntimeEventWatchdog = (payload: {
  bindingKey: string;
  workspaceRoot: string;
  normalized: PreparedRuntimeMessage;
  threadId?: string;
}) => void;
type BuildRuntimeInboundText = (
  normalized: NormalizedIncomingMessage,
  persisted: PersistedAttachmentResult,
  config: RuntimeTurnConfig,
) => string;

type HandlePreparedMessageResult = void | RuntimeTurnSendResult;

interface RuntimeTurnLifecycleDependencies {
  channelAdapter: ChannelAdapterLike;
  config: RuntimeTurnConfig;
  formatErrorMessage: FormatErrorMessage;
  maybeDispatchCommand: MaybeDispatchCommand;
  normalizeText: NormalizeText;
  persistIncomingWeixinAttachments: PersistIncomingWeixinAttachments;
  queuePendingWorkspaceBootstrap: QueuePendingWorkspaceBootstrap;
  resolveDefaultTerminalUser: ResolveDefaultTerminalUser;
  resolveTimelineScreenshotOutput: ResolveTimelineScreenshotOutput;
  resolveWorkspaceRoot: ResolveWorkspaceRoot;
  runtimeAdapter: RuntimeAdapterLike;
  scheduleRuntimeEventWatchdog: ScheduleRuntimeEventWatchdog;
  streamDelivery: StreamDeliveryLike;
  timelineIntegration: TimelineIntegrationLike;
  buildRuntimeInboundText: BuildRuntimeInboundText;
}

export class RuntimeTurnLifecycle {
  readonly buildRuntimeInboundText: BuildRuntimeInboundText;
  readonly channelAdapter: ChannelAdapterLike;
  readonly config: RuntimeTurnConfig;
  readonly formatErrorMessage: FormatErrorMessage;
  readonly maybeDispatchCommand: MaybeDispatchCommand;
  readonly normalizeText: NormalizeText;
  readonly persistIncomingWeixinAttachments: PersistIncomingWeixinAttachments;
  readonly queuePendingWorkspaceBootstrap: QueuePendingWorkspaceBootstrap;
  readonly resolveDefaultTerminalUser: ResolveDefaultTerminalUser;
  readonly resolveTimelineScreenshotOutput: ResolveTimelineScreenshotOutput;
  readonly resolveWorkspaceRoot: ResolveWorkspaceRoot;
  readonly runtimeAdapter: RuntimeAdapterLike;
  readonly scheduleRuntimeEventWatchdog: ScheduleRuntimeEventWatchdog;
  readonly streamDelivery: StreamDeliveryLike;
  readonly timelineIntegration: TimelineIntegrationLike;

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
    this.persistIncomingWeixinAttachments = persistIncomingWeixinAttachments;
    this.queuePendingWorkspaceBootstrap = queuePendingWorkspaceBootstrap;
    this.resolveDefaultTerminalUser = resolveDefaultTerminalUser;
    this.resolveTimelineScreenshotOutput = resolveTimelineScreenshotOutput;
    this.resolveWorkspaceRoot = resolveWorkspaceRoot;
    this.runtimeAdapter = runtimeAdapter;
    this.scheduleRuntimeEventWatchdog = scheduleRuntimeEventWatchdog;
    this.streamDelivery = streamDelivery;
    this.timelineIntegration = timelineIntegration;
    this.buildRuntimeInboundText = buildRuntimeInboundText;
  }

  async sendTimelineScreenshot({ senderId = "", args = [], outputFile = "" }: TimelineScreenshotRequest = {}) {
    if (!canUseChannelOperation(this.channelAdapter, "visibleFileDelivery")) {
      throw new Error("当前宿主不支持可见文件回传。");
    }
    const targetUserId = this.normalizeText(senderId) || this.resolveDefaultTerminalUser();
    if (!targetUserId) {
      throw new Error("无法确定时间轴截图要发送给哪个微信用户，先配置 CODEKSEI_ALLOWED_USER_IDS");
    }
    const contextToken = this.channelAdapter.getKnownContextTokens()[targetUserId] || "";
    if (!contextToken) {
      throw new Error(`找不到用户 ${targetUserId} 的 context token，先让这个用户和 bot 聊过一次`);
    }

    const normalizedArgs = Array.isArray(args)
      ? args.map((value) => String(value ?? "")).filter(Boolean)
      : [];
    const resolvedOutputFile = this.normalizeText(outputFile) || this.resolveTimelineScreenshotOutput(normalizedArgs);
    const finalArgs = resolvedOutputFile
      ? normalizedArgs
      : [...normalizedArgs, "--output", path.join(os.tmpdir(), `codeksei-timeline-${Date.now()}.png`)];
    const savedPath = this.resolveTimelineScreenshotOutput(finalArgs);

    return this.withUserTyping({
      userId: targetUserId,
      contextToken,
    }, async () => {
      await this.timelineIntegration.runSubcommand("screenshot", finalArgs);
      await this.channelAdapter.sendFile({
        userId: targetUserId,
        filePath: savedPath,
        contextToken,
      });
      return { userId: targetUserId, filePath: savedPath };
    });
  }

  async sendLocalFileToCurrentChat({ senderId = "", filePath = "" }: SendLocalFileRequest = {}) {
    if (!canUseChannelOperation(this.channelAdapter, "visibleFileDelivery")) {
      throw new Error("当前宿主不支持可见文件回传。");
    }
    const targetUserId = this.normalizeText(senderId) || this.resolveDefaultTerminalUser();
    if (!targetUserId) {
      throw new Error("无法确定文件要发送给哪个微信用户，先配置 CODEKSEI_ALLOWED_USER_IDS");
    }

    const contextToken = this.channelAdapter.getKnownContextTokens()[targetUserId] || "";
    if (!contextToken) {
      throw new Error(`找不到用户 ${targetUserId} 的 context token，先让这个用户和 bot 聊过一次`);
    }

    const resolvedPath = resolveRequiredFilePath(filePath, {
      empty: "缺少要发送的文件路径",
    });

    return this.withUserTyping({
      userId: targetUserId,
      contextToken,
    }, async () => {
      await this.channelAdapter.sendFile({
        userId: targetUserId,
        filePath: resolvedPath,
        contextToken,
      });
      return { userId: targetUserId, filePath: resolvedPath };
    });
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
    const attachments = Array.isArray(normalized.attachments)
      ? normalized.attachments as IncomingWeixinAttachment[]
      : [];
    if (!attachments.length) {
      return {
        ...normalized,
        originalText: normalized.text,
        text: this.buildRuntimeInboundText(normalized, { saved: [], failed: [] }, this.config),
        attachments: [],
        attachmentFailures: [],
        workspaceRoot,
      };
    }

    const persisted = await this.persistIncomingWeixinAttachments({
      attachments,
      stateDir: this.config.stateDir,
      cdnBaseUrl: this.config.weixinCdnBaseUrl,
      messageId: normalized.messageId,
      receivedAt: normalized.receivedAt,
      workspaceRoot,
    });

    if (!persisted.saved.length && persisted.failed.length && !String(normalized.text || "").trim()) {
      if (canUseChannelOperation(this.channelAdapter, "visibleTextDelivery")) {
        await ignoreBestEffortError(this.channelAdapter.sendText({
          userId: normalized.senderId,
          text: userFacingMessages.attachmentReceiveFailed(persisted.failed.map((item) => item.reason)),
          contextToken: normalized.contextToken,
          preserveBlock: true,
        }), {
          label: "attachment failure notice",
          reason: "attachment persistence failure should still return null even if the courtesy notice cannot be delivered",
        });
      }
      return null;
    }

    const runtimeInboundText = this.buildRuntimeInboundText(normalized, persisted, this.config);
    if (!runtimeInboundText) {
      if (canUseChannelOperation(this.channelAdapter, "visibleTextDelivery")) {
        await ignoreBestEffortError(this.channelAdapter.sendText({
          userId: normalized.senderId,
          text: userFacingMessages.attachmentReceiveFailed(persisted.failed.map((item) => item.reason)),
          contextToken: normalized.contextToken,
          preserveBlock: true,
        }), {
          label: "attachment-only failure notice",
          reason: "the user-facing attachment failure notice is best-effort after the runtime payload collapsed to empty",
        });
      }
      return null;
    }

    return {
      ...normalized,
      originalText: normalized.text,
      text: runtimeInboundText,
      attachments: persisted.saved,
      attachmentFailures: persisted.failed,
      workspaceRoot,
    };
  }

  async withUserTyping<T>(
    {
      userId,
      contextToken = "",
      clearOnSuccess = true,
    }: UserTypingOptions,
    work: (() => Promise<T>) | null | undefined,
  ): Promise<T> {
    const normalizedUserId = this.normalizeText(userId);
    const runner = typeof work === "function" ? work : async () => undefined as T;
    if (!normalizedUserId) {
      return runner();
    }
    const canSendTyping = canUseChannelOperation(this.channelAdapter, "visibleTypingDelivery");

    if (canSendTyping) {
      await ignoreBestEffortError(this.channelAdapter.sendTyping({
        userId: normalizedUserId,
        status: 1,
        contextToken,
      }), {
        label: "typing start",
        reason: "typing start should not block the actual runtime work",
      });
    }

    let succeeded = false;
    try {
      const result = await runner();
      succeeded = true;
      return result;
    } finally {
      if (canSendTyping && (clearOnSuccess || !succeeded)) {
        await ignoreBestEffortError(this.channelAdapter.sendTyping({
          userId: normalizedUserId,
          status: 0,
          contextToken,
        }), {
          label: "typing stop",
          reason: "typing stop is best-effort cleanup after the runtime work has already settled",
        });
      }
    }
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
    if (!canUseRuntimeOperation(this.runtimeAdapter, "interactiveTurn")) {
      return {
        status: "retryable_error",
        reason: "当前宿主不支持 interactive runtime turn。",
      };
    }
    try {
      const turn = await this.withUserTyping({
        userId: normalized.senderId,
        contextToken: normalized.contextToken,
        // A successful runtime turn keeps typing alive until the runtime event
        // stream, watchdog, or stopTypingForThread() settles it. Only the local
        // failure path should clear typing here.
        clearOnSuccess: false,
      }, async () => {
        const sendArgs: {
          bindingKey: string;
          workspaceRoot: string;
          text: string;
          model?: string;
          effort?: string;
          accessMode?: string;
          metadata?: Record<string, unknown>;
        } = {
          bindingKey,
          workspaceRoot,
          text: prepared.text,
        };
        const metadata: Record<string, unknown> = {
          workspaceId: prepared.workspaceId,
          accountId: prepared.accountId,
          senderId: prepared.senderId,
        };
        if (prepared.provider === "system") {
          metadata.systemMessage = {
            kind: this.normalizeText(prepared.systemMessageKind) || "manual",
            messageId: prepared.messageId,
            checkinTriggerId: this.normalizeText(prepared.checkinTriggerId),
          };
        }
        sendArgs.metadata = metadata;
        const runtimeParams = this.runtimeAdapter.getSessionStore().getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
        const model = runtimeParams.model;
        if (model) {
          sendArgs.model = model;
        }
        if (runtimeParams.effort) {
          sendArgs.effort = runtimeParams.effort;
        }
        const accessMode = this.normalizeText(this.config.runtimeAccessMode);
        if (accessMode) {
          sendArgs.accessMode = accessMode;
        }
        return this.runtimeAdapter.sendTextTurn(sendArgs);
      });

      this.streamDelivery.queueReplyTargetForThread(turn.threadId, {
        userId: prepared.senderId,
        contextToken: prepared.contextToken,
        provider: prepared.provider,
      });
      if (turn.workspaceBootstrapPending) {
        this.queuePendingWorkspaceBootstrap({
          bindingKey,
          workspaceRoot,
          threadId: turn.threadId,
        });
      }
      this.scheduleRuntimeEventWatchdog({
        bindingKey,
        workspaceRoot,
        normalized: prepared,
        threadId: turn.threadId,
      });
      return {
        status: "sent",
        threadId: turn.threadId,
      };
    } catch (error) {
      return {
        status: "retryable_error",
        reason: this.formatErrorMessage(error),
        error,
      };
    }
  }
}
