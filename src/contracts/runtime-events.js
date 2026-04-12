// @ts-check

const RUNTIME_EVENT_TYPES = Object.freeze({
  USAGE_UPDATED: "runtime.usage.updated",
  TURN_STARTED: "runtime.turn.started",
  TURN_COMPLETED: "runtime.turn.completed",
  TURN_FAILED: "runtime.turn.failed",
  REPLY_DELTA: "runtime.reply.delta",
  REPLY_COMPLETED: "runtime.reply.completed",
  APPROVAL_REQUESTED: "runtime.approval.requested",
});

const RUNTIME_EVENT_TYPE_LIST = Object.freeze(Object.values(RUNTIME_EVENT_TYPES));
const RUNTIME_REPLY_EVENT_TYPES = Object.freeze([
  RUNTIME_EVENT_TYPES.REPLY_DELTA,
  RUNTIME_EVENT_TYPES.REPLY_COMPLETED,
]);
const RUNTIME_TURN_TERMINAL_EVENT_TYPES = Object.freeze([
  RUNTIME_EVENT_TYPES.TURN_COMPLETED,
  RUNTIME_EVENT_TYPES.TURN_FAILED,
]);
const RUNTIME_TURN_LIFECYCLE_EVENT_TYPES = Object.freeze([
  RUNTIME_EVENT_TYPES.TURN_STARTED,
  ...RUNTIME_TURN_TERMINAL_EVENT_TYPES,
]);
const RUNTIME_CORE_CONSUMER_EXPECTATIONS = Object.freeze({
  threadStateStore: Object.freeze([...RUNTIME_EVENT_TYPE_LIST]),
  runtimeWatchdogLifecycle: Object.freeze([...RUNTIME_EVENT_TYPE_LIST]),
  streamDelivery: Object.freeze([
    RUNTIME_EVENT_TYPES.TURN_STARTED,
    RUNTIME_EVENT_TYPES.REPLY_DELTA,
    RUNTIME_EVENT_TYPES.REPLY_COMPLETED,
    RUNTIME_EVENT_TYPES.TURN_COMPLETED,
    RUNTIME_EVENT_TYPES.TURN_FAILED,
  ]),
});

function createRuntimeEvent(type, payload = {}) {
  const normalizedType = normalizeRuntimeEventType(type);
  if (!normalizedType) {
    return null;
  }
  return {
    type: normalizedType,
    payload: normalizeRuntimeEventPayload(normalizedType, payload),
  };
}

function normalizeRuntimeEventPayload(type, payload = {}) {
  switch (normalizeRuntimeEventType(type)) {
    case RUNTIME_EVENT_TYPES.USAGE_UPDATED:
      return normalizeRuntimeUsagePayload(payload);
    case RUNTIME_EVENT_TYPES.TURN_STARTED:
    case RUNTIME_EVENT_TYPES.TURN_COMPLETED:
      return normalizeRuntimeTurnPayload(payload);
    case RUNTIME_EVENT_TYPES.TURN_FAILED:
      return normalizeRuntimeFailurePayload(payload);
    case RUNTIME_EVENT_TYPES.REPLY_DELTA:
      return normalizeRuntimeReplyDeltaPayload(payload);
    case RUNTIME_EVENT_TYPES.REPLY_COMPLETED:
      return normalizeRuntimeReplyCompletedPayload(payload);
    case RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED:
      return normalizeRuntimeApprovalPayload(payload);
    default:
      return {};
  }
}

function normalizeRuntimeUsagePayload(payload = {}) {
  const info = isPlainObject(payload?.info) ? payload.info : {};
  const total = isPlainObject(info?.total_token_usage) ? info.total_token_usage : {};
  const last = isPlainObject(info?.last_token_usage) ? info.last_token_usage : {};
  const rateLimits = isPlainObject(payload?.rate_limits) ? payload.rate_limits : {};

  return {
    threadId: extractRuntimeIdentifierCandidate([
      payload?.threadId,
      payload?.thread_id,
      payload?.thread?.id,
      info?.threadId,
      info?.thread_id,
      info?.thread?.id,
      payload?.context?.threadId,
      payload?.context?.thread_id,
    ]),
    turnId: extractRuntimeIdentifierCandidate([
      payload?.turnId,
      payload?.turn_id,
      payload?.turn?.id,
      info?.turnId,
      info?.turn_id,
      info?.turn?.id,
      payload?.context?.turnId,
      payload?.context?.turn_id,
    ]),
    totalInputTokens: numberOrZero(total.input_tokens),
    totalCachedInputTokens: numberOrZero(total.cached_input_tokens),
    totalOutputTokens: numberOrZero(total.output_tokens),
    totalReasoningTokens: numberOrZero(total.reasoning_output_tokens),
    totalTokens: numberOrZero(total.total_tokens),
    lastInputTokens: numberOrZero(last.input_tokens),
    lastCachedInputTokens: numberOrZero(last.cached_input_tokens),
    lastOutputTokens: numberOrZero(last.output_tokens),
    lastReasoningTokens: numberOrZero(last.reasoning_output_tokens),
    lastTotalTokens: numberOrZero(last.total_tokens),
    modelContextWindow: numberOrZero(info?.model_context_window),
    primaryUsedPercent: numberOrZero(rateLimits?.primary?.used_percent),
    secondaryUsedPercent: numberOrZero(rateLimits?.secondary?.used_percent),
  };
}

function normalizeRuntimeTurnPayload(payload = {}) {
  return {
    threadId: normalizeRuntimeIdentifier(payload.threadId),
    turnId: normalizeRuntimeIdentifier(payload.turnId),
  };
}

function normalizeRuntimeFailurePayload(payload = {}) {
  return {
    ...normalizeRuntimeTurnPayload(payload),
    text: normalizeRuntimeText(payload.text),
  };
}

function normalizeRuntimeReplyDeltaPayload(payload = {}) {
  return {
    ...normalizeRuntimeTurnPayload(payload),
    itemId: normalizeRuntimeIdentifier(payload.itemId),
    text: normalizeRuntimeText(payload.text),
    fragmentKind: normalizeFragmentKind(payload.fragmentKind),
    phase: normalizeRuntimeReplyPhase(payload.phase),
  };
}

function normalizeRuntimeReplyCompletedPayload(payload = {}) {
  return {
    ...normalizeRuntimeTurnPayload(payload),
    itemId: normalizeRuntimeIdentifier(payload.itemId),
    text: normalizeRuntimeText(payload.text),
    phase: normalizeRuntimeReplyPhase(payload.phase),
  };
}

function normalizeRuntimeApprovalPayload(payload = {}) {
  const commandTokens = normalizeRuntimeCommandTokens(payload.commandTokens);
  return {
    threadId: normalizeRuntimeIdentifier(payload.threadId),
    requestId: normalizeRuntimeRequestId(payload.requestId),
    reason: normalizeRuntimeText(payload.reason),
    command: normalizeRuntimeText(payload.command) || buildApprovalCommandPreview(commandTokens),
    commandTokens,
    signature: normalizeRuntimeText(payload.signature),
    promptedAt: normalizeIsoTimestamp(payload.promptedAt),
  };
}

function normalizeRuntimeEventType(value) {
  const normalized = normalizeRuntimeText(value);
  return RUNTIME_EVENT_TYPE_LIST.some((entry) => entry === normalized) ? normalized : "";
}

function normalizeRuntimeIdentifier(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRuntimeRequestId(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function normalizeRuntimeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRuntimeReplyPhase(value) {
  const normalized = normalizeRuntimeText(value).toLowerCase();
  return normalized === "commentary" || normalized === "final" ? normalized : "";
}

function normalizeRuntimeCommandTokens(tokens) {
  return Array.isArray(tokens)
    ? tokens.map((token) => normalizeRuntimeText(token)).filter(Boolean)
    : [];
}

function normalizeFragmentKind(value) {
  const normalized = normalizeRuntimeText(value).toLowerCase();
  return normalized === "snapshot" ? "snapshot" : "delta";
}

function extractRuntimeIdentifierCandidate(candidates) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const normalized = normalizeRuntimeIdentifier(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function buildApprovalCommandPreview(tokens) {
  const normalized = normalizeRuntimeCommandTokens(tokens);
  if (!normalized.length) {
    return "";
  }
  return normalized
    .map((token) => (token.includes(" ") ? JSON.stringify(token) : token))
    .join(" ");
}

function isRuntimeEventType(value) {
  return Boolean(normalizeRuntimeEventType(value));
}

function isRuntimeReplyEventType(value) {
  return RUNTIME_REPLY_EVENT_TYPES.some((entry) => entry === normalizeRuntimeEventType(value));
}

function isRuntimeTurnTerminalEventType(value) {
  return RUNTIME_TURN_TERMINAL_EVENT_TYPES.some((entry) => entry === normalizeRuntimeEventType(value));
}

function isRuntimeTurnLifecycleEventType(value) {
  return RUNTIME_TURN_LIFECYCLE_EVENT_TYPES.some((entry) => entry === normalizeRuntimeEventType(value));
}

function matchesRuntimeEventType(event, type) {
  return normalizeRuntimeEventType(event?.type) === normalizeRuntimeEventType(type);
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeIsoTimestamp(value) {
  const normalized = normalizeRuntimeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  RUNTIME_CORE_CONSUMER_EXPECTATIONS,
  RUNTIME_EVENT_TYPE_LIST,
  RUNTIME_EVENT_TYPES,
  RUNTIME_REPLY_EVENT_TYPES,
  RUNTIME_TURN_LIFECYCLE_EVENT_TYPES,
  RUNTIME_TURN_TERMINAL_EVENT_TYPES,
  buildApprovalCommandPreview,
  createRuntimeEvent,
  isRuntimeEventType,
  isRuntimeReplyEventType,
  isRuntimeTurnLifecycleEventType,
  isRuntimeTurnTerminalEventType,
  matchesRuntimeEventType,
  normalizeRuntimeApprovalPayload,
  normalizeRuntimeCommandTokens,
  normalizeRuntimeEventPayload,
  normalizeRuntimeEventType,
  normalizeRuntimeIdentifier,
  normalizeRuntimeReplyPhase,
  normalizeRuntimeRequestId,
  normalizeRuntimeText,
  normalizeRuntimeUsagePayload,
};
