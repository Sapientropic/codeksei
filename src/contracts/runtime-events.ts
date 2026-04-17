type PlainObject = Record<string, unknown>;

export const RUNTIME_EVENT_TYPES = Object.freeze({
  USAGE_UPDATED: "runtime.usage.updated",
  TURN_STARTED: "runtime.turn.started",
  TURN_COMPLETED: "runtime.turn.completed",
  TURN_FAILED: "runtime.turn.failed",
  REPLY_DELTA: "runtime.reply.delta",
  REPLY_COMPLETED: "runtime.reply.completed",
  APPROVAL_REQUESTED: "runtime.approval.requested",
});

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[keyof typeof RUNTIME_EVENT_TYPES];
export type RuntimeReplyPhase = "" | "commentary" | "final";
export type RuntimeFragmentKind = "delta" | "snapshot";

export interface RuntimeUsagePayload extends PlainObject {
  threadId: string;
  turnId: string;
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  lastInputTokens: number;
  lastCachedInputTokens: number;
  lastOutputTokens: number;
  lastReasoningTokens: number;
  lastTotalTokens: number;
  modelContextWindow: number;
  primaryUsedPercent: number;
  secondaryUsedPercent: number;
}

export interface RuntimeTurnPayload extends PlainObject {
  threadId: string;
  turnId: string;
}

export interface RuntimeFailurePayload extends RuntimeTurnPayload {
  text: string;
}

export interface RuntimeReplyDeltaPayload extends RuntimeTurnPayload {
  itemId: string;
  text: string;
  fragmentKind: RuntimeFragmentKind;
  phase: RuntimeReplyPhase;
}

export interface RuntimeReplyCompletedPayload extends RuntimeTurnPayload {
  itemId: string;
  text: string;
  phase: RuntimeReplyPhase;
}

export interface RuntimeApprovalPayload extends PlainObject {
  threadId: string;
  requestId: string;
  reason: string;
  command: string;
  commandTokens: string[];
  signature: string;
  promptedAt: string;
}

export interface RuntimeEventPayloadByType {
  [RUNTIME_EVENT_TYPES.USAGE_UPDATED]: RuntimeUsagePayload;
  [RUNTIME_EVENT_TYPES.TURN_STARTED]: RuntimeTurnPayload;
  [RUNTIME_EVENT_TYPES.TURN_COMPLETED]: RuntimeTurnPayload;
  [RUNTIME_EVENT_TYPES.TURN_FAILED]: RuntimeFailurePayload;
  [RUNTIME_EVENT_TYPES.REPLY_DELTA]: RuntimeReplyDeltaPayload;
  [RUNTIME_EVENT_TYPES.REPLY_COMPLETED]: RuntimeReplyCompletedPayload;
  [RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED]: RuntimeApprovalPayload;
}

export type RuntimeEventPayload = RuntimeEventPayloadByType[RuntimeEventType];

export const RUNTIME_EVENT_TYPE_LIST = Object.freeze(
  Object.values(RUNTIME_EVENT_TYPES) as RuntimeEventType[],
);
export const RUNTIME_REPLY_EVENT_TYPES = Object.freeze([
  RUNTIME_EVENT_TYPES.REPLY_DELTA,
  RUNTIME_EVENT_TYPES.REPLY_COMPLETED,
] as RuntimeEventType[]);
export const RUNTIME_TURN_TERMINAL_EVENT_TYPES = Object.freeze([
  RUNTIME_EVENT_TYPES.TURN_COMPLETED,
  RUNTIME_EVENT_TYPES.TURN_FAILED,
] as RuntimeEventType[]);
export const RUNTIME_TURN_LIFECYCLE_EVENT_TYPES = Object.freeze([
  RUNTIME_EVENT_TYPES.TURN_STARTED,
  ...RUNTIME_TURN_TERMINAL_EVENT_TYPES,
] as RuntimeEventType[]);
// Only these events prove the runtime has actually started processing the
// current turn. Usage telemetry can arrive early and must not suppress the
// first-event watchdog's "still no progress" fallback.
export const RUNTIME_FIRST_PROGRESS_EVENT_TYPES = Object.freeze([
  RUNTIME_EVENT_TYPES.TURN_STARTED,
  RUNTIME_EVENT_TYPES.REPLY_DELTA,
  RUNTIME_EVENT_TYPES.REPLY_COMPLETED,
  RUNTIME_EVENT_TYPES.TURN_COMPLETED,
  RUNTIME_EVENT_TYPES.TURN_FAILED,
  RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED,
] as RuntimeEventType[]);
export const RUNTIME_CORE_CONSUMER_EXPECTATIONS = Object.freeze({
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

const RUNTIME_EVENT_TYPE_SET = new Set<string>(RUNTIME_EVENT_TYPE_LIST);
const RUNTIME_REPLY_EVENT_TYPE_SET = new Set<string>(RUNTIME_REPLY_EVENT_TYPES);
const RUNTIME_TURN_TERMINAL_EVENT_TYPE_SET = new Set<string>(RUNTIME_TURN_TERMINAL_EVENT_TYPES);
const RUNTIME_TURN_LIFECYCLE_EVENT_TYPE_SET = new Set<string>(RUNTIME_TURN_LIFECYCLE_EVENT_TYPES);
const RUNTIME_FIRST_PROGRESS_EVENT_TYPE_SET = new Set<string>(RUNTIME_FIRST_PROGRESS_EVENT_TYPES);

export interface RuntimeEvent<TPayload extends PlainObject = RuntimeEventPayload> {
  type: RuntimeEventType;
  payload: TPayload;
}

export function createRuntimeEvent(type: unknown, payload: unknown = {}): RuntimeEvent | null {
  const normalizedType = normalizeRuntimeEventType(type);
  if (!normalizedType) {
    return null;
  }
  return {
    type: normalizedType,
    payload: normalizeKnownRuntimeEventPayload(normalizedType, payload),
  };
}

export function normalizeRuntimeEventPayload(
  type: typeof RUNTIME_EVENT_TYPES.USAGE_UPDATED,
  payload?: unknown,
): RuntimeUsagePayload;
export function normalizeRuntimeEventPayload(
  type: typeof RUNTIME_EVENT_TYPES.TURN_STARTED | typeof RUNTIME_EVENT_TYPES.TURN_COMPLETED,
  payload?: unknown,
): RuntimeTurnPayload;
export function normalizeRuntimeEventPayload(
  type: typeof RUNTIME_EVENT_TYPES.TURN_FAILED,
  payload?: unknown,
): RuntimeFailurePayload;
export function normalizeRuntimeEventPayload(
  type: typeof RUNTIME_EVENT_TYPES.REPLY_DELTA,
  payload?: unknown,
): RuntimeReplyDeltaPayload;
export function normalizeRuntimeEventPayload(
  type: typeof RUNTIME_EVENT_TYPES.REPLY_COMPLETED,
  payload?: unknown,
): RuntimeReplyCompletedPayload;
export function normalizeRuntimeEventPayload(
  type: typeof RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED,
  payload?: unknown,
): RuntimeApprovalPayload;
export function normalizeRuntimeEventPayload(type: unknown, payload?: unknown): PlainObject;
export function normalizeRuntimeEventPayload(type: unknown, payload: unknown = {}): RuntimeEventPayload | PlainObject {
  const normalizedType = normalizeRuntimeEventType(type);
  switch (normalizedType) {
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

function normalizeKnownRuntimeEventPayload(
  type: RuntimeEventType,
  payload: unknown = {},
): RuntimeEventPayload {
  switch (type) {
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
  }
}

export function normalizeRuntimeUsagePayload(payload: unknown = {}): RuntimeUsagePayload {
  const payloadObject = asPlainObject(payload);
  const info = asPlainObject(payloadObject.info);
  const total = asPlainObject(info.total_token_usage);
  const last = asPlainObject(info.last_token_usage);
  const rateLimits = asPlainObject(payloadObject.rate_limits);
  const primaryRateLimits = asPlainObject(rateLimits.primary);
  const secondaryRateLimits = asPlainObject(rateLimits.secondary);
  const payloadContext = asPlainObject(payloadObject.context);
  const infoThread = asPlainObject(info.thread);
  const infoTurn = asPlainObject(info.turn);

  return {
    threadId: extractRuntimeIdentifierCandidate([
      payloadObject.threadId,
      payloadObject.thread_id,
      infoThread.id,
      info.threadId,
      info.thread_id,
      payloadContext.threadId,
      payloadContext.thread_id,
    ]),
    turnId: extractRuntimeIdentifierCandidate([
      payloadObject.turnId,
      payloadObject.turn_id,
      infoTurn.id,
      info.turnId,
      info.turn_id,
      payloadContext.turnId,
      payloadContext.turn_id,
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
    modelContextWindow: numberOrZero(info.model_context_window),
    primaryUsedPercent: numberOrZero(primaryRateLimits.used_percent),
    secondaryUsedPercent: numberOrZero(secondaryRateLimits.used_percent),
  };
}

export function normalizeRuntimeTurnPayload(payload: unknown = {}): RuntimeTurnPayload {
  const source = asPlainObject(payload);
  return {
    threadId: normalizeRuntimeIdentifier(source.threadId),
    turnId: normalizeRuntimeIdentifier(source.turnId),
  };
}

export function normalizeRuntimeFailurePayload(payload: unknown = {}): RuntimeFailurePayload {
  const source = asPlainObject(payload);
  return {
    ...normalizeRuntimeTurnPayload(source),
    text: normalizeRuntimeText(source.text),
  };
}

export function normalizeRuntimeReplyDeltaPayload(payload: unknown = {}): RuntimeReplyDeltaPayload {
  const source = asPlainObject(payload);
  return {
    ...normalizeRuntimeTurnPayload(source),
    itemId: normalizeRuntimeIdentifier(source.itemId),
    text: normalizeRuntimeReplyText(source.text),
    fragmentKind: normalizeFragmentKind(source.fragmentKind),
    phase: normalizeRuntimeReplyPhase(source.phase),
  };
}

export function normalizeRuntimeReplyCompletedPayload(payload: unknown = {}): RuntimeReplyCompletedPayload {
  const source = asPlainObject(payload);
  return {
    ...normalizeRuntimeTurnPayload(source),
    itemId: normalizeRuntimeIdentifier(source.itemId),
    text: normalizeRuntimeReplyText(source.text),
    phase: normalizeRuntimeReplyPhase(source.phase),
  };
}

export function normalizeRuntimeApprovalPayload(payload: unknown = {}): RuntimeApprovalPayload {
  const source = asPlainObject(payload);
  const commandTokens = normalizeRuntimeCommandTokens(source.commandTokens);
  return {
    threadId: normalizeRuntimeIdentifier(source.threadId),
    requestId: normalizeRuntimeRequestId(source.requestId),
    reason: normalizeRuntimeText(source.reason),
    command: normalizeRuntimeText(source.command) || buildApprovalCommandPreview(commandTokens),
    commandTokens,
    signature: normalizeRuntimeText(source.signature),
    promptedAt: normalizeIsoTimestamp(source.promptedAt),
  };
}

export function normalizeRuntimeEventType(value: unknown): RuntimeEventType | "" {
  const normalized = normalizeRuntimeText(value);
  return RUNTIME_EVENT_TYPE_SET.has(normalized) ? normalized as RuntimeEventType : "";
}

export function normalizeRuntimeIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeRuntimeRequestId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

export function normalizeRuntimeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeRuntimeReplyText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : "";
}

export function normalizeRuntimeReplyPhase(value: unknown): RuntimeReplyPhase {
  const normalized = normalizeRuntimeText(value).toLowerCase();
  return normalized === "commentary" || normalized === "final" ? normalized : "";
}

export function normalizeRuntimeCommandTokens(tokens: unknown): string[] {
  if (!Array.isArray(tokens)) {
    return [];
  }
  return tokens
    .map((token: unknown) => normalizeRuntimeText(token))
    .filter(Boolean);
}

function normalizeFragmentKind(value: unknown): RuntimeFragmentKind {
  const normalized = normalizeRuntimeText(value).toLowerCase();
  return normalized === "snapshot" ? "snapshot" : "delta";
}

function extractRuntimeIdentifierCandidate(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const normalized = normalizeRuntimeIdentifier(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export function buildApprovalCommandPreview(tokens: unknown): string {
  const normalized = normalizeRuntimeCommandTokens(tokens);
  if (!normalized.length) {
    return "";
  }
  return normalized
    .map((token) => (token.includes(" ") ? JSON.stringify(token) : token))
    .join(" ");
}

export function isRuntimeEventType(value: unknown): boolean {
  return Boolean(normalizeRuntimeEventType(value));
}

export function isRuntimeReplyEventType(value: unknown): boolean {
  return RUNTIME_REPLY_EVENT_TYPE_SET.has(normalizeRuntimeEventType(value));
}

export function isRuntimeTurnTerminalEventType(value: unknown): boolean {
  return RUNTIME_TURN_TERMINAL_EVENT_TYPE_SET.has(normalizeRuntimeEventType(value));
}

export function isRuntimeTurnLifecycleEventType(value: unknown): boolean {
  return RUNTIME_TURN_LIFECYCLE_EVENT_TYPE_SET.has(normalizeRuntimeEventType(value));
}

export function isRuntimeFirstProgressEventType(value: unknown): boolean {
  return RUNTIME_FIRST_PROGRESS_EVENT_TYPE_SET.has(normalizeRuntimeEventType(value));
}

export function matchesRuntimeEventType(event: { type?: unknown } | null | undefined, type: unknown): boolean {
  return normalizeRuntimeEventType(event?.type) === normalizeRuntimeEventType(type);
}

function numberOrZero(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeIsoTimestamp(value: unknown): string {
  const normalized = normalizeRuntimeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function asPlainObject(value: unknown): PlainObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PlainObject
    : {};
}
