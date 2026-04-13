import {
  normalizeSessionBinding,
  type SessionBinding,
  type SessionState,
} from "../../../contracts/session-state";
import {
  createEmptySessionBinding,
  getRuntimeParamsMap,
  getThreadMap,
  getWorkspaceBootstrapThreadMap,
  normalizeValue,
  type BindingRef,
  type RuntimeWorkspaceParams,
  type SessionBindingUpdate,
} from "./session-store-bindings";

export function getBindingFromState(state: SessionState, bindingKey: unknown): SessionBinding | null {
  const binding = state.bindings[normalizeValue(bindingKey)];
  return binding ? normalizeSessionBinding(binding) : null;
}

export function listBindingsFromState(state: SessionState): Array<SessionBinding & { bindingKey: string }> {
  return Object.entries(state.bindings || {}).map(([bindingKey, binding]) => ({
    bindingKey,
    ...(binding || {}),
  }));
}

export function getActiveWorkspaceRootFromState(state: SessionState, bindingKey: unknown): string {
  const activeWorkspaceRoot = state.bindings[normalizeValue(bindingKey)]?.activeWorkspaceRoot;
  return typeof activeWorkspaceRoot === "string" ? activeWorkspaceRoot : "";
}

export function updateBindingInState(
  state: SessionState,
  bindingKey: unknown,
  nextBinding: SessionBindingUpdate,
): SessionBinding | null {
  const normalizedBindingKey = normalizeValue(bindingKey);
  if (!normalizedBindingKey) {
    return null;
  }
  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const normalizedBinding = normalizeSessionBinding({
    ...current,
    ...nextBinding,
    updatedAt: new Date().toISOString(),
  });
  state.bindings = {
    ...(state.bindings || {}),
    [normalizedBindingKey]: normalizedBinding,
  };
  return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
}

export function getThreadIdForWorkspaceFromState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
): string {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return "";
  }
  const threadId = state.bindings[normalizeValue(bindingKey)]?.threadIdByWorkspaceRoot?.[normalizedWorkspaceRoot];
  return typeof threadId === "string" ? threadId : "";
}

export function setThreadIdForWorkspaceInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  threadId: unknown,
  extra: Record<string, unknown> = {},
): SessionBinding | null {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  const normalizedThreadId = normalizeValue(threadId);
  if (!normalizedWorkspaceRoot) {
    return getBindingFromState(state, bindingKey);
  }
  const normalizedBindingKey = normalizeValue(bindingKey);
  if (!normalizedBindingKey) {
    return null;
  }

  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const existingWorkspaceBootstrapMap = getWorkspaceBootstrapThreadMap(current);
  const threadIdByWorkspaceRoot = {
    ...getThreadMap(current),
    [normalizedWorkspaceRoot]: normalizedThreadId,
  };
  const workspaceBootstrapThreadIdByWorkspaceRoot = {
    ...existingWorkspaceBootstrapMap,
    [normalizedWorkspaceRoot]:
      existingWorkspaceBootstrapMap[normalizedWorkspaceRoot] === normalizedThreadId
        ? normalizedThreadId
        : "",
  };

  const normalizedBinding = normalizeSessionBinding({
    ...current,
    ...extra,
    activeWorkspaceRoot: normalizedWorkspaceRoot,
    threadIdByWorkspaceRoot,
    workspaceBootstrapThreadIdByWorkspaceRoot,
    updatedAt: new Date().toISOString(),
  });
  state.bindings = {
    ...(state.bindings || {}),
    [normalizedBindingKey]: normalizedBinding,
  };
  return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
}

export function getRuntimeParamsForWorkspaceFromState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
): RuntimeWorkspaceParams {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return { model: "", effort: "" };
  }
  const current = getBindingFromState(state, bindingKey) || createEmptySessionBinding();
  const runtimeParamsByWorkspaceRoot = getRuntimeParamsMap(current);
  const entry = runtimeParamsByWorkspaceRoot[normalizedWorkspaceRoot];
  return {
    model: typeof entry?.model === "string" ? entry.model : "",
    effort: typeof entry?.effort === "string" ? entry.effort : "",
  };
}

export function setRuntimeParamsForWorkspaceInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  { model = "", effort = "" }: { model?: unknown; effort?: unknown },
): SessionBinding | null {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return getBindingFromState(state, bindingKey);
  }
  const normalizedBindingKey = normalizeValue(bindingKey);
  if (!normalizedBindingKey) {
    return null;
  }
  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const runtimeParamsByWorkspaceRoot = {
    ...getRuntimeParamsMap(current),
    [normalizedWorkspaceRoot]: {
      model: normalizeValue(model),
      effort: normalizeValue(effort),
    },
  };
  const normalizedBinding = normalizeSessionBinding({
    ...current,
    runtimeParamsByWorkspaceRoot,
    updatedAt: new Date().toISOString(),
  });
  state.bindings = {
    ...(state.bindings || {}),
    [normalizedBindingKey]: normalizedBinding,
  };
  return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
}

export function getCodexParamsForWorkspaceFromState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
): RuntimeWorkspaceParams {
  return getRuntimeParamsForWorkspaceFromState(state, bindingKey, workspaceRoot);
}

export function setCodexParamsForWorkspaceInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  params: { model?: unknown; effort?: unknown },
): SessionBinding | null {
  return setRuntimeParamsForWorkspaceInState(state, bindingKey, workspaceRoot, params);
}

export function clearThreadIdForWorkspaceInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
): SessionBinding | null {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return getBindingFromState(state, bindingKey);
  }
  const normalizedBindingKey = normalizeValue(bindingKey);
  if (!normalizedBindingKey) {
    return null;
  }
  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const threadIdByWorkspaceRoot = {
    ...getThreadMap(current),
    [normalizedWorkspaceRoot]: "",
  };
  const workspaceBootstrapThreadIdByWorkspaceRoot = {
    ...getWorkspaceBootstrapThreadMap(current),
    [normalizedWorkspaceRoot]: "",
  };
  const normalizedBinding = normalizeSessionBinding({
    ...current,
    threadIdByWorkspaceRoot,
    workspaceBootstrapThreadIdByWorkspaceRoot,
    updatedAt: new Date().toISOString(),
  });
  state.bindings = {
    ...(state.bindings || {}),
    [normalizedBindingKey]: normalizedBinding,
  };
  return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
}

export function setActiveWorkspaceRootInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
): SessionBinding | null {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return getBindingFromState(state, bindingKey);
  }
  const normalizedBindingKey = normalizeValue(bindingKey);
  if (!normalizedBindingKey) {
    return null;
  }
  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const normalizedBinding = normalizeSessionBinding({
    ...current,
    activeWorkspaceRoot: normalizedWorkspaceRoot,
    updatedAt: new Date().toISOString(),
  });
  state.bindings = {
    ...(state.bindings || {}),
    [normalizedBindingKey]: normalizedBinding,
  };
  return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
}

export function listWorkspaceRootsFromState(state: SessionState, bindingKey: unknown): string[] {
  const current = getBindingFromState(state, bindingKey) || createEmptySessionBinding();
  return Object.keys(getThreadMap(current));
}

export function findBindingForThreadIdInState(state: SessionState, threadId: unknown): BindingRef | null {
  const normalizedThreadId = normalizeValue(threadId);
  if (!normalizedThreadId) {
    return null;
  }
  for (const [bindingKey, binding] of Object.entries(state.bindings || {})) {
    for (const [workspaceRoot, candidateThreadId] of Object.entries(getThreadMap(binding))) {
      if (candidateThreadId === normalizedThreadId) {
        return {
          bindingKey,
          workspaceRoot,
        };
      }
    }
  }
  return null;
}

export function hasWorkspaceBootstrapForThreadInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  threadId: unknown,
): boolean {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  const normalizedThreadId = normalizeValue(threadId);
  if (!normalizedWorkspaceRoot || !normalizedThreadId) {
    return false;
  }
  const current = getBindingFromState(state, bindingKey) || createEmptySessionBinding();
  return getWorkspaceBootstrapThreadMap(current)[normalizedWorkspaceRoot] === normalizedThreadId;
}

export function rememberWorkspaceBootstrapForThreadInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  threadId: unknown,
): SessionBinding | null {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  const normalizedThreadId = normalizeValue(threadId);
  if (!normalizedWorkspaceRoot || !normalizedThreadId) {
    return getBindingFromState(state, bindingKey);
  }
  const normalizedBindingKey = normalizeValue(bindingKey);
  if (!normalizedBindingKey) {
    return null;
  }
  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const workspaceBootstrapThreadIdByWorkspaceRoot = {
    ...getWorkspaceBootstrapThreadMap(current),
    [normalizedWorkspaceRoot]: normalizedThreadId,
  };
  const normalizedBinding = normalizeSessionBinding({
    ...current,
    workspaceBootstrapThreadIdByWorkspaceRoot,
    updatedAt: new Date().toISOString(),
  });
  state.bindings = {
    ...(state.bindings || {}),
    [normalizedBindingKey]: normalizedBinding,
  };
  return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
}

export function buildBindingKey({
  workspaceId,
  accountId,
  senderId,
}: {
  workspaceId: unknown;
  accountId: unknown;
  senderId: unknown;
}): string {
  return `${normalizeValue(workspaceId)}:${normalizeValue(accountId)}:${normalizeValue(senderId)}`;
}

export type {
  BindingRef,
  RuntimeWorkspaceParams,
  SessionBindingUpdate,
};
