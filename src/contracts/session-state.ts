import { normalizeText } from "./text-normalization";
import { z } from "zod";

type PlainObject = Record<string, unknown>;

export interface RawSessionBinding extends PlainObject {
  workspaceId?: unknown;
  accountId?: unknown;
  senderId?: unknown;
  activeWorkspaceRoot?: unknown;
  updatedAt?: unknown;
  threadIdByWorkspaceRoot?: unknown;
  runtimeParamsByWorkspaceRoot?: unknown;
  codexParamsByWorkspaceRoot?: unknown;
  workspaceBootstrapThreadIdByWorkspaceRoot?: unknown;
}

export interface RawPendingApprovalRecord extends PlainObject {
  requestId?: unknown;
  reason?: unknown;
  command?: unknown;
  commandTokens?: unknown;
  signature?: unknown;
  promptedAt?: unknown;
}

export interface RawAvailableModelCatalog extends PlainObject {
  models?: unknown;
  updatedAt?: unknown;
}

export interface RawSessionState extends PlainObject {
  bindings?: unknown;
  approvalCommandAllowlistByWorkspaceRoot?: unknown;
  approvalPromptStateByThreadId?: unknown;
  availableModelCatalog?: unknown;
}

export interface PendingApprovalRecord {
  requestId: string;
  reason: string;
  command: string;
  commandTokens: string[];
  signature: string;
  promptedAt: string;
}

export interface SessionBinding {
  workspaceId: string;
  accountId: string;
  senderId: string;
  activeWorkspaceRoot: string;
  updatedAt: string;
  threadIdByWorkspaceRoot: Record<string, string>;
  runtimeParamsByWorkspaceRoot: Record<string, { model: string; effort: string }>;
  workspaceBootstrapThreadIdByWorkspaceRoot: Record<string, string>;
  [key: string]: unknown;
}

export interface AvailableModelCatalog {
  models: unknown[];
  updatedAt: string;
  [key: string]: unknown;
}

export interface SessionState {
  bindings: Record<string, SessionBinding>;
  approvalCommandAllowlistByWorkspaceRoot: Record<string, string[][]>;
  approvalPromptStateByThreadId: Record<string, PendingApprovalRecord>;
  availableModelCatalog: AvailableModelCatalog;
  [key: string]: unknown;
}

export function createEmptySessionState(): SessionState {
  return {
    bindings: {},
    approvalCommandAllowlistByWorkspaceRoot: {},
    approvalPromptStateByThreadId: {},
    availableModelCatalog: {
      models: [],
      updatedAt: "",
    },
  };
}

export function normalizeSessionState(state: unknown): SessionState {
  const source = asRawSessionState(state);
  return {
    ...source,
    ...createEmptySessionState(),
    bindings: normalizeBindings(source.bindings),
    approvalCommandAllowlistByWorkspaceRoot: normalizeApprovalAllowlistMap(
      source.approvalCommandAllowlistByWorkspaceRoot,
    ),
    approvalPromptStateByThreadId: normalizePendingApprovalMap(source.approvalPromptStateByThreadId),
    availableModelCatalog: normalizeAvailableModelCatalog(source.availableModelCatalog),
  };
}

export function validateSessionStoreState(state: unknown): true | string {
  const source = asRawSessionState(state);
  if (!isPlainObject(state)) {
    return "session store top-level state must be an object";
  }
  if ("bindings" in source && !isPlainObject(source.bindings)) {
    return "session store bindings must be an object";
  }
  for (const [bindingKey, binding] of objectEntries(source.bindings)) {
    const error = validateBinding(binding, bindingKey);
    if (error) {
      return error;
    }
  }
  if (
    "approvalCommandAllowlistByWorkspaceRoot" in source
    && !isPlainObject(source.approvalCommandAllowlistByWorkspaceRoot)
  ) {
    return "session store approvalCommandAllowlistByWorkspaceRoot must be an object";
  }
  for (const [workspaceRoot, entries] of objectEntries(source.approvalCommandAllowlistByWorkspaceRoot)) {
    if (!Array.isArray(entries)) {
      return `session store allowlist for workspace ${workspaceRoot} must be an array`;
    }
    for (let index = 0; index < entries.length; index += 1) {
      if (!isStringArray(entries[index])) {
        return `session store allowlist ${workspaceRoot}[${index}] must be string[]`;
      }
    }
  }
  if (
    "approvalPromptStateByThreadId" in source
    && !isPlainObject(source.approvalPromptStateByThreadId)
  ) {
    return "session store approvalPromptStateByThreadId must be an object";
  }
  for (const [threadId, approval] of objectEntries(source.approvalPromptStateByThreadId)) {
    const error = validatePendingApprovalRecord(approval, threadId);
    if (error) {
      return error;
    }
  }
  if ("availableModelCatalog" in source) {
    const error = validateAvailableModelCatalog(source.availableModelCatalog);
    if (error) {
      return error;
    }
  }
  return true;
}

export const sessionStoreStateSchema = z.unknown().transform((
  value: unknown,
  ctx: z.RefinementCtx,
): SessionState | typeof z.NEVER => {
  const validation = validateSessionStoreState(value);
  if (validation !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation });
    return z.NEVER;
  }
  return normalizeSessionState(value);
});

export function normalizeSessionBinding(binding: unknown): SessionBinding {
  const source = asRawSessionBinding(binding);
  return {
    ...source,
    workspaceId: normalizeText(source.workspaceId),
    accountId: normalizeText(source.accountId),
    senderId: normalizeText(source.senderId),
    activeWorkspaceRoot: normalizeText(source.activeWorkspaceRoot),
    updatedAt: normalizeIsoTimestamp(source.updatedAt),
    threadIdByWorkspaceRoot: normalizeStringMap(source.threadIdByWorkspaceRoot),
    runtimeParamsByWorkspaceRoot: normalizeRuntimeParamsMap(
      source.runtimeParamsByWorkspaceRoot ?? source.codexParamsByWorkspaceRoot,
    ),
    workspaceBootstrapThreadIdByWorkspaceRoot: normalizeStringMap(
      source.workspaceBootstrapThreadIdByWorkspaceRoot,
    ),
  };
}

function normalizeBindings(value: unknown): Record<string, SessionBinding> {
  const bindings: Record<string, SessionBinding> = {};
  for (const [bindingKey, binding] of objectEntries(value)) {
    const normalizedBindingKey = normalizeText(bindingKey);
    if (!normalizedBindingKey) {
      continue;
    }
    bindings[normalizedBindingKey] = normalizeSessionBinding(binding);
  }
  return bindings;
}

function normalizeRuntimeParamsMap(value: unknown): Record<string, { model: string; effort: string }> {
  const result: Record<string, { model: string; effort: string }> = {};
  for (const [workspaceRoot, params] of objectEntries(value)) {
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      continue;
    }
    const source = asPlainObject(params);
    result[normalizedWorkspaceRoot] = {
      model: normalizeText(source.model),
      effort: normalizeText(source.effort),
    };
  }
  return result;
}

function normalizeStringMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entryValue] of objectEntries(value)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) {
      continue;
    }
    result[normalizedKey] = normalizeText(entryValue);
  }
  return result;
}

function normalizeApprovalAllowlistMap(value: unknown): Record<string, string[][]> {
  const result: Record<string, string[][]> = {};
  for (const [workspaceRoot, entries] of objectEntries(value)) {
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      continue;
    }
    result[normalizedWorkspaceRoot] = normalizeApprovalAllowlistEntries(entries);
  }
  return result;
}

function normalizeApprovalAllowlistEntries(value: unknown): string[][] {
  const entries: string[][] = [];
  if (!Array.isArray(value)) {
    return entries;
  }
  for (const entry of value) {
    const normalizedEntry = normalizeCommandTokens(entry);
    if (normalizedEntry.length) {
      entries.push(normalizedEntry);
    }
  }
  return entries;
}

function normalizePendingApprovalMap(value: unknown): Record<string, PendingApprovalRecord> {
  const result: Record<string, PendingApprovalRecord> = {};
  for (const [threadId, approval] of objectEntries(value)) {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedApproval = normalizePendingApprovalRecord(approval);
    if (!normalizedThreadId || !normalizedApproval) {
      continue;
    }
    result[normalizedThreadId] = normalizedApproval;
  }
  return result;
}

export function normalizePendingApprovalRecord(value: unknown): PendingApprovalRecord | null {
  const source = asRawPendingApprovalRecord(value);
  const requestId = normalizeRequestId(source.requestId);
  if (!requestId) {
    return null;
  }
  return {
    requestId,
    reason: normalizeText(source.reason),
    command: normalizeText(source.command),
    commandTokens: normalizeCommandTokens(source.commandTokens),
    signature: normalizeText(source.signature),
    promptedAt: normalizeIsoTimestamp(source.promptedAt),
  };
}

function normalizeAvailableModelCatalog(value: unknown): AvailableModelCatalog {
  const source = asRawAvailableModelCatalog(value);
  return {
    ...source,
    models: Array.isArray(source.models) ? source.models.slice() : [],
    updatedAt: normalizeIsoTimestamp(source.updatedAt),
  };
}

function validateBinding(binding: unknown, bindingKey: string): string {
  const source = asRawSessionBinding(binding);
  if (!isPlainObject(binding)) {
    return `session store binding ${bindingKey} must be an object`;
  }
  for (const key of ["workspaceId", "accountId", "senderId", "activeWorkspaceRoot", "updatedAt"] as const) {
    if (key in source && typeof source[key] !== "string") {
      return `session store binding ${bindingKey}.${key} must be a string`;
    }
  }
  for (const key of ["threadIdByWorkspaceRoot", "workspaceBootstrapThreadIdByWorkspaceRoot"] as const) {
    const mapValue = source[key];
    if (typeof mapValue === "undefined") {
      continue;
    }
    if (!isPlainObject(mapValue)) {
      return `session store binding ${bindingKey}.${key} must be an object`;
    }
    for (const [mapKey, mapEntryValue] of objectEntries(mapValue)) {
      if (typeof mapKey !== "string" || typeof mapEntryValue !== "string") {
        return `session store binding ${bindingKey}.${key} entries must be string:string`;
      }
    }
  }
  const runtimeParamsSource = "runtimeParamsByWorkspaceRoot" in source
    ? source.runtimeParamsByWorkspaceRoot
    : source.codexParamsByWorkspaceRoot;
  const runtimeParamsLabel = "runtimeParamsByWorkspaceRoot" in source
    ? "runtimeParamsByWorkspaceRoot"
    : "codexParamsByWorkspaceRoot";
  if (runtimeParamsSource !== undefined) {
    if (!isPlainObject(runtimeParamsSource)) {
      return `session store binding ${bindingKey}.${runtimeParamsLabel} must be an object`;
    }
    for (const [workspaceRoot, params] of objectEntries(runtimeParamsSource)) {
      if (typeof workspaceRoot !== "string" || !isPlainObject(params)) {
        return `session store binding ${bindingKey}.${runtimeParamsLabel} entries must be object values`;
      }
      if ("model" in params && typeof params.model !== "string") {
        return `session store binding ${bindingKey}.${runtimeParamsLabel}.${workspaceRoot}.model must be a string`;
      }
      if ("effort" in params && typeof params.effort !== "string") {
        return `session store binding ${bindingKey}.${runtimeParamsLabel}.${workspaceRoot}.effort must be a string`;
      }
    }
  }
  return "";
}

function validatePendingApprovalRecord(value: unknown, threadId: string): string {
  const source = asRawPendingApprovalRecord(value);
  if (!isPlainObject(value)) {
    return `session store approvalPromptStateByThreadId.${threadId} must be an object`;
  }
  if (!normalizeRequestId(source.requestId)) {
    return `session store approvalPromptStateByThreadId.${threadId}.requestId must be a non-empty string`;
  }
  for (const key of ["reason", "command", "signature", "promptedAt"] as const) {
    if (key in source && typeof source[key] !== "string") {
      return `session store approvalPromptStateByThreadId.${threadId}.${key} must be a string`;
    }
  }
  if ("commandTokens" in source && !isStringArray(source.commandTokens)) {
    return `session store approvalPromptStateByThreadId.${threadId}.commandTokens must be string[]`;
  }
  return "";
}

function validateAvailableModelCatalog(value: unknown): string {
  const source = asRawAvailableModelCatalog(value);
  if (!isPlainObject(value)) {
    return "session store availableModelCatalog must be an object";
  }
  if ("models" in source && !Array.isArray(source.models)) {
    return "session store availableModelCatalog.models must be an array";
  }
  if ("updatedAt" in source && typeof source.updatedAt !== "string") {
    return "session store availableModelCatalog.updatedAt must be a string";
  }
  return "";
}

export function listPendingApprovalEntries(
  state: Partial<SessionState> | null | undefined,
): Array<{ threadId: string; approval: PendingApprovalRecord }> {
  const entries: Array<{ threadId: string; approval: PendingApprovalRecord }> = [];
  const pendingApprovalMap = normalizePendingApprovalMap(state?.approvalPromptStateByThreadId);
  for (const [threadId, approval] of Object.entries(pendingApprovalMap)) {
    entries.push({
      threadId,
      approval,
    });
  }
  return entries;
}

function normalizeCommandTokens(tokens: unknown): string[] {
  const normalizedTokens: string[] = [];
  if (!Array.isArray(tokens)) {
    return normalizedTokens;
  }
  for (const token of tokens) {
    const normalizedToken = normalizeText(token);
    if (normalizedToken) {
      normalizedTokens.push(normalizedToken);
    }
  }
  return normalizedTokens;
}

function normalizeRequestId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function normalizeIsoTimestamp(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function objectEntries(value: unknown): Array<[string, unknown]> {
  return isPlainObject(value) ? Object.entries(value) : [];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asPlainObject(value: unknown): PlainObject {
  return isPlainObject(value) ? value : {};
}

function asRawSessionBinding(value: unknown): RawSessionBinding {
  return isPlainObject(value) ? value as RawSessionBinding : {};
}

function asRawPendingApprovalRecord(value: unknown): RawPendingApprovalRecord {
  return isPlainObject(value) ? value as RawPendingApprovalRecord : {};
}

function asRawAvailableModelCatalog(value: unknown): RawAvailableModelCatalog {
  return isPlainObject(value) ? value as RawAvailableModelCatalog : {};
}

function asRawSessionState(value: unknown): RawSessionState {
  return isPlainObject(value) ? value as RawSessionState : {};
}
