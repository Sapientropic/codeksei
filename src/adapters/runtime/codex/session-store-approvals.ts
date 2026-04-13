import type {
  PendingApprovalRecord,
  SessionState,
} from "../../../contracts/session-state";
import { normalizeValue } from "./session-store-bindings";

export type PendingApprovalUpdate = Partial<PendingApprovalRecord> & Record<string, unknown>;

export function normalizeCommandTokens(tokens: unknown): string[] {
  return Array.isArray(tokens)
    ? tokens.map((part) => normalizeValue(part)).filter(Boolean)
    : [];
}

export function isSameTokenList(left: readonly string[] | unknown, right: readonly string[] | unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function getApprovalAllowlistByWorkspaceRoot(state: SessionState): Record<string, string[][]> {
  return state.approvalCommandAllowlistByWorkspaceRoot
    && typeof state.approvalCommandAllowlistByWorkspaceRoot === "object"
    ? state.approvalCommandAllowlistByWorkspaceRoot
    : {};
}
