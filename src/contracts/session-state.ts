import { z } from "zod";

type PlainObject = Record<string, unknown>;

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
  codexParamsByWorkspaceRoot: Record<string, { model: string }>;
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
  const source = isPlainObject(state) ? state : {};
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
  if (!isPlainObject(state)) {
    return "session store top-level state must be an object";
  }
  if ("bindings" in state && !isPlainObject(state.bindings)) {
    return "session store bindings must be an object";
  }
  for (const [bindingKey, binding] of Object.entries(state.bindings || {})) {
    const error = validateBinding(binding, bindingKey);
    if (error) {
      return error;
    }
  }
  if (
    "approvalCommandAllowlistByWorkspaceRoot" in state
    && !isPlainObject(state.approvalCommandAllowlistByWorkspaceRoot)
  ) {
    return "session store approvalCommandAllowlistByWorkspaceRoot must be an object";
  }
  for (const [workspaceRoot, entries] of Object.entries(state.approvalCommandAllowlistByWorkspaceRoot || {})) {
    if (!Array.isArray(entries)) {
      return `session store allowlist for workspace ${workspaceRoot} must be an array`;
    }
    for (let index = 0; index < entries.length; index += 1) {
      if (!Array.isArray(entries[index]) || entries[index].some((part: any) => typeof part !== "string")) {
        return `session store allowlist ${workspaceRoot}[${index}] must be string[]`;
      }
    }
  }
  if (
    "approvalPromptStateByThreadId" in state
    && !isPlainObject(state.approvalPromptStateByThreadId)
  ) {
    return "session store approvalPromptStateByThreadId must be an object";
  }
  for (const [threadId, approval] of Object.entries(state.approvalPromptStateByThreadId || {})) {
    const error = validatePendingApprovalRecord(approval, threadId);
    if (error) {
      return error;
    }
  }
  if ("availableModelCatalog" in state) {
    const error = validateAvailableModelCatalog(state.availableModelCatalog);
    if (error) {
      return error;
    }
  }
  return true;
}

export const sessionStoreStateSchema = z.unknown().transform((value: any, ctx: any) => {
  const validation = validateSessionStoreState(value);
  if (validation !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation });
    return z.NEVER;
  }
  return normalizeSessionState(value);
});

export function normalizeSessionBinding(binding: unknown): SessionBinding {
  const source = isPlainObject(binding) ? binding : {};
  return {
    ...source,
    workspaceId: normalizeText(source.workspaceId),
    accountId: normalizeText(source.accountId),
    senderId: normalizeText(source.senderId),
    activeWorkspaceRoot: normalizeText(source.activeWorkspaceRoot),
    updatedAt: normalizeIsoTimestamp(source.updatedAt),
    threadIdByWorkspaceRoot: normalizeStringMap(source.threadIdByWorkspaceRoot),
    codexParamsByWorkspaceRoot: normalizeCodexParamsMap(source.codexParamsByWorkspaceRoot),
    workspaceBootstrapThreadIdByWorkspaceRoot: normalizeStringMap(
      source.workspaceBootstrapThreadIdByWorkspaceRoot,
    ),
  };
}

function normalizeBindings(value: unknown): Record<string, SessionBinding> {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([bindingKey, binding]: any) => [normalizeText(bindingKey), normalizeSessionBinding(binding)])
      .filter(([bindingKey]: any) => Boolean(bindingKey)),
  );
}

function normalizeCodexParamsMap(value: unknown): Record<string, { model: string }> {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([workspaceRoot, params]: any) => {
        const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
        if (!normalizedWorkspaceRoot) {
          return null;
        }
        const source = isPlainObject(params) ? params : {};
        return [normalizedWorkspaceRoot, {
          model: normalizeText(source.model),
        }];
      })
      .filter((entry: any): entry is [string, { model: string }] => Boolean(entry)),
  );
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]: any) => [normalizeText(key), normalizeText(entryValue)])
      .filter(([key]: any) => Boolean(key)),
  );
}

function normalizeApprovalAllowlistMap(value: unknown): Record<string, string[][]> {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([workspaceRoot, entries]: any) => {
        const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
        if (!normalizedWorkspaceRoot) {
          return null;
        }
        return [normalizedWorkspaceRoot, normalizeApprovalAllowlistEntries(entries)];
      })
      .filter((entry: any): entry is [string, string[][]] => Boolean(entry)),
  );
}

function normalizeApprovalAllowlistEntries(value: unknown): string[][] {
  return Array.isArray(value)
    ? value
      .map((entry: any) => normalizeCommandTokens(entry))
      .filter((entry: any) => entry.length)
    : [];
}

function normalizePendingApprovalMap(value: unknown): Record<string, PendingApprovalRecord> {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([threadId, approval]: any) => {
        const normalizedThreadId = normalizeText(threadId);
        const normalizedApproval = normalizePendingApprovalRecord(approval);
        if (!normalizedThreadId || !normalizedApproval) {
          return null;
        }
        return [normalizedThreadId, normalizedApproval];
      })
      .filter((entry: any): entry is [string, PendingApprovalRecord] => Boolean(entry)),
  );
}

export function normalizePendingApprovalRecord(value: unknown): PendingApprovalRecord | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const requestId = normalizeRequestId(value.requestId);
  if (!requestId) {
    return null;
  }
  return {
    requestId,
    reason: normalizeText(value.reason),
    command: normalizeText(value.command),
    commandTokens: normalizeCommandTokens(value.commandTokens),
    signature: normalizeText(value.signature),
    promptedAt: normalizeIsoTimestamp(value.promptedAt),
  };
}

function normalizeAvailableModelCatalog(value: unknown): AvailableModelCatalog {
  const source = isPlainObject(value) ? value : {};
  return {
    ...source,
    models: Array.isArray(source.models) ? source.models.slice() : [],
    updatedAt: normalizeIsoTimestamp(source.updatedAt),
  };
}

function validateBinding(binding: unknown, bindingKey: string): string {
  if (!isPlainObject(binding)) {
    return `session store binding ${bindingKey} must be an object`;
  }
  for (const key of ["workspaceId", "accountId", "senderId", "activeWorkspaceRoot", "updatedAt"]) {
    if (key in binding && typeof binding[key] !== "string") {
      return `session store binding ${bindingKey}.${key} must be a string`;
    }
  }
  for (const key of ["threadIdByWorkspaceRoot", "workspaceBootstrapThreadIdByWorkspaceRoot"]) {
    const mapValue = binding[key];
    if (typeof mapValue !== "undefined") {
      if (!isPlainObject(mapValue)) {
        return `session store binding ${bindingKey}.${key} must be an object`;
      }
      for (const [mapKey, mapEntryValue] of Object.entries(mapValue)) {
        if (typeof mapKey !== "string" || typeof mapEntryValue !== "string") {
          return `session store binding ${bindingKey}.${key} entries must be string:string`;
        }
      }
    }
  }
  if ("codexParamsByWorkspaceRoot" in binding) {
    if (!isPlainObject(binding.codexParamsByWorkspaceRoot)) {
      return `session store binding ${bindingKey}.codexParamsByWorkspaceRoot must be an object`;
    }
    for (const [workspaceRoot, params] of Object.entries(binding.codexParamsByWorkspaceRoot)) {
      if (typeof workspaceRoot !== "string" || !isPlainObject(params)) {
        return `session store binding ${bindingKey}.codexParamsByWorkspaceRoot entries must be object values`;
      }
      if ("model" in params && typeof params.model !== "string") {
        return `session store binding ${bindingKey}.codexParamsByWorkspaceRoot.${workspaceRoot}.model must be a string`;
      }
    }
  }
  return "";
}

function validatePendingApprovalRecord(value: unknown, threadId: string): string {
  if (!isPlainObject(value)) {
    return `session store approvalPromptStateByThreadId.${threadId} must be an object`;
  }
  if (!normalizeRequestId(value.requestId)) {
    return `session store approvalPromptStateByThreadId.${threadId}.requestId must be a non-empty string`;
  }
  for (const key of ["reason", "command", "signature", "promptedAt"]) {
    if (key in value && typeof value[key] !== "string") {
      return `session store approvalPromptStateByThreadId.${threadId}.${key} must be a string`;
    }
  }
  if ("commandTokens" in value) {
    if (!Array.isArray(value.commandTokens) || value.commandTokens.some((part: any) => typeof part !== "string")) {
      return `session store approvalPromptStateByThreadId.${threadId}.commandTokens must be string[]`;
    }
  }
  return "";
}

function validateAvailableModelCatalog(value: unknown): string {
  if (!isPlainObject(value)) {
    return "session store availableModelCatalog must be an object";
  }
  if ("models" in value && !Array.isArray(value.models)) {
    return "session store availableModelCatalog.models must be an array";
  }
  if ("updatedAt" in value && typeof value.updatedAt !== "string") {
    return "session store availableModelCatalog.updatedAt must be a string";
  }
  return "";
}

export function listPendingApprovalEntries(state: Partial<SessionState> | null | undefined): Array<{ threadId: string; approval: PendingApprovalRecord }> {
  return Object.entries(normalizePendingApprovalMap(state?.approvalPromptStateByThreadId))
    .map(([threadId, approval]: any) => ({
      threadId,
      approval,
    }));
}

function normalizeCommandTokens(tokens: unknown): string[] {
  return Array.isArray(tokens)
    ? tokens.map((token: any) => normalizeText(token)).filter(Boolean)
    : [];
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

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
