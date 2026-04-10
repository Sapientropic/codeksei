const { sanitizeProtocolLeakText } = require("../adapters/runtime/codex/protocol-leak-monitor");

class StreamDelivery {
  constructor({ channelAdapter, sessionStore, onDeliveryFailure = null }) {
    this.channelAdapter = channelAdapter;
    this.sessionStore = sessionStore;
    this.onDeliveryFailure = typeof onDeliveryFailure === "function" ? onDeliveryFailure : null;
    this.replyTargetByBindingKey = new Map();
    this.pendingReplyTargetsByThreadId = new Map();
    this.stateByRunKey = new Map();
    this.ignoredRunKeys = new Set();
  }

  setReplyTarget(bindingKey, target) {
    if (!bindingKey || !target?.userId || !target?.contextToken) {
      return;
    }
    this.replyTargetByBindingKey.set(bindingKey, {
      userId: String(target.userId).trim(),
      contextToken: String(target.contextToken).trim(),
      provider: normalizeText(target.provider),
    });
  }

  queueReplyTargetForThread(threadId, target) {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId || !target?.userId || !target?.contextToken) {
      return;
    }
    const queue = this.pendingReplyTargetsByThreadId.get(normalizedThreadId) || [];
    queue.push({
      userId: String(target.userId).trim(),
      contextToken: String(target.contextToken).trim(),
      provider: normalizeText(target.provider),
    });
    this.pendingReplyTargetsByThreadId.set(normalizedThreadId, queue);
  }

  async handleRuntimeEvent(event) {
    const threadId = normalizeText(event?.payload?.threadId);
    const turnId = normalizeText(event?.payload?.turnId);
    if (!threadId) {
      return;
    }
    const ignoredRunKey = turnId ? buildRunKey(threadId, turnId) : "";
    if (ignoredRunKey && this.ignoredRunKeys.has(ignoredRunKey)) {
      if (event.type === "runtime.turn.completed" || event.type === "runtime.turn.failed") {
        this.ignoredRunKeys.delete(ignoredRunKey);
      }
      return;
    }

    switch (event.type) {
      case "runtime.turn.started": {
        const state = this.ensureRunState(threadId, turnId);
        state.turnId = turnId || state.turnId;
        this.attachReplyTarget(state);
        return;
      }
      case "runtime.reply.delta": {
        const state = this.ensureRunState(threadId, turnId);
        this.upsertItem(state, {
          itemId: normalizeText(event.payload.itemId) || `item-${state.itemOrder.length + 1}`,
          text: normalizeLineEndings(event.payload.text),
          completed: false,
        });
        return;
      }
      case "runtime.reply.completed": {
        const state = this.ensureRunState(threadId, turnId);
        this.upsertItem(state, {
          itemId: normalizeText(event.payload.itemId) || `item-${state.itemOrder.length + 1}`,
          text: normalizeLineEndings(event.payload.text),
          completed: true,
        });
        await this.flush(state, { force: false });
        return;
      }
      case "runtime.turn.completed": {
        const state = this.ensureRunState(threadId, turnId);
        state.turnId = turnId || state.turnId;
        await this.flush(state, { force: true });
        this.disposeRunState(state.runKey);
        return;
      }
      case "runtime.turn.failed":
        this.disposeRunState(buildRunKey(threadId, turnId));
        return;
      default:
        return;
    }
  }

  async finishTurn({ threadId, finalText }) {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedFinalText = normalizeLineEndings(finalText);
    if (!normalizedThreadId || !normalizedFinalText) {
      return;
    }

    const state = this.ensureRunState(normalizedThreadId, "");
    this.attachReplyTarget(state);
    if (!state.itemOrder.length) {
      this.upsertItem(state, {
        itemId: "final",
        text: normalizedFinalText,
        completed: true,
      });
    } else {
      const itemId = state.itemOrder[state.itemOrder.length - 1] || "final";
      this.setItemText(state, itemId, normalizedFinalText, true);
      for (const candidateId of state.itemOrder) {
        const item = state.items.get(candidateId);
        if (item) {
          item.currentText = item.completedText || item.currentText;
          item.completed = true;
        }
      }
    }

    await this.flush(state, { force: true });
    this.disposeRunState(state.runKey);
  }

  async finalizeAbandonedTurn({ threadId, turnId = "", trailingText = "" }) {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const normalizedTrailingText = normalizeLineEndings(trailingText).trim();
    if (!normalizedThreadId) {
      return;
    }

    const state = this.findRunState(normalizedThreadId, normalizedTurnId);
    if (!state) {
      if (normalizedTrailingText) {
        await this.finishTurn({
          threadId: normalizedThreadId,
          finalText: normalizedTrailingText,
        });
      }
      return;
    }

    this.attachReplyTarget(state);
    if (normalizedTrailingText) {
      this.upsertItem(state, {
        itemId: "__watchdog__",
        text: normalizedTrailingText,
        completed: true,
      });
    }
    await this.flush(state, { force: true });
    this.ignoredRunKeys.add(state.runKey);
    this.disposeRunState(state.runKey);
  }

  ensureRunState(threadId, turnId = "") {
    const runKey = buildRunKey(threadId, turnId);
    const existing = this.stateByRunKey.get(runKey);
    if (existing) {
      return existing;
    }

    const created = {
      runKey,
      threadId,
      bindingKey: "",
      replyTarget: null,
      turnId: normalizeText(turnId),
      itemOrder: [],
      items: new Map(),
      sentText: "",
      sendChain: Promise.resolve(),
      flushPromise: null,
    };
    this.stateByRunKey.set(runKey, created);
    this.attachReplyTarget(created);
    return created;
  }

  findRunState(threadId, turnId = "") {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedThreadId) {
      return null;
    }
    if (normalizedTurnId) {
      const exact = this.stateByRunKey.get(buildRunKey(normalizedThreadId, normalizedTurnId));
      if (exact) {
        return exact;
      }
    }
    const pending = this.stateByRunKey.get(buildRunKey(normalizedThreadId, ""));
    if (pending && (!normalizedTurnId || !pending.turnId || pending.turnId === normalizedTurnId)) {
      return pending;
    }
    for (const candidate of this.stateByRunKey.values()) {
      if (candidate.threadId !== normalizedThreadId) {
        continue;
      }
      if (!normalizedTurnId || candidate.turnId === normalizedTurnId) {
        return candidate;
      }
    }
    return null;
  }

  attachReplyTarget(state) {
    if (!state.replyTarget) {
      const queue = this.pendingReplyTargetsByThreadId.get(state.threadId) || [];
      if (queue.length) {
        state.replyTarget = queue.shift();
        if (queue.length) {
          this.pendingReplyTargetsByThreadId.set(state.threadId, queue);
        } else {
          this.pendingReplyTargetsByThreadId.delete(state.threadId);
        }
      }
    }
    const linked = this.sessionStore.findBindingForThreadId(state.threadId);
    if (!linked?.bindingKey) {
      return;
    }
    state.bindingKey = linked.bindingKey;
    if (!state.replyTarget) {
      const target = this.replyTargetByBindingKey.get(linked.bindingKey);
      state.replyTarget = target;
    }
  }

  upsertItem(state, { itemId, text, completed }) {
    if (!text) {
      return;
    }
    if (!state.items.has(itemId)) {
      state.itemOrder.push(itemId);
      state.items.set(itemId, {
        currentText: "",
        completedText: "",
        completed: false,
      });
    }

    const current = state.items.get(itemId);
    if (completed) {
      const merged = mergeCompletedItemText(current.currentText, text);
      current.currentText = merged;
      current.completedText = merged;
      current.completed = true;
      return;
    }

    current.currentText = appendStreamingText(current.currentText, text);
  }

  setItemText(state, itemId, text, completed) {
    if (!text) {
      return;
    }
    if (!state.items.has(itemId)) {
      state.itemOrder.push(itemId);
      state.items.set(itemId, {
        currentText: "",
        completedText: "",
        completed: false,
      });
    }

    const current = state.items.get(itemId);
    current.currentText = text;
    if (completed) {
      current.completedText = text;
    }
    current.completed = Boolean(completed);
  }

  async flush(state, { force }) {
    const previous = state.flushPromise || Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(() => this.flushNow(state, { force }));
    const tracked = current.finally(() => {
      const latestState = this.stateByRunKey.get(state.runKey);
      if (latestState && latestState.flushPromise === tracked) {
        latestState.flushPromise = null;
      }
    });
    state.flushPromise = tracked;
    await tracked;
  }

  async flushNow(state, { force }) {
    if (!state.replyTarget) {
      return;
    }

    const plainText = markdownToPlainText(buildReplyText(state, { completedOnly: !force }));
    const sanitized = sanitizeReplyText(state.replyTarget, plainText);
    if (sanitized.suppress) {
      state.sentText = sanitized.text;
      console.log(`[cyberboss] suppressed system reply thread=${state.threadId} preview=${JSON.stringify(plainText.slice(0, 80))}`);
      return;
    }
    const safeText = sanitized.text;
    if (!safeText || safeText === state.sentText) {
      return;
    }

    if (state.sentText && !safeText.startsWith(state.sentText)) {
      console.warn(`[cyberboss] skip non-monotonic reply thread=${state.threadId}`);
      return;
    }

    const delta = safeText.slice(state.sentText.length);
    if (!delta) {
      return;
    }

    if (!delta.trim()) {
      state.sentText = safeText;
      return;
    }

    state.sendChain = state.sendChain.then(async () => {
      await this.channelAdapter.sendText({
        userId: state.replyTarget.userId,
        text: delta,
        contextToken: state.replyTarget.contextToken,
      });
      state.sentText = safeText;
    }).catch((error) => {
      console.error(`[cyberboss] failed to deliver reply thread=${state.threadId}: ${error.message}`);
      this.handleDeliveryFailure(state, error);
    });

    await state.sendChain;
  }

  handleDeliveryFailure(state, error) {
    if (!state?.runKey) {
      return;
    }
    // Once WeChat delivery has exhausted its retries for this run, continuing
    // to stream later deltas only creates repeated send failures and fake typing.
    this.ignoredRunKeys.add(state.runKey);
    this.disposeRunState(state.runKey);
    if (!this.onDeliveryFailure) {
      return;
    }
    Promise.resolve(this.onDeliveryFailure({
      threadId: state.threadId,
      turnId: state.turnId,
      bindingKey: state.bindingKey,
      error,
      sentText: state.sentText,
      replyTarget: state.replyTarget ? { ...state.replyTarget } : null,
    })).catch((callbackError) => {
      console.error(`[cyberboss] delivery failure callback crashed thread=${state.threadId}: ${callbackError.message}`);
    });
  }

  disposeRunState(runKey) {
    const normalizedRunKey = normalizeText(runKey);
    if (!normalizedRunKey) {
      return;
    }
    this.stateByRunKey.delete(normalizedRunKey);
  }
}

function buildRunKey(threadId, turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  return normalizedTurnId
    ? `${normalizedThreadId}:${normalizedTurnId}`
    : `${normalizedThreadId}:pending`;
}

function buildReplyText(state, { completedOnly }) {
  const parts = [];
  for (const itemId of state.itemOrder) {
    const item = state.items.get(itemId);
    if (!item) {
      continue;
    }

    const sourceText = completedOnly
      ? (item.completed ? item.completedText : "")
      : (item.completed ? item.completedText : item.currentText);
    const normalized = trimOuterBlankLines(sourceText);
    if (normalized) {
      parts.push(normalized);
    }
  }
  return parts.join("\n\n");
}

function markdownToPlainText(text) {
  let result = normalizeLineEndings(text);
  result = result.replace(/```([^\n]*)\n?([\s\S]*?)```/g, (_, language, code) => {
    const label = String(language || "").trim();
    const body = indentBlock(String(code || ""));
    return label ? `\n${label}:\n${body}\n` : `\n代码:\n${body}\n`;
  });
  result = result.replace(/```([^\n]*)\n?([\s\S]*)$/g, (_, language, code) => {
    const label = String(language || "").trim();
    const body = indentBlock(String(code || ""));
    return label ? `\n${label}:\n${body}\n` : `\n代码:\n${body}\n`;
  });
  result = result.replace(/!\[[^\]]*]\([^)]*\)/g, "");
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/^#{1,6}\s*(.+)$/gm, "$1");
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/\*([^*]+)\*/g, "$1");
  result = result.replace(/^>\s?/gm, "> ");
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_, inner) =>
    String(inner || "").split("|").map((cell) => cell.trim()).join("  ")
  );
  result = result.replace(/\n{3,}/g, "\n\n");
  return trimOuterBlankLines(result);
}

function appendStreamingText(current, next) {
  const base = String(current || "");
  const incoming = String(next || "");
  if (!incoming) {
    return base;
  }
  if (!base) {
    return incoming;
  }
  if (base.endsWith(incoming)) {
    return base;
  }
  if (incoming.startsWith(base)) {
    return incoming;
  }

  const maxOverlap = Math.min(base.length, incoming.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (base.slice(-size) === incoming.slice(0, size)) {
      return `${base}${incoming.slice(size)}`;
    }
  }

  return `${base}${incoming}`;
}

function mergeCompletedItemText(current, completed) {
  const streamed = String(current || "");
  const finalized = String(completed || "");
  if (!finalized) {
    return streamed;
  }
  if (!streamed) {
    return finalized;
  }
  return appendStreamingText(streamed, finalized);
}

function indentBlock(text) {
  const normalized = trimOuterBlankLines(normalizeLineEndings(text));
  if (!normalized) {
    return "";
  }
  return normalized.split("\n").map((line) => `    ${line}`).join("\n");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLineEndings(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function trimOuterBlankLines(text) {
  return String(text || "")
    .replace(/^\s*\n+/g, "")
    .replace(/\n+\s*$/g, "");
}

function shouldSuppressSystemReply(replyTarget, plainReplyText) {
  if (replyTarget?.provider !== "system") {
    return false;
  }
  const normalized = normalizeLineEndings(String(plainReplyText || ""));
  const compact = normalized.trim();
  if (!compact) {
    return false;
  }
  const sentinelNormalized = normalizeSilentSentinelText(compact);
  if (compact === "CB_SILENT" || compact === "__SILENT__" || compact === "SILENT") {
    return true;
  }
  if (containsStructuredSilentSignal(normalized)) {
    return true;
  }
  if (compact.toUpperCase().includes("CB_SILENT") || compact.toUpperCase().includes("__SILENT__")) {
    return true;
  }
  if (sentinelNormalized.includes("CB_SILENT") || sentinelNormalized.includes("__SILENT__") || sentinelNormalized.includes("SILENT")) {
    return true;
  }
  return normalized
    .split("\n")
    .map((line) => normalizeSilentSentinelText(line.trim()))
    .some((line) => line === "CB_SILENT" || line === "__SILENT__" || line === "SILENT");
}

function sanitizeReplyText(replyTarget, plainReplyText) {
  const normalized = normalizeLineEndings(String(plainReplyText || ""));
  if (!normalized) {
    return { suppress: false, text: "" };
  }
  const protocolSanitized = sanitizeProtocolLeakText(normalized);
  const safeText = protocolSanitized.text || "";
  if (shouldSuppressSystemReply(replyTarget, safeText)) {
    return { suppress: true, text: "" };
  }
  const cleaned = stripSilentSentinelArtifacts(safeText);
  return {
    suppress: false,
    text: trimOuterBlankLines(cleaned),
  };
}

function normalizeSilentSentinelText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z_]/g, "");
}

function stripSilentSentinelArtifacts(value) {
  return normalizeLineEndings(String(value || ""))
    .replace(/\{\s*"cyberboss_action"\s*:\s*"silent"\s*\}/gi, "")
    .split("\n")
    .map((line) => {
      const parts = line.split(/\s+/);
      const kept = parts.filter((part) => !isSilentSentinelToken(part));
      return kept.join(" ").trim();
    })
    .filter((line, index, lines) => line || (index > 0 && index < lines.length - 1))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function isSilentSentinelToken(value) {
  const normalized = normalizeSilentSentinelText(value);
  return normalized === "CB_SILENT" || normalized === "__SILENT__" || normalized === "SILENT";
}

function containsStructuredSilentSignal(value) {
  return /\{\s*"cyberboss_action"\s*:\s*"silent"\s*\}/i.test(String(value || ""));
}

module.exports = { StreamDelivery };
