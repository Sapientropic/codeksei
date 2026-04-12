import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SessionStore } from "../adapters/runtime/codex/session-store";
import type {
  AppRuntimeConfig,
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
} from "../adapters/channel/weixin/media-types";

type PersistedAttachmentResult = PersistIncomingWeixinAttachmentsResult;

type RuntimeTurnConfig = AppRuntimeConfig;

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
type BuildCodexInboundText = (
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
  buildCodexInboundText: BuildCodexInboundText;
}

export class RuntimeTurnLifecycle {
  readonly buildCodexInboundText: BuildCodexInboundText;
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
    buildCodexInboundText,
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
    this.buildCodexInboundText = buildCodexInboundText;
  }

  async sendTimelineScreenshot({ senderId = "", args = [], outputFile = "" }: TimelineScreenshotRequest = {}) {
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
    const targetUserId = this.normalizeText(senderId) || this.resolveDefaultTerminalUser();
    if (!targetUserId) {
      throw new Error("无法确定文件要发送给哪个微信用户，先配置 CODEKSEI_ALLOWED_USER_IDS");
    }

    const contextToken = this.channelAdapter.getKnownContextTokens()[targetUserId] || "";
    if (!contextToken) {
      throw new Error(`找不到用户 ${targetUserId} 的 context token，先让这个用户和 bot 聊过一次`);
    }

    const requestedPath = this.normalizeText(filePath);
    if (!requestedPath) {
      throw new Error("缺少要发送的文件路径");
    }
    const resolvedPath = path.resolve(requestedPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`文件不存在: ${resolvedPath}`);
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`只能发送文件，不能发送目录: ${resolvedPath}`);
    }

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

    if (reportFailureToUser) {
      const messageText = this.normalizeText(sendResult.reason) || "unknown error";
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `处理失败：${messageText}`,
        contextToken: normalized.contextToken,
      }).catch(() => {});
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
        text: this.buildCodexInboundText(normalized, { saved: [], failed: [] }, this.config),
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
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `图片/附件接收失败：${persisted.failed.map((item) => item.reason).join("; ")}`,
        contextToken: normalized.contextToken,
        preserveBlock: true,
      }).catch(() => {});
      return null;
    }

    const codexInboundText = this.buildCodexInboundText(normalized, persisted, this.config);
    if (!codexInboundText) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `图片/附件接收失败：${persisted.failed.map((item) => item.reason).join("; ")}`,
        contextToken: normalized.contextToken,
        preserveBlock: true,
      }).catch(() => {});
      return null;
    }

    return {
      ...normalized,
      originalText: normalized.text,
      text: codexInboundText,
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

    await this.channelAdapter.sendTyping({
      userId: normalizedUserId,
      status: 1,
      contextToken,
    }).catch(() => {});

    let succeeded = false;
    try {
      const result = await runner();
      succeeded = true;
      return result;
    } finally {
      if (clearOnSuccess || !succeeded) {
        await this.channelAdapter.sendTyping({
          userId: normalizedUserId,
          status: 0,
          contextToken,
        }).catch(() => {});
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
          accessMode?: string;
          metadata?: Record<string, unknown>;
        } = {
          bindingKey,
          workspaceRoot,
          text: prepared.text,
          metadata: {
            workspaceId: prepared.workspaceId,
            accountId: prepared.accountId,
            senderId: prepared.senderId,
          },
        };
        const model = this.runtimeAdapter.getSessionStore().getCodexParamsForWorkspace(bindingKey, workspaceRoot).model;
        if (model) {
          sendArgs.model = model;
        }
        const accessMode = this.normalizeText(this.config.codexAccessMode);
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
