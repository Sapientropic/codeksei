import { readPrefixedEnv } from "../../../contracts/app-env";


export const DEFAULT_CODEX_COMMAND = "codex";

export type AccessMode = "current" | "full-access" | "";

export interface RpcExecutionPolicies {
  approvalPolicy: "never" | "on-request";
  sandboxPolicy:
    | { type: "dangerFullAccess" }
    | { type: "workspaceWrite"; writableRoots?: string[]; networkAccess: true };
}

export function resolveDefaultCodexCommand(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeNonEmptyString(readPrefixedEnv(env, "CODEX_COMMAND")) || DEFAULT_CODEX_COMMAND;
}

export function normalizeNonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function buildStartThreadParams(cwd: unknown): Record<string, string> {
  const normalizedCwd = normalizeNonEmptyString(cwd);
  return normalizedCwd ? { cwd: normalizedCwd } : {};
}

export function buildListThreadsParams({
  cursor,
  limit,
  sortKey,
}: {
  cursor?: string | null;
  limit: number;
  sortKey: string;
}): { limit: number; sortKey: string; cursor?: string | null } {
  const params: { limit: number; sortKey: string; cursor?: string | null } = { limit, sortKey };
  const normalizedCursor = normalizeNonEmptyString(cursor);
  if (normalizedCursor) {
    params.cursor = normalizedCursor;
  } else if (cursor != null) {
    params.cursor = cursor;
  }
  return params;
}

export function buildTurnInputPayload(text: unknown): Array<{ type: "text"; text: string }> {
  const normalizedText = normalizeNonEmptyString(text);
  return normalizedText ? [{ type: "text", text: normalizedText }] : [];
}

export function buildTurnStartParams({
  threadId,
  input,
  model,
  effort,
  accessMode,
  workspaceRoot,
  extraWritableRoots = [],
}: {
  threadId?: unknown;
  input: Array<{ type: "text"; text: string }>;
  model?: unknown;
  effort?: unknown;
  accessMode?: unknown;
  workspaceRoot?: unknown;
  extraWritableRoots?: string[];
}): Record<string, unknown> {
  const params: Record<string, unknown> = { threadId, input };
  const normalizedWorkspaceRoot = normalizeNonEmptyString(workspaceRoot);
  const normalizedModel = normalizeNonEmptyString(model);
  const normalizedEffort = normalizeNonEmptyString(effort);
  const normalizedAccessMode = normalizeAccessMode(accessMode);
  const executionPolicies = buildExecutionPolicies(normalizedAccessMode, workspaceRoot, extraWritableRoots);
  if (normalizedWorkspaceRoot) {
    params.cwd = normalizedWorkspaceRoot;
  }
  if (normalizedModel) {
    params.model = normalizedModel;
  }
  if (normalizedEffort) {
    params.effort = normalizedEffort;
  }
  if (normalizedAccessMode) {
    params.accessMode = normalizedAccessMode;
  }
  params.approvalPolicy = executionPolicies.approvalPolicy;
  params.sandboxPolicy = executionPolicies.sandboxPolicy;
  return params;
}

export function normalizeAccessMode(value: unknown): AccessMode {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  if (normalized === "default") {
    return "current";
  }
  return normalized === "full-access" ? normalized : "";
}

export function buildExecutionPolicies(
  accessMode: AccessMode,
  workspaceRoot: unknown,
  extraWritableRoots: string[] = [],
): RpcExecutionPolicies {
  if (accessMode === "full-access") {
    return {
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    };
  }
  const normalizedWorkspaceRoot = normalizeNonEmptyString(workspaceRoot);
  const writableRoots = normalizeWritableRoots([
    normalizedWorkspaceRoot,
    ...extraWritableRoots,
  ]);
  const sandboxPolicy = writableRoots.length
    ? { type: "workspaceWrite" as const, writableRoots, networkAccess: true as const }
    : { type: "workspaceWrite" as const, networkAccess: true as const };
  return {
    approvalPolicy: "on-request",
    sandboxPolicy,
  };
}

export function normalizeWritableRoots(values: unknown[]): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeNonEmptyString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    roots.push(normalized);
  }
  return roots;
}
