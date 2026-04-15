import * as os from "node:os";
import * as path from "node:path";
import { ignoreBestEffortError } from "../core/error-handling";
import { resolveRequiredFilePath } from "../core/local-file-path";
import { supportsChannelOperation as canUseChannelOperation } from "../core/app-service-contract";
import type {
  SendLocalFileRequest,
  TimelineScreenshotRequest,
  UserTypingOptions,
} from "../core/runtime-types";
import type {
  RuntimeTurnActionDependencies,
  WithUserTyping,
} from "./runtime-turn-contract";

export interface RuntimeTurnActions {
  sendLocalFileToCurrentChat(payload?: SendLocalFileRequest): Promise<{
    userId: string;
    filePath: string;
  }>;
  sendTimelineScreenshot(payload?: TimelineScreenshotRequest): Promise<{
    userId: string;
    filePath: string;
  }>;
  withUserTyping: WithUserTyping;
}

export function createRuntimeTurnActions(
  dependencies: RuntimeTurnActionDependencies,
): RuntimeTurnActions {
  const withUserTyping: WithUserTyping = async <T>(
    {
      userId,
      contextToken = "",
      clearOnSuccess = true,
    }: UserTypingOptions,
    work: (() => Promise<T>) | null | undefined,
  ): Promise<T> => {
    const normalizedUserId = dependencies.normalizeText(userId);
    const runner = typeof work === "function" ? work : async () => undefined as T;
    if (!normalizedUserId) {
      return runner();
    }
    const canSendTyping = canUseChannelOperation(dependencies.channelAdapter, "visibleTypingDelivery");

    if (canSendTyping) {
      await ignoreBestEffortError(dependencies.channelAdapter.sendTyping({
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
        await ignoreBestEffortError(dependencies.channelAdapter.sendTyping({
          userId: normalizedUserId,
          status: 0,
          contextToken,
        }), {
          label: "typing stop",
          reason: "typing stop is best-effort cleanup after the runtime work has already settled",
        });
      }
    }
  };

  return {
    async sendTimelineScreenshot({
      senderId = "",
      args = [],
      outputFile = "",
    }: TimelineScreenshotRequest = {}) {
      if (!canUseChannelOperation(dependencies.channelAdapter, "visibleFileDelivery")) {
        throw new Error("当前宿主不支持可见文件回传。");
      }
      const targetUserId = dependencies.normalizeText(senderId) || dependencies.resolveDefaultTerminalUser();
      if (!targetUserId) {
        throw new Error("无法确定时间轴截图要发送给哪个微信用户，先配置 CODEKSEI_ALLOWED_USER_IDS");
      }
      const contextToken = dependencies.channelAdapter.getKnownContextTokens()[targetUserId] || "";
      if (!contextToken) {
        throw new Error(`找不到用户 ${targetUserId} 的 context token，先让这个用户和 bot 聊过一次`);
      }

      const normalizedArgs = Array.isArray(args)
        ? args.map((value) => String(value ?? "")).filter(Boolean)
        : [];
      const resolvedOutputFile = dependencies.normalizeText(outputFile)
        || dependencies.resolveTimelineScreenshotOutput(normalizedArgs);
      const finalArgs = resolvedOutputFile
        ? normalizedArgs
        : [...normalizedArgs, "--output", path.join(os.tmpdir(), `codeksei-timeline-${Date.now()}.png`)];
      const savedPath = dependencies.resolveTimelineScreenshotOutput(finalArgs);

      return withUserTyping({
        userId: targetUserId,
        contextToken,
      }, async () => {
        await dependencies.timelineIntegration.runSubcommand("screenshot", finalArgs);
        await dependencies.channelAdapter.sendFile({
          userId: targetUserId,
          filePath: savedPath,
          contextToken,
        });
        return { userId: targetUserId, filePath: savedPath };
      });
    },

    async sendLocalFileToCurrentChat({
      senderId = "",
      filePath = "",
    }: SendLocalFileRequest = {}) {
      if (!canUseChannelOperation(dependencies.channelAdapter, "visibleFileDelivery")) {
        throw new Error("当前宿主不支持可见文件回传。");
      }
      const targetUserId = dependencies.normalizeText(senderId) || dependencies.resolveDefaultTerminalUser();
      if (!targetUserId) {
        throw new Error("无法确定文件要发送给哪个微信用户，先配置 CODEKSEI_ALLOWED_USER_IDS");
      }

      const contextToken = dependencies.channelAdapter.getKnownContextTokens()[targetUserId] || "";
      if (!contextToken) {
        throw new Error(`找不到用户 ${targetUserId} 的 context token，先让这个用户和 bot 聊过一次`);
      }

      const resolvedPath = resolveRequiredFilePath(filePath, {
        empty: "缺少要发送的文件路径",
      });

      return withUserTyping({
        userId: targetUserId,
        contextToken,
      }, async () => {
        await dependencies.channelAdapter.sendFile({
          userId: targetUserId,
          filePath: resolvedPath,
          contextToken,
        });
        return { userId: targetUserId, filePath: resolvedPath };
      });
    },

    withUserTyping,
  };
}
