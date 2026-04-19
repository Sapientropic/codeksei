import type { PendingApprovalRecord } from "../contracts/session-state";

export type UnknownRecord = Record<string, unknown>;

export interface ReplyTarget {
  userId: string;
  contextToken: string;
  provider: string;
}

export interface AttachmentFailure {
  kind?: string;
  sourceFileName?: string;
  reason: string;
}

export interface PendingProactiveHandoffRuntimePayload {
  bookkeepingActions: string[];
  followupContext: string;
  handoffCreatedAt: string;
  handoffExpiresAt: string;
  observedCurrentState: string;
  outcome: string;
  triggerId: string;
  userVisibleMessage: string;
}

export interface NormalizedIncomingMessage extends UnknownRecord {
  provider: string;
  workspaceId: string;
  accountId: string;
  chatId: string;
  threadKey: string;
  senderId: string;
  messageId: string;
  text: string;
  attachments: unknown[];
  command: string;
  contextToken: string;
  receivedAt: string;
  systemMessageKind?: string;
  checkinTriggerId?: string;
  workspaceRoot?: string;
}

export interface PreparedRuntimeMessage extends NormalizedIncomingMessage {
  originalText: string;
  attachments: unknown[];
  attachmentFailures: AttachmentFailure[];
  pendingProactiveHandoff?: PendingProactiveHandoffRuntimePayload | null;
  workspaceRoot: string;
}

export interface RuntimeTurnSendState {
  threadId: string;
  workspaceBootstrapPending: boolean;
}

export interface RuntimeTurnSentResult {
  status: "sent";
  threadId: string;
}

export interface RuntimeTurnSkippedResult {
  status: "skipped";
  reason: string;
}

export interface RuntimeTurnRetryableErrorResult {
  status: "retryable_error";
  reason: string;
  error?: unknown;
}

export type RuntimeTurnSendResult =
  | RuntimeTurnSentResult
  | RuntimeTurnSkippedResult
  | RuntimeTurnRetryableErrorResult;

export interface HandlePreparedMessageOptions {
  allowCommands: boolean;
  reportFailureToUser?: boolean;
  throwOnFailure?: boolean;
}

export interface UserTypingOptions {
  userId: string;
  contextToken?: string;
  clearOnSuccess?: boolean;
}

export interface SendLocalFileRequest {
  senderId?: string;
  filePath?: string;
}

export interface ThreadBindingRef {
  bindingKey: string;
  workspaceRoot: string;
}

export interface PendingApprovalState extends PendingApprovalRecord {
  threadId?: string;
}

export interface DeliveryFailurePayload {
  threadId: string;
  turnId?: string;
  error: unknown;
  sentText?: string;
  replyTarget?: ReplyTarget | null;
  bindingKey?: string;
}

export interface SystemDispatchResult {
  status: "sent" | "deferred_busy" | "dead_letter" | "retryable_error";
  reason: string;
}
