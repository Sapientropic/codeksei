import { resolvePreferredSenderId } from "../workspace/default-targets";
import { normalizeTrimmedText } from "./approval-command-policy";
import type {
  AppRuntimeConfig,
  ChannelAdapterLike,
  RuntimeAdapterLike,
} from "./app-service-contract";
import type { ReplyTarget } from "./runtime-types";

export function resolveAppDefaultTerminalUser({
  config,
  channelAdapter,
  runtimeAdapter,
}: {
  config: AppRuntimeConfig;
  channelAdapter: Pick<ChannelAdapterLike, "resolveAccount">;
  runtimeAdapter: Pick<RuntimeAdapterLike, "getSessionStore">;
}): string {
  const sessionStore = runtimeAdapter.getSessionStore() as Exclude<
    Parameters<typeof resolvePreferredSenderId>[0]["sessionStore"],
    undefined
  >;
  return resolvePreferredSenderId({
    config,
    accountId: channelAdapter.resolveAccount().accountId,
    sessionStore,
  });
}

export function resolveAppWorkspaceRoot({
  bindingKey,
  config,
  runtimeAdapter,
}: {
  bindingKey: string;
  config: AppRuntimeConfig;
  runtimeAdapter: Pick<RuntimeAdapterLike, "getSessionStore">;
}): string {
  const sessionStore = runtimeAdapter.getSessionStore();
  return sessionStore.getActiveWorkspaceRoot(bindingKey) || config.workspaceRoot;
}

export function resolveReplyTargetForBinding({
  bindingKey,
  channelAdapter,
  runtimeAdapter,
}: {
  bindingKey: string;
  channelAdapter: Pick<ChannelAdapterLike, "getKnownContextTokens">;
  runtimeAdapter: Pick<RuntimeAdapterLike, "getSessionStore">;
}): ReplyTarget | null {
  const binding = runtimeAdapter.getSessionStore().getBinding(bindingKey) || null;
  const userId = normalizeTrimmedText(binding?.senderId);
  if (!userId) {
    return null;
  }
  const contextToken = channelAdapter.getKnownContextTokens()[userId] || "";
  if (!contextToken) {
    return null;
  }
  return {
    userId,
    contextToken,
    provider: "weixin",
  };
}
