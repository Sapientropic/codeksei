const fs = require("fs");
const os = require("os");
const path = require("path");

class RuntimeTurnLifecycle {
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
  }) {
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

  async sendTimelineScreenshot({ senderId = "", args = [], outputFile = "" } = {}) {
    const targetUserId = this.normalizeText(senderId) || this.resolveDefaultTerminalUser();
    if (!targetUserId) {
      throw new Error("无法确定时间轴截图要发送给哪个微信用户，先配置 CODEKSEI_ALLOWED_USER_IDS（或旧的 CYBERBOSS_ALLOWED_USER_IDS）");
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

  async sendLocalFileToCurrentChat({ senderId = "", filePath = "" } = {}) {
    const targetUserId = this.normalizeText(senderId) || this.resolveDefaultTerminalUser();
    if (!targetUserId) {
      throw new Error("无法确定文件要发送给哪个微信用户，先配置 CODEKSEI_ALLOWED_USER_IDS（或旧的 CYBERBOSS_ALLOWED_USER_IDS）");
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

  async handlePreparedMessage(normalized, {
    allowCommands,
    reportFailureToUser = true,
    throwOnFailure = false,
  }) {
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
      throw sendResult.error || new Error(this.normalizeText(sendResult.reason) || "runtime_send_failed");
    }
    return sendResult;
  }

  async prepareIncomingMessageForRuntime(normalized, workspaceRoot) {
    const attachments = Array.isArray(normalized.attachments) ? normalized.attachments : [];
    if (!attachments.length) {
      return {
        ...normalized,
        originalText: normalized.text,
        text: this.buildCodexInboundText(normalized, { saved: [], failed: [] }, this.config),
        attachments: [],
        attachmentFailures: [],
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
    };
  }

  async withUserTyping({
    userId,
    contextToken = "",
    clearOnSuccess = true,
  }, work) {
    const normalizedUserId = this.normalizeText(userId);
    const runner = typeof work === "function" ? work : async () => undefined;
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
  }) {
    try {
      const turn = await this.withUserTyping({
        userId: normalized.senderId,
        contextToken: normalized.contextToken,
        // A successful runtime turn keeps typing alive until the runtime event
        // stream, watchdog, or stopTypingForThread() settles it. Only the local
        // failure path should clear typing here.
        clearOnSuccess: false,
      }, async () => this.runtimeAdapter.sendTextTurn({
        bindingKey,
        workspaceRoot,
        text: prepared.text,
        model: this.runtimeAdapter.getSessionStore().getCodexParamsForWorkspace(bindingKey, workspaceRoot).model,
        accessMode: this.config.codexAccessMode,
        metadata: {
          workspaceId: prepared.workspaceId,
          accountId: prepared.accountId,
          senderId: prepared.senderId,
        },
      }));

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

module.exports = { RuntimeTurnLifecycle };
