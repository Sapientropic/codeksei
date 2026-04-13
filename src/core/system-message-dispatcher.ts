import { resolvePromptPersonEn } from "./person-reference";


class SystemMessageDispatcher {
  accountId: any;
  config: any;
  queueStore: any;

  constructor({ queueStore, config, accountId }: any) {
    this.queueStore = queueStore;
    this.config = config;
    this.accountId = accountId;
  }

  hasPending() {
    return this.queueStore.hasPendingForAccount(this.accountId);
  }

  takeReadyPending(nowMs: any = Date.now()) {
    return this.queueStore.takeReadyForAccount(this.accountId, { nowMs });
  }

  defer(message: any, options: any = {}) {
    return this.queueStore.defer(message, options);
  }

  deadLetter(message: any, options: any = {}) {
    return this.queueStore.deadLetter(message, options);
  }

  complete(message: any, options: any = {}) {
    return this.queueStore.complete(message, options);
  }

  resolveWorkspaceRoot(message: any) {
    return normalizeText(message?.workspaceRoot) || normalizeText(this.config.workspaceRoot);
  }

  buildPreparedMessage(message: any, contextToken: string = "") {
    return {
      provider: "system",
      workspaceId: this.config.workspaceId,
      accountId: this.accountId,
      chatId: message.senderId,
      threadKey: `system:${message.senderId}`,
      senderId: message.senderId,
      messageId: message.id,
      text: buildSystemInboundText(message?.text, this.config),
      attachments: [],
      command: "message",
      contextToken,
      receivedAt: normalizeIsoTime(message?.createdAt) || new Date().toISOString(),
      workspaceRoot: this.resolveWorkspaceRoot(message),
    };
  }
}

function buildSystemInboundText(text: any, config: any = {}) {
  const body = normalizeText(text);
  const person = resolvePromptPersonEn(config);
  if (!body) {
    return `System trigger.\nThis message stays backstage and is not visible to ${person}.`;
  }
  return `System trigger.\nThis message stays backstage and is not visible to ${person}.\n${body}`;
}

function normalizeIsoTime(value: any) {
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

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

export { SystemMessageDispatcher };
