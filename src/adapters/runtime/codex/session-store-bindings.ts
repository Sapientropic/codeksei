import {
  normalizeSessionBinding,
  type SessionBinding,
} from "../../../contracts/session-state";

export interface RuntimeWorkspaceParams {
  model: string;
  effort: string;
}

export interface BindingRef {
  bindingKey: string;
  workspaceRoot: string;
}

export type SessionBindingUpdate = Partial<SessionBinding> & Record<string, unknown>;

export function createEmptySessionBinding(): SessionBinding {
  return normalizeSessionBinding({});
}

export function normalizeValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeRuntimeId(value: unknown): string {
  return normalizeValue(value).toLowerCase() || "codex";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getThreadMap(
  binding: SessionBinding | null | undefined,
  runtimeId: unknown = "codex",
): Record<string, string> {
  return getRuntimeStringMap({
    binding,
    runtimeId,
    scopedField: "threadIdByWorkspaceRootByRuntime",
    legacyField: "threadIdByWorkspaceRoot",
  });
}

export function getPendingThreadMap(
  binding: SessionBinding | null | undefined,
  runtimeId: unknown = "codex",
): Record<string, string> {
  return getRuntimeStringMap({
    binding,
    runtimeId,
    scopedField: "pendingThreadIdByWorkspaceRootByRuntime",
  });
}

export function getRuntimeParamsMap(
  binding: SessionBinding | null | undefined,
  runtimeId: unknown = "codex",
): Record<string, RuntimeWorkspaceParams> {
  const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
  const scoped = binding?.runtimeParamsByWorkspaceRootByRuntime;
  if (scoped && isRecord(scoped) && isRecord(scoped[normalizedRuntimeId])) {
    return normalizeRuntimeParamsRecord(scoped[normalizedRuntimeId]);
  }
  if (normalizedRuntimeId === "codex" && binding?.runtimeParamsByWorkspaceRoot && isRecord(binding.runtimeParamsByWorkspaceRoot)) {
    return normalizeRuntimeParamsRecord(binding.runtimeParamsByWorkspaceRoot);
  }
  return {};
}

export function getCodexParamsMap(binding: SessionBinding | null | undefined): Record<string, RuntimeWorkspaceParams> {
  return getRuntimeParamsMap(binding, "codex");
}

export function getWorkspaceBootstrapThreadMap(
  binding: SessionBinding | null | undefined,
  runtimeId: unknown = "codex",
): Record<string, string> {
  return getRuntimeStringMap({
    binding,
    runtimeId,
    scopedField: "workspaceBootstrapThreadIdByWorkspaceRootByRuntime",
    legacyField: "workspaceBootstrapThreadIdByWorkspaceRoot",
  });
}

function getRuntimeStringMap({
  binding,
  runtimeId,
  scopedField,
  legacyField,
}: {
  binding: SessionBinding | null | undefined;
  runtimeId: unknown;
  scopedField:
    | "threadIdByWorkspaceRootByRuntime"
    | "pendingThreadIdByWorkspaceRootByRuntime"
    | "workspaceBootstrapThreadIdByWorkspaceRootByRuntime";
  legacyField?: "threadIdByWorkspaceRoot" | "workspaceBootstrapThreadIdByWorkspaceRoot";
}): Record<string, string> {
  const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
  const scoped = binding?.[scopedField];
  if (scoped && isRecord(scoped) && isRecord(scoped[normalizedRuntimeId])) {
    return normalizeStringRecord(scoped[normalizedRuntimeId]);
  }
  if (normalizedRuntimeId === "codex" && legacyField && binding?.[legacyField] && isRecord(binding[legacyField])) {
    return normalizeStringRecord(binding[legacyField]);
  }
  return {};
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(value)) {
    return result;
  }
  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = normalizeValue(key);
    const normalizedEntryValue = normalizeValue(entryValue);
    if (normalizedKey) {
      result[normalizedKey] = normalizedEntryValue;
    }
  }
  return result;
}

function normalizeRuntimeParamsRecord(value: unknown): Record<string, RuntimeWorkspaceParams> {
  const result: Record<string, RuntimeWorkspaceParams> = {};
  if (!isRecord(value)) {
    return result;
  }
  for (const [workspaceRoot, params] of Object.entries(value)) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot || !isRecord(params)) {
      continue;
    }
    result[normalizedWorkspaceRoot] = {
      model: normalizeValue(params.model),
      effort: normalizeValue(params.effort),
    };
  }
  return result;
}
