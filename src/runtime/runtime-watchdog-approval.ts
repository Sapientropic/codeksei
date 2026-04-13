import { RUNTIME_EVENT_TYPES, type RuntimeEvent } from "../contracts/runtime-events";
import { ignoreBestEffortError } from "../core/error-handling";
import type {
  ChannelAdapterLike,
  RuntimeAdapterLike,
  SessionStoreLike,
  SessionStoreWriterLike,
  StreamDeliveryLike,
  ThreadStateStoreLike,
} from "../core/app-service-contract";
import { userFacingMessages } from "../core/message-catalog";
import type {
  PendingApprovalState,
  ReplyTarget,
  UnknownRecord,
} from "../core/runtime-types";

type BuildApprovalPromptSignature = (approval: PendingApprovalState) => string;
type BuildApprovalPromptText = (approval: PendingApprovalState) => string;
type MatchesBuiltInCommandPrefix = (commandTokens: unknown) => boolean;
type MatchesCommandPrefix = (commandTokens: unknown, allowlist: string[][]) => boolean;
type NormalizeCommandArgument = (value: unknown) => string;
type NormalizeText = (value: unknown) => string;
type ResolveReplyTargetForBinding = (bindingKey: string) => ReplyTarget | null;

export interface RuntimeWatchdogApprovalDependencies {
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
  threadStateStore: ThreadStateStoreLike;
}

export async function handleApprovalRequested(
  dependencies: RuntimeWatchdogApprovalDependencies,
  event: RuntimeEvent<UnknownRecord>,
): Promise<boolean> {
  if (event.type !== RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED) {
    return false;
  }
  const sessionStore = dependencies.runtimeAdapter.getSessionStore();
  const linked = sessionStore.findBindingForThreadId(event.payload.threadId);
  if (!linked?.workspaceRoot) {
    return true;
  }
  const eventThreadId = dependencies.normalizeCommandArgument(event.payload.threadId);
  const approval = normalizePendingApprovalState(event.payload, eventThreadId, dependencies.normalizeText);
  if (!eventThreadId || !approval.requestId) {
    return true;
  }
  const allowlist = sessionStore.getApprovalCommandAllowlistForWorkspace(linked.workspaceRoot);
  const shouldAutoApprove = dependencies.matchesBuiltInCommandPrefix(event.payload.commandTokens)
    || dependencies.matchesCommandPrefix(event.payload.commandTokens, allowlist);
  if (!shouldAutoApprove) {
    const promptState = sessionStore.getPendingApprovalForThread(eventThreadId);
    const promptSignature = dependencies.buildApprovalPromptSignature(approval);
    if (promptState?.signature && promptState.signature === promptSignature) {
      await dependencies.sessionWriter.rememberPendingApprovalForThread(eventThreadId, approval, {
        signature: promptSignature,
        promptedAt: promptState.promptedAt || new Date().toISOString(),
      });
      console.log(
        `[codeksei] approval prompt deduped thread=${eventThreadId} requestId=${approval.requestId}`,
      );
      return true;
    }
    await dependencies.sessionWriter.rememberPendingApprovalForThread(eventThreadId, approval, {
      signature: promptSignature,
    });
    await sendApprovalPrompt(dependencies, {
      bindingKey: linked.bindingKey,
      approval,
    });
    return true;
  }
  await clearPendingApproval(dependencies.sessionWriter, eventThreadId);
  await ignoreBestEffortError(dependencies.runtimeAdapter.respondApproval({
    requestId: approval.requestId,
    decision: "accept",
  }), {
    label: "approval auto-accept",
    reason: "auto-approved commands should not leave a rejected promise in the approval recovery path",
  });
  dependencies.threadStateStore.resolveApproval(eventThreadId, "running");
  return true;
}

export async function stopTypingForThread(
  dependencies: RuntimeWatchdogApprovalDependencies,
  threadId: unknown,
): Promise<void> {
  const linked = dependencies.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
  const target = linked?.bindingKey ? dependencies.resolveReplyTargetForBinding(linked.bindingKey) : null;
  if (!target) {
    return;
  }
  await ignoreBestEffortError(dependencies.channelAdapter.sendTyping({
    userId: target.userId,
    status: 0,
    contextToken: target.contextToken,
  }), {
    label: "approval typing stop",
    reason: "typing stop is best-effort cleanup for approval-side recovery",
  });
}

export async function sendFailureToThread(
  dependencies: RuntimeWatchdogApprovalDependencies,
  threadId: unknown,
  text: unknown,
): Promise<void> {
  const linked = dependencies.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
  const target = linked?.bindingKey ? dependencies.resolveReplyTargetForBinding(linked.bindingKey) : null;
  if (!target) {
    return;
  }
  await ignoreBestEffortError(dependencies.channelAdapter.sendText({
    userId: target.userId,
    text: userFacingMessages.executionFailed(text),
    contextToken: target.contextToken,
  }), {
    label: "approval failure notice",
    reason: "failure notice should not block watchdog recovery when the reply target is already flaky",
  });
}

export async function sendApprovalPrompt(
  dependencies: RuntimeWatchdogApprovalDependencies,
  {
    bindingKey,
    approval,
  }: {
    bindingKey: string;
    approval: PendingApprovalState;
  },
): Promise<void> {
  const target = dependencies.resolveReplyTargetForBinding(bindingKey);
  if (!target) {
    console.warn(
      `[codeksei] approval prompt skipped binding=${bindingKey} requestId=${approval?.requestId || ""} reason=no_reply_target`,
    );
    return;
  }
  console.log(
    `[codeksei] approval prompt sending binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""}`,
  );
  await ignoreBestEffortError(dependencies.channelAdapter.sendTyping({
    userId: target.userId,
    status: 0,
    contextToken: target.contextToken,
  }), {
    label: "approval prompt typing stop",
    reason: "approval prompt typing stop is best-effort cleanup before the prompt send",
  });
  await dependencies.channelAdapter.sendText({
    userId: target.userId,
    text: dependencies.buildApprovalPromptText(approval),
    contextToken: target.contextToken,
    preserveBlock: true,
  });
  console.log(
    `[codeksei] approval prompt delivered binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""}`,
  );
}

export async function restoreBoundThreadSubscriptions(
  dependencies: RuntimeWatchdogApprovalDependencies,
): Promise<void> {
  const sessionStore = dependencies.runtimeAdapter.getSessionStore();
  const bindings = sessionStore.listBindings();
  const seenThreadIds = new Set<string>();

  for (const binding of bindings) {
    const bindingKey = dependencies.normalizeText(binding?.bindingKey);
    if (!bindingKey) {
      continue;
    }

    const target = dependencies.resolveReplyTargetForBinding(bindingKey);
    if (target) {
      dependencies.streamDelivery.setReplyTarget(bindingKey, target);
    }

    const threadIdByWorkspaceRoot = binding?.threadIdByWorkspaceRoot && typeof binding.threadIdByWorkspaceRoot === "object"
      ? binding.threadIdByWorkspaceRoot
      : {};
    for (const threadId of Object.values(threadIdByWorkspaceRoot)) {
      const normalizedThreadId = dependencies.normalizeCommandArgument(threadId);
      if (!normalizedThreadId || seenThreadIds.has(normalizedThreadId)) {
        continue;
      }
      seenThreadIds.add(normalizedThreadId);
      await ignoreBestEffortError(dependencies.runtimeAdapter.resumeThread({ threadId: normalizedThreadId }), {
        label: "watchdog thread resume",
        reason: "subscription restore should keep hydrating later bindings even if one resume fails",
      });
    }
  }

  for (const entry of sessionStore.listPendingApprovals()) {
    dependencies.threadStateStore.hydratePendingApproval(entry.threadId, entry.approval);
  }
}

export async function clearPendingApproval(sessionWriter: SessionStoreWriterLike, threadId: unknown): Promise<void> {
  if (typeof sessionWriter.clearPendingApprovalForThread === "function") {
    await sessionWriter.clearPendingApprovalForThread(threadId);
    return;
  }
  if (typeof sessionWriter.clearApprovalPrompt === "function") {
    await sessionWriter.clearApprovalPrompt(threadId);
  }
}

export function normalizePendingApprovalState(
  payload: UnknownRecord,
  threadId: string,
  normalizeText: NormalizeText,
): PendingApprovalState {
  const commandTokens = Array.isArray(payload.commandTokens)
    ? payload.commandTokens
      .map((token) => normalizeText(token))
      .filter(Boolean)
    : [];
  return {
    threadId,
    requestId: normalizeText(payload.requestId),
    reason: normalizeText(payload.reason),
    command: normalizeText(payload.command),
    commandTokens,
    signature: normalizeText(payload.signature),
    promptedAt: normalizeText(payload.promptedAt),
  };
}
