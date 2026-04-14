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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function getThreadMap(binding: SessionBinding | null | undefined): Record<string, string> {
  return binding?.threadIdByWorkspaceRoot && typeof binding.threadIdByWorkspaceRoot === "object"
    ? binding.threadIdByWorkspaceRoot
    : {};
}

export function getRuntimeParamsMap(binding: SessionBinding | null | undefined): Record<string, RuntimeWorkspaceParams> {
  return binding?.runtimeParamsByWorkspaceRoot && typeof binding.runtimeParamsByWorkspaceRoot === "object"
    ? binding.runtimeParamsByWorkspaceRoot
    : {};
}

export function getCodexParamsMap(binding: SessionBinding | null | undefined): Record<string, RuntimeWorkspaceParams> {
  return getRuntimeParamsMap(binding);
}

export function getWorkspaceBootstrapThreadMap(binding: SessionBinding | null | undefined): Record<string, string> {
  return binding?.workspaceBootstrapThreadIdByWorkspaceRoot
    && typeof binding.workspaceBootstrapThreadIdByWorkspaceRoot === "object"
    ? binding.workspaceBootstrapThreadIdByWorkspaceRoot
    : {};
}
