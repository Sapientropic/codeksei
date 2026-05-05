import {
  RUNTIME_EVENT_TYPES,
  createRuntimeEvent,
  normalizeRuntimeCommandTokens,
  type RuntimeEvent,
} from "../../../contracts/runtime-events";

type UnknownRecord = Record<string, unknown>;

interface ClaudeCodeRuntimeMessage extends UnknownRecord {
  type?: unknown;
  sessionId?: unknown;
  turnId?: unknown;
  text?: unknown;
  requestId?: unknown;
  toolName?: unknown;
  input?: unknown;
  error?: unknown;
  usage?: unknown;
  modelContextWindow?: unknown;
}

export function mapClaudeCodeMessageToRuntimeEvent(
  message: ClaudeCodeRuntimeMessage | null | undefined,
  raw: unknown = null,
): RuntimeEvent<UnknownRecord> | null {
  const source = message || {};
  switch (normalizeString(source.type)) {
    case "context.updated":
      return createRuntimeEvent(RUNTIME_EVENT_TYPES.USAGE_UPDATED, normalizeClaudeUsagePayload(source, raw));
    case "turn.started":
      return createRuntimeEvent(RUNTIME_EVENT_TYPES.TURN_STARTED, {
        threadId: source.sessionId,
        turnId: source.turnId,
      });
    case "reply.completed":
      return createRuntimeEvent(RUNTIME_EVENT_TYPES.REPLY_COMPLETED, {
        threadId: source.sessionId,
        turnId: source.turnId,
        itemId: `item-${normalizeString(source.turnId)}`,
        text: typeof source.text === "string" ? source.text : "",
      });
    case "turn.completed":
      return createRuntimeEvent(RUNTIME_EVENT_TYPES.TURN_COMPLETED, {
        threadId: source.sessionId,
        turnId: source.turnId,
      });
    case "approval.requested":
      return createRuntimeEvent(RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED, {
        threadId: source.sessionId,
        requestId: source.requestId,
        reason: `Tool: ${formatReadableToolName(source.toolName)}`,
        command: formatToolCommand(source.toolName, source.input),
        commandTokens: buildClaudeApprovalCommandTokens(source.toolName, source.input),
      });
    case "process.error":
    case "process.close":
      return createRuntimeEvent(RUNTIME_EVENT_TYPES.TURN_FAILED, {
        threadId: source.sessionId,
        turnId: source.turnId,
        text: normalizeString(source.error) || "Runtime process exited unexpectedly",
      });
    case "session.id":
      return null;
    default:
      return null;
  }
}

function normalizeClaudeUsagePayload(message: ClaudeCodeRuntimeMessage, raw: unknown): UnknownRecord {
  const usage = resolveClaudeUsage(message, raw);
  const inputTokens = numberOrZero(usage.input_tokens);
  const cacheCreationInputTokens = numberOrZero(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = numberOrZero(usage.cache_read_input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);
  const cachedInputTokens = cacheCreationInputTokens + cacheReadInputTokens;
  const totalInputTokens = inputTokens + cachedInputTokens;
  const totalTokens = totalInputTokens + outputTokens;
  return {
    threadId: message.sessionId,
    turnId: message.turnId,
    info: {
      thread: { id: message.sessionId },
      turn: { id: message.turnId },
      total_token_usage: {
        input_tokens: totalInputTokens,
        cached_input_tokens: cachedInputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
      },
      last_token_usage: {
        input_tokens: totalInputTokens,
        cached_input_tokens: cachedInputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
      },
      model_context_window: numberOrZero(message.modelContextWindow),
    },
  };
}

function resolveClaudeUsage(message: ClaudeCodeRuntimeMessage, raw: unknown): UnknownRecord {
  const rawRecord = asRecord(raw);
  const rawMessage = asRecord(rawRecord.message);
  const rawUsage = asRecord(rawMessage.usage);
  if (Object.keys(rawUsage).length) {
    return rawUsage;
  }
  return asRecord(message.usage);
}

function formatToolCommand(toolName: unknown, input: unknown): string {
  const name = formatReadableToolName(toolName);
  const inputRecord = asRecord(input);
  const keys = Object.keys(inputRecord);
  if (!keys.length) {
    return name;
  }
  return truncateCommand([
    name,
    ...keys.map((key) => `${key}: ${JSON.stringify(inputRecord[key])}`),
  ].join("\n"));
}

function formatReadableToolName(toolName: unknown): string {
  const normalized = normalizeString(toolName);
  if (!normalized.startsWith("mcp__")) {
    return normalized;
  }
  const parts = normalized.split("__").filter(Boolean);
  return parts.length >= 3 && parts[0] === "mcp"
    ? parts.slice(2).join("__") || normalized
    : normalized;
}

function buildClaudeApprovalCommandTokens(toolName: unknown, input: unknown): string[] {
  const readableToolName = formatReadableToolName(toolName);
  const inputRecord = asRecord(input);
  const prefixRule = normalizeRuntimeCommandTokens(inputRecord.prefix_rule);
  const commandTokens = prefixRule.length
    ? prefixRule
    : splitCommandTokens(inputRecord.command);
  return [readableToolName, ...commandTokens].filter(Boolean);
}

function splitCommandTokens(command: unknown): string[] {
  if (Array.isArray(command)) {
    return normalizeRuntimeCommandTokens(command);
  }
  const text = normalizeString(command);
  return text ? text.split(/\s+/u).filter(Boolean) : [];
}

function truncateCommand(text: string, maxLines = 6, maxLineLength = 100): string {
  const lines = text.split("\n");
  const truncated = lines.slice(0, maxLines).map((line) => (
    line.length <= maxLineLength ? line : `${line.slice(0, maxLineLength)} ...`
  ));
  const result = truncated.join("\n");
  return lines.length > maxLines ? `${result}\n...` : result;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrZero(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}
