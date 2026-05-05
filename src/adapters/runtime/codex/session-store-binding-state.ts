import {
  normalizeSessionBinding,
  type SessionBinding,
  type SessionState,
} from "../../../contracts/session-state";
import {
  createEmptySessionBinding,
  getPendingThreadMap,
  getRuntimeParamsMap,
  getThreadMap,
  getWorkspaceBootstrapThreadMap,
  normalizeRuntimeId,
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
  runtimeId: unknown = "codex",
): string {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return "";
  }
  const threadId = getThreadMap(getBindingFromState(state, bindingKey), runtimeId)[normalizedWorkspaceRoot];
  return typeof threadId === "string" ? threadId : "";
}

export function setThreadIdForWorkspaceInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  threadId: unknown,
  extra: Record<string, unknown> = {},
  runtimeId: unknown = "codex",
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
  const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const existingWorkspaceBootstrapMap = getWorkspaceBootstrapThreadMap(current, normalizedRuntimeId);
  const threadIdByWorkspaceRoot = {
    ...getThreadMap(current, normalizedRuntimeId),
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
    ...(normalizedRuntimeId === "codex" ? { threadIdByWorkspaceRoot } : {}),
    threadIdByWorkspaceRootByRuntime: {
      ...(current.threadIdByWorkspaceRootByRuntime || {}),
      [normalizedRuntimeId]: threadIdByWorkspaceRoot,
    },
    ...(normalizedRuntimeId === "codex" ? { workspaceBootstrapThreadIdByWorkspaceRoot } : {}),
    workspaceBootstrapThreadIdByWorkspaceRootByRuntime: {
      ...(current.workspaceBootstrapThreadIdByWorkspaceRootByRuntime || {}),
      [normalizedRuntimeId]: workspaceBootstrapThreadIdByWorkspaceRoot,
    },
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
  runtimeId: unknown = "codex",
): RuntimeWorkspaceParams {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return { model: "", effort: "" };
  }
  const current = getBindingFromState(state, bindingKey) || createEmptySessionBinding();
  const runtimeParamsByWorkspaceRoot = getRuntimeParamsMap(current, runtimeId);
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
  runtimeId: unknown = "codex",
): SessionBinding | null {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return getBindingFromState(state, bindingKey);
  }
  const normalizedBindingKey = normalizeValue(bindingKey);
  if (!normalizedBindingKey) {
    return null;
  }
  const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const runtimeParamsByWorkspaceRoot = {
    ...getRuntimeParamsMap(current, normalizedRuntimeId),
    [normalizedWorkspaceRoot]: {
      model: normalizeValue(model),
      effort: normalizeValue(effort),
    },
  };
  const normalizedBinding = normalizeSessionBinding({
    ...current,
    ...(normalizedRuntimeId === "codex" ? { runtimeParamsByWorkspaceRoot } : {}),
    runtimeParamsByWorkspaceRootByRuntime: {
      ...(current.runtimeParamsByWorkspaceRootByRuntime || {}),
      [normalizedRuntimeId]: runtimeParamsByWorkspaceRoot,
    },
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
  return getRuntimeParamsForWorkspaceFromState(state, bindingKey, workspaceRoot, "codex");
}

export function setCodexParamsForWorkspaceInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  params: { model?: unknown; effort?: unknown },
): SessionBinding | null {
  return setRuntimeParamsForWorkspaceInState(state, bindingKey, workspaceRoot, params, "codex");
}

export function clearThreadIdForWorkspaceInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  runtimeId: unknown = "codex",
): SessionBinding | null {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return getBindingFromState(state, bindingKey);
  }
  const normalizedBindingKey = normalizeValue(bindingKey);
  if (!normalizedBindingKey) {
    return null;
  }
  const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const threadIdByWorkspaceRoot = {
    ...getThreadMap(current, normalizedRuntimeId),
    [normalizedWorkspaceRoot]: "",
  };
  const pendingThreadIdByWorkspaceRoot = {
    ...getPendingThreadMap(current, normalizedRuntimeId),
    [normalizedWorkspaceRoot]: "",
  };
  const workspaceBootstrapThreadIdByWorkspaceRoot = {
    ...getWorkspaceBootstrapThreadMap(current, normalizedRuntimeId),
    [normalizedWorkspaceRoot]: "",
  };
  const normalizedBinding = normalizeSessionBinding({
    ...current,
    ...(normalizedRuntimeId === "codex" ? { threadIdByWorkspaceRoot } : {}),
    threadIdByWorkspaceRootByRuntime: {
      ...(current.threadIdByWorkspaceRootByRuntime || {}),
      [normalizedRuntimeId]: threadIdByWorkspaceRoot,
    },
    pendingThreadIdByWorkspaceRootByRuntime: {
      ...(current.pendingThreadIdByWorkspaceRootByRuntime || {}),
      [normalizedRuntimeId]: pendingThreadIdByWorkspaceRoot,
    },
    ...(normalizedRuntimeId === "codex" ? { workspaceBootstrapThreadIdByWorkspaceRoot } : {}),
    workspaceBootstrapThreadIdByWorkspaceRootByRuntime: {
      ...(current.workspaceBootstrapThreadIdByWorkspaceRootByRuntime || {}),
      [normalizedRuntimeId]: workspaceBootstrapThreadIdByWorkspaceRoot,
    },
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

export function listWorkspaceRootsFromState(
  state: SessionState,
  bindingKey: unknown,
  runtimeId: unknown = "codex",
): string[] {
  const current = getBindingFromState(state, bindingKey) || createEmptySessionBinding();
  return Object.keys(getThreadMap(current, runtimeId));
}

export function findBindingForThreadIdInState(
  state: SessionState,
  threadId: unknown,
  runtimeId: unknown = "codex",
): BindingRef | null {
  const normalizedThreadId = normalizeValue(threadId);
  if (!normalizedThreadId) {
    return null;
  }
  for (const [bindingKey, binding] of Object.entries(state.bindings || {})) {
    for (const [workspaceRoot, candidateThreadId] of Object.entries(getThreadMap(binding, runtimeId))) {
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
  runtimeId: unknown = "codex",
): boolean {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  const normalizedThreadId = normalizeValue(threadId);
  if (!normalizedWorkspaceRoot || !normalizedThreadId) {
    return false;
  }
  const current = getBindingFromState(state, bindingKey) || createEmptySessionBinding();
  return getWorkspaceBootstrapThreadMap(current, runtimeId)[normalizedWorkspaceRoot] === normalizedThreadId;
}

export function rememberWorkspaceBootstrapForThreadInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  threadId: unknown,
  runtimeId: unknown = "codex",
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
  const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const workspaceBootstrapThreadIdByWorkspaceRoot = {
    ...getWorkspaceBootstrapThreadMap(current, normalizedRuntimeId),
    [normalizedWorkspaceRoot]: normalizedThreadId,
  };
  const normalizedBinding = normalizeSessionBinding({
    ...current,
    ...(normalizedRuntimeId === "codex" ? { workspaceBootstrapThreadIdByWorkspaceRoot } : {}),
    workspaceBootstrapThreadIdByWorkspaceRootByRuntime: {
      ...(current.workspaceBootstrapThreadIdByWorkspaceRootByRuntime || {}),
      [normalizedRuntimeId]: workspaceBootstrapThreadIdByWorkspaceRoot,
    },
    updatedAt: new Date().toISOString(),
  });
  state.bindings = {
    ...(state.bindings || {}),
    [normalizedBindingKey]: normalizedBinding,
  };
  return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
}

export function getPendingThreadIdForWorkspaceFromState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  runtimeId: unknown = "codex",
): string {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return "";
  }
  const pendingThreadId = getPendingThreadMap(getBindingFromState(state, bindingKey), runtimeId)[normalizedWorkspaceRoot];
  return typeof pendingThreadId === "string" ? pendingThreadId : "";
}

export function setPendingThreadIdForWorkspaceInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  threadId: unknown,
  runtimeId: unknown = "codex",
): SessionBinding | null {
  const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return getBindingFromState(state, bindingKey);
  }
  const normalizedBindingKey = normalizeValue(bindingKey);
  if (!normalizedBindingKey) {
    return null;
  }
  const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
  const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
  const pendingThreadIdByWorkspaceRoot = {
    ...getPendingThreadMap(current, normalizedRuntimeId),
    [normalizedWorkspaceRoot]: normalizeValue(threadId),
  };
  const normalizedBinding = normalizeSessionBinding({
    ...current,
    pendingThreadIdByWorkspaceRootByRuntime: {
      ...(current.pendingThreadIdByWorkspaceRootByRuntime || {}),
      [normalizedRuntimeId]: pendingThreadIdByWorkspaceRoot,
    },
    updatedAt: new Date().toISOString(),
  });
  state.bindings = {
    ...(state.bindings || {}),
    [normalizedBindingKey]: normalizedBinding,
  };
  return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
}

export function clearPendingThreadIdForWorkspaceInState(
  state: SessionState,
  bindingKey: unknown,
  workspaceRoot: unknown,
  runtimeId: unknown = "codex",
): SessionBinding | null {
  return setPendingThreadIdForWorkspaceInState(state, bindingKey, workspaceRoot, "", runtimeId);
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
