import type {
  ChannelAdapterLike,
  RuntimeAdapterLike,
  SessionStoreWriterLike,
  StreamDeliveryLike,
  ThreadStateStoreLike,
} from "../core/app-service-contract";
import type {
  PendingApprovalState,
  ReplyTarget,
} from "../core/runtime-types";
import {
  clearPendingApproval,
  stopTypingForThread,
  type RuntimeWatchdogApprovalDependencies,
} from "./runtime-watchdog-approval";
import type { RuntimeWatchdogTimerDependencies } from "./runtime-watchdog-timers";

type BuildApprovalPromptSignature = (approval: PendingApprovalState) => string;
type BuildApprovalPromptText = (approval: PendingApprovalState) => string;
type MatchesBuiltInCommandPrefix = (commandTokens: unknown) => boolean;
type MatchesCommandPrefix = (commandTokens: unknown, allowlist: string[][]) => boolean;
type NormalizeCommandArgument = (value: unknown) => string;
type NormalizeText = (value: unknown) => string;
type ResolveReplyTargetForBinding = (bindingKey: string) => ReplyTarget | null;

export interface RuntimeWatchdogDependencyArgs {
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

export function buildRuntimeWatchdogDependencies({
  buildApprovalPromptSignature,
  buildApprovalPromptText,
  channelAdapter,
  matchesBuiltInCommandPrefix,
  matchesCommandPrefix,
  normalizeCommandArgument,
  normalizeText,
  resolveReplyTargetForBinding,
  runtimeAdapter,
  sessionWriter,
  streamDelivery,
  streamSettlementTimeoutMs,
  threadStateStore,
  firstRuntimeEventFailureTimeoutMs,
  firstRuntimeEventNoticeTimeoutMs,
}: RuntimeWatchdogDependencyArgs): {
  approvalDependencies: RuntimeWatchdogApprovalDependencies;
  timerDependencies: RuntimeWatchdogTimerDependencies;
} {
  const approvalDependencies: RuntimeWatchdogApprovalDependencies = {
    buildApprovalPromptSignature,
    buildApprovalPromptText,
    channelAdapter,
    matchesBuiltInCommandPrefix,
    matchesCommandPrefix,
    normalizeCommandArgument,
    normalizeText,
    resolveReplyTargetForBinding,
    runtimeAdapter,
    sessionWriter,
    streamDelivery,
    threadStateStore,
  };
  const timerDependencies: RuntimeWatchdogTimerDependencies = {
    channelAdapter,
    runtimeAdapter,
    streamDelivery,
    threadStateStore,
    firstRuntimeEventFailureTimeoutMs,
    firstRuntimeEventNoticeTimeoutMs,
    streamSettlementTimeoutMs,
    normalizeCommandArgument,
    normalizeText,
    clearPendingApproval: (threadId) => clearPendingApproval(sessionWriter, threadId),
    rememberWorkspaceBootstrapForThread: (bindingKey, workspaceRoot, threadId) => (
      sessionWriter.rememberWorkspaceBootstrapForThread(bindingKey, workspaceRoot, threadId)
    ),
    stopTypingForThread: (threadId) => stopTypingForThread(approvalDependencies, threadId),
  };
  return {
    approvalDependencies,
    timerDependencies,
  };
}
