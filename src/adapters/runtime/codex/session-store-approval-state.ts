import {
  normalizePendingApprovalRecord,
  type PendingApprovalRecord,
  type SessionState,
} from "../../../contracts/session-state";
import { isRecord, normalizeValue } from "./session-store-bindings";
import {
  getApprovalAllowlistByWorkspaceRoot,
  isSameTokenList,
  normalizeCommandTokens,
  type PendingApprovalUpdate,
} from "./session-store-approvals";

export function getApprovalCommandAllowlistForWorkspaceFromState(
  state: SessionState,
  workspaceRoot: unknown,
): string[][] {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return [];
  }
  const raw = state.approvalCommandAllowlistByWorkspaceRoot?.[normalizedWorkspaceRoot];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is string[] => Array.isArray(entry) && entry.every((part) => typeof part === "string" && Boolean(part)))
    .map((entry) => entry.slice())
    .filter((entry) => entry.length > 0);
}

export function rememberApprovalPrefixForWorkspaceInState(
  state: SessionState,
  workspaceRoot: unknown,
  commandTokens: unknown,
): string[][] {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  const normalizedTokens = normalizeCommandTokens(commandTokens);
  if (!normalizedWorkspaceRoot || !normalizedTokens.length) {
    return getApprovalCommandAllowlistForWorkspaceFromState(state, workspaceRoot);
  }
  const current = getApprovalAllowlistByWorkspaceRoot(state)[normalizedWorkspaceRoot] || [];
  if (!current.some((entry) => isSameTokenList(entry, normalizedTokens))) {
    current.push(normalizedTokens);
  }
  state.approvalCommandAllowlistByWorkspaceRoot = {
    ...(state.approvalCommandAllowlistByWorkspaceRoot || {}),
    [normalizedWorkspaceRoot]: current.map((entry) => entry.slice()),
  };
  return current.map((entry) => entry.slice());
}

export function getPendingApprovalForThreadFromState(
  state: SessionState,
  threadId: unknown,
): PendingApprovalRecord | null {
  const normalizedThreadId = normalizeValue(threadId);
  if (!normalizedThreadId) {
    return null;
  }
  const approval = state.approvalPromptStateByThreadId?.[normalizedThreadId];
  if (!approval || typeof approval !== "object") {
    return null;
  }
  return { ...approval };
}

export function listPendingApprovalsFromState(
  state: SessionState,
): Array<{ threadId: string; approval: PendingApprovalRecord }> {
  return Object.entries(state.approvalPromptStateByThreadId || {}).map(([threadId, approval]) => ({
    threadId,
    approval: { ...approval },
  }));
}

export function rememberPendingApprovalForThreadInState(
  state: SessionState,
  threadId: unknown,
  approval: PendingApprovalUpdate | null | undefined,
  {
    signature = "",
    promptedAt = "",
  }: { signature?: unknown; promptedAt?: unknown } = {},
): PendingApprovalRecord | null {
  const normalizedThreadId = normalizeValue(threadId);
  if (!normalizedThreadId) {
    return null;
  }
  const existing = state.approvalPromptStateByThreadId?.[normalizedThreadId] || null;
  const normalizedApproval = normalizePendingApprovalRecord({
    ...(existing || {}),
    ...(approval || {}),
    signature: normalizeValue(signature)
      || normalizeValue(approval?.signature)
      || normalizeValue(existing?.signature)
      || "",
    promptedAt: normalizeValue(promptedAt) || normalizeValue(approval?.promptedAt) || new Date().toISOString(),
  });
  if (!normalizedApproval) {
    return null;
  }
  state.approvalPromptStateByThreadId = {
    ...(state.approvalPromptStateByThreadId || {}),
    [normalizedThreadId]: normalizedApproval,
  };
  return normalizePendingApprovalRecord(state.approvalPromptStateByThreadId[normalizedThreadId]);
}

export function clearPendingApprovalForThreadInState(state: SessionState, threadId: unknown): void {
  const normalizedThreadId = normalizeValue(threadId);
  if (!normalizedThreadId || !state.approvalPromptStateByThreadId?.[normalizedThreadId]) {
    return;
  }
  const next = {
    ...(state.approvalPromptStateByThreadId || {}),
  };
  delete next[normalizedThreadId];
  state.approvalPromptStateByThreadId = next;
}

export {
  isRecord,
};

export type {
  PendingApprovalUpdate,
};
