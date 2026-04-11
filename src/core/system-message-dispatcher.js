const { resolvePromptPersonEn } = require("./person-reference");

class SystemMessageDispatcher {
  constructor({ queueStore, config, accountId }) {
    this.queueStore = queueStore;
    this.config = config;
    this.accountId = accountId;
  }

  hasPending() {
    return this.queueStore.hasPendingForAccount(this.accountId);
  }

  takeReadyPending(nowMs = Date.now()) {
    return this.queueStore.takeReadyForAccount(this.accountId, { nowMs });
  }

  defer(message, options = {}) {
    return this.queueStore.defer(message, options);
  }

  deadLetter(message, options = {}) {
    return this.queueStore.deadLetter(message, options);
  }

  complete(message, options = {}) {
    return this.queueStore.complete(message, options);
  }

  resolveWorkspaceRoot(message) {
    return normalizeText(message?.workspaceRoot) || normalizeText(this.config.workspaceRoot);
  }

  buildPreparedMessage(message, contextToken = "") {
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

function buildSystemInboundText(text, config = {}) {
  const body = normalizeText(text);
  const person = resolvePromptPersonEn(config);
  if (!body) {
    return `System trigger.\nThis message stays backstage and is not visible to ${person}.`;
  }
  return `System trigger.\nThis message stays backstage and is not visible to ${person}.\n${body}`;
}

function normalizeIsoTime(value) {
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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { SystemMessageDispatcher };
