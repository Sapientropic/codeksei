// @ts-check

const {
  RUNTIME_EVENT_TYPES,
  createRuntimeEvent,
  normalizeRuntimeText,
} = require("../../../contracts/runtime-events");
const {
  extractAssistantDeltaFragment,
  extractAssistantPhase,
  extractCompletedAssistantText,
  extractFailureText,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
} = require("./message-utils");
const { splitCommandLine } = require("../../../core/approval-command-policy");

function mapCodexMessageToRuntimeEvent(message) {
  if (message?.type === "event_msg" && message?.payload?.type === "token_count") {
    return createRuntimeEvent(RUNTIME_EVENT_TYPES.USAGE_UPDATED, message.payload);
  }

  const method = normalizeRuntimeText(message?.method);
  const params = message?.params || {};
  const threadId = extractThreadIdFromParams(params);
  const turnId = extractTurnIdFromParams(params);

  if (!method) {
    return null;
  }

  if (method === "turn/started" || method === "turn/start") {
    return createRuntimeEvent(RUNTIME_EVENT_TYPES.TURN_STARTED, {
      threadId,
      turnId,
    });
  }

  if (method === "turn/completed") {
    return createRuntimeEvent(RUNTIME_EVENT_TYPES.TURN_COMPLETED, {
      threadId,
      turnId,
    });
  }

  if (method === "turn/failed") {
    return createRuntimeEvent(RUNTIME_EVENT_TYPES.TURN_FAILED, {
      threadId,
      turnId,
      text: extractFailureText(params),
    });
  }

  if (method === "item/agentMessage/delta") {
    const fragment = extractAssistantDeltaFragment(params);
    const phase = extractAssistantPhase(params);
    if (!fragment.text) {
      return null;
    }
    return createRuntimeEvent(RUNTIME_EVENT_TYPES.REPLY_DELTA, {
      threadId,
      turnId,
      itemId: normalizeRuntimeText(params?.itemId || params?.item?.id),
      text: fragment.text,
      fragmentKind: fragment.fragmentKind,
      phase,
    });
  }

  if (method === "item/completed" && normalizeRuntimeText(params?.item?.type).toLowerCase() === "agentmessage") {
    const text = extractCompletedAssistantText(params);
    const phase = extractAssistantPhase(params);
    return createRuntimeEvent(RUNTIME_EVENT_TYPES.REPLY_COMPLETED, {
      threadId,
      turnId,
      itemId: normalizeRuntimeText(params?.item?.id),
      text,
      phase,
    });
  }

  if (isApprovalRequestMethod(method)) {
    return createRuntimeEvent(RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED, {
      threadId,
      requestId: message?.id ?? null,
      reason: normalizeRuntimeText(params?.reason),
      command: extractApprovalDisplayCommand(params),
      commandTokens: extractApprovalCommandTokens(params),
    });
  }

  return null;
}

function isApprovalRequestMethod(method) {
  return typeof method === "string" && method.endsWith("requestApproval");
}

function extractApprovalDisplayCommand(params) {
  const commandTokens = extractApprovalCommandTokens(params);
  const direct = params?.command;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  if (Array.isArray(direct)) {
    const normalized = normalizeCommandTokens(direct);
    if (normalized.length) {
      return buildApprovalCommandPreview(normalized);
    }
  }
  return buildApprovalCommandPreview(commandTokens);
}

function extractApprovalCommandTokens(params) {
  return normalizeCommandTokens(extractTokens(params));
}

function extractTokens(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === "string")
      ? value.map((entry) => entry.trim()).filter(Boolean)
      : [];
  }
  if (typeof value === "string") {
    return splitCommandLine(value);
  }
  if (typeof value !== "object") {
    return [];
  }

  for (const key of ["proposedExecpolicyAmendment", "argv", "args", "command", "cmd", "exec", "shellCommand", "script"]) {
    const tokens = extractTokens(value[key]);
    if (tokens.length) {
      return tokens;
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes("execpolicy") || normalizedKey.includes("exec_policy")) {
      const tokens = extractTokens(nested);
      if (tokens.length) {
        return tokens;
      }
    }
  }

  return [];
}

function buildApprovalCommandPreview(tokens) {
  const normalized = normalizeCommandTokens(tokens);
  if (!normalized.length) {
    return "";
  }
  return normalized.map((token) => (token.includes(" ") ? JSON.stringify(token) : token)).join(" ");
}

function normalizeCommandTokens(tokens) {
  return Array.isArray(tokens)
    ? tokens.map((part) => normalizeRuntimeText(part)).filter(Boolean)
    : [];
}

module.exports = { mapCodexMessageToRuntimeEvent };
