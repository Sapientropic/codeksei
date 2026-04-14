import { normalizeText } from "./text-normalization";
import type { SystemMessage } from "../contracts/queue-items";
import type { NormalizedIncomingMessage } from "./runtime-types";
import { resolvePromptPersonEn } from "../contracts/person-reference";

interface SystemMessageDispatcherConfig {
  workspaceId: string;
  workspaceRoot: string;
  userName?: unknown;
}

interface SystemMessageDeferOptions {
  delayMs?: number;
  reason?: string;
  countAttempt?: boolean;
  nowMs?: number;
}

interface SystemMessageDeadLetterOptions {
  reason?: string;
  nowMs?: number;
}

interface SystemMessageCompleteOptions {
  nowMs?: number;
}

interface SystemMessageQueueMutationResult {
  status: string;
  message?: SystemMessage | null;
}

interface SystemMessageQueueStoreLike {
  complete(message: SystemMessage, options?: SystemMessageCompleteOptions): SystemMessageQueueMutationResult;
  deadLetter(message: SystemMessage, options?: SystemMessageDeadLetterOptions): SystemMessageQueueMutationResult;
  defer(message: SystemMessage, options?: SystemMessageDeferOptions): SystemMessageQueueMutationResult | null;
  hasPendingForAccount(accountId: string): boolean;
  takeReadyForAccount(accountId: string, options?: { nowMs?: number }): SystemMessage[];
}

class SystemMessageDispatcher {
  accountId: string;
  config: SystemMessageDispatcherConfig;
  queueStore: SystemMessageQueueStoreLike;

  constructor({
    queueStore,
    config,
    accountId,
  }: {
    queueStore: SystemMessageQueueStoreLike;
    config: SystemMessageDispatcherConfig;
    accountId: string;
  }) {
    this.queueStore = queueStore;
    this.config = config;
    this.accountId = accountId;
  }

  hasPending(): boolean {
    return this.queueStore.hasPendingForAccount(this.accountId);
  }

  takeReadyPending(nowMs: number = Date.now()): SystemMessage[] {
    return this.queueStore.takeReadyForAccount(this.accountId, { nowMs });
  }

  defer(message: SystemMessage, options: SystemMessageDeferOptions = {}): SystemMessageQueueMutationResult | null {
    return this.queueStore.defer(message, options);
  }

  deadLetter(message: SystemMessage, options: SystemMessageDeadLetterOptions = {}): SystemMessageQueueMutationResult {
    return this.queueStore.deadLetter(message, options);
  }

  complete(message: SystemMessage, options: SystemMessageCompleteOptions = {}): SystemMessageQueueMutationResult {
    return this.queueStore.complete(message, options);
  }

  resolveWorkspaceRoot(message: Pick<SystemMessage, "workspaceRoot"> | null | undefined): string {
    return normalizeText(message?.workspaceRoot) || normalizeText(this.config.workspaceRoot);
  }

  buildPreparedMessage(message: SystemMessage, contextToken: string = ""): NormalizedIncomingMessage {
    return {
      provider: "system",
      workspaceId: this.config.workspaceId,
      accountId: this.accountId,
      chatId: message.senderId,
      threadKey: `system:${message.senderId}`,
      senderId: message.senderId,
      messageId: message.id,
      text: buildSystemInboundText(message.text, this.config),
      attachments: [],
      command: "message",
      contextToken,
      receivedAt: normalizeIsoTime(message.createdAt) || new Date().toISOString(),
      systemMessageKind: normalizeText(message.kind),
      checkinTriggerId: normalizeText(message.checkinTriggerId),
      workspaceRoot: this.resolveWorkspaceRoot(message),
    };
  }
}

function buildSystemInboundText(text: unknown, config: SystemMessageDispatcherConfig): string {
  const body = normalizeText(text);
  const person = resolvePromptPersonEn(config);
  if (!body) {
    return `System trigger.\nThis message stays backstage and is not visible to ${person}.`;
  }
  return `System trigger.\nThis message stays backstage and is not visible to ${person}.\n${body}`;
}

function normalizeIsoTime(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString();
}

export { SystemMessageDispatcher };

