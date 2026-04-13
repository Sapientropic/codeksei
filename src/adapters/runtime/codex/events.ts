import {
  RUNTIME_EVENT_TYPES,
  createRuntimeEvent,
  normalizeRuntimeText,
  type RuntimeEvent,
} from "../../../contracts/runtime-events";
import type { UnknownRecord } from "../../../core/runtime-types";
import { splitCommandLine } from "../../../core/approval-command-policy";
import {
  extractAssistantDeltaFragment,
  extractAssistantPhase,
  extractCompletedAssistantText,
  extractFailureText,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
} from "./message-utils";


interface CodexRpcMessage extends UnknownRecord {
  method?: unknown;
  params?: UnknownRecord;
  payload?: UnknownRecord;
  type?: unknown;
  id?: unknown;
}

export function mapCodexMessageToRuntimeEvent(message: CodexRpcMessage | null | undefined): RuntimeEvent<UnknownRecord> | null {
  if (message?.type === "event_msg" && message?.payload?.type === "token_count") {
    return createRuntimeEvent(RUNTIME_EVENT_TYPES.USAGE_UPDATED, message.payload);
  }

  const method = normalizeRuntimeText(message?.method);
  const params = asRecord(message?.params);
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
    const item = asRecord(params.item);
    if (!fragment.text) {
      return null;
    }
    return createRuntimeEvent(RUNTIME_EVENT_TYPES.REPLY_DELTA, {
      threadId,
      turnId,
      itemId: normalizeRuntimeText(params.itemId || item.id),
      text: fragment.text,
      fragmentKind: fragment.fragmentKind,
      phase,
    });
  }

  if (method === "item/completed" && normalizeRuntimeText(asRecord(params.item).type).toLowerCase() === "agentmessage") {
    const text = extractCompletedAssistantText(params);
    const phase = extractAssistantPhase(params);
    const item = asRecord(params.item);
    return createRuntimeEvent(RUNTIME_EVENT_TYPES.REPLY_COMPLETED, {
      threadId,
      turnId,
      itemId: normalizeRuntimeText(item.id),
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

function isApprovalRequestMethod(method: unknown): boolean {
  return typeof method === "string" && method.endsWith("requestApproval");
}

function extractApprovalDisplayCommand(params: UnknownRecord): string {
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

function extractApprovalCommandTokens(params: UnknownRecord): string[] {
  return normalizeCommandTokens(extractTokens(params));
}

function extractTokens(value: unknown): string[] {
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

  const record = asRecord(value);
  for (const key of ["proposedExecpolicyAmendment", "argv", "args", "command", "cmd", "exec", "shellCommand", "script"]) {
    const tokens = extractTokens(record[key]);
    if (tokens.length) {
      return tokens;
    }
  }

  for (const [key, nested] of Object.entries(record)) {
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

function buildApprovalCommandPreview(tokens: unknown): string {
  const normalized = normalizeCommandTokens(tokens);
  if (!normalized.length) {
    return "";
  }
  return normalized.map((token) => (token.includes(" ") ? JSON.stringify(token) : token)).join(" ");
}

function normalizeCommandTokens(tokens: unknown): string[] {
  return Array.isArray(tokens)
    ? tokens.map((part) => normalizeRuntimeText(part)).filter(Boolean)
    : [];
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}
