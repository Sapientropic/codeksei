import type { AppRuntimeConfig } from "./app-service-contract";
import { sendFileViaHermesRepoLocal } from "./hermes-repo-local";
import { resolveHostMode } from "./host-mode";
import { resolveRequiredFilePath } from "./local-file-path";
import { normalizeText } from "./text-normalization";

export interface LocalFileDeliveryApp {
  sendLocalFileToCurrentChat(args: {
    senderId: string;
    filePath: string;
  }): Promise<Record<string, unknown>>;
}

export type LocalFileDeliveryConfig = Partial<Pick<
  AppRuntimeConfig,
  | "channel"
  | "channelProvider"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "runtime"
>>;

export interface DeliveredLocalFile {
  chatId: string;
  filePath: string;
  platform: string;
  sessionId: string;
  sessionKey: string;
  threadId: string;
}

export async function deliverLocalFileToCurrentChat(
  app: LocalFileDeliveryApp | null,
  config: LocalFileDeliveryConfig,
  {
    filePath,
    senderId = "",
  }: {
    filePath: string;
    senderId?: string;
  },
): Promise<DeliveredLocalFile> {
  const resolvedFilePath = resolveRequiredFilePath(filePath, {
    empty: "缺少要发送的文件路径",
  });
  const normalizedSenderId = normalizeText(senderId);
  const hostMode = resolveHostMode(config);

  if (hostMode.mode === "hosted") {
    const result = sendFileViaHermesRepoLocal(config, {
      file_path: resolvedFilePath,
      sender_id: normalizedSenderId,
    });
    return {
      chatId: result.chatId,
      filePath: result.filePath,
      platform: result.platform,
      sessionId: result.sessionId,
      sessionKey: result.sessionKey,
      threadId: result.threadId,
    };
  }

  if (!app) {
    throw new Error("当前桥接模式需要活动 app runtime 才能发送本地文件。");
  }

  const result = await app.sendLocalFileToCurrentChat({
    filePath: resolvedFilePath,
    senderId: normalizedSenderId,
  });
  return {
    chatId: "",
    filePath: normalizeText(result.filePath) || resolvedFilePath,
    platform: "",
    sessionId: "",
    sessionKey: "",
    threadId: "",
  };
}

