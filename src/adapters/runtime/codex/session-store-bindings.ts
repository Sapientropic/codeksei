import {
  normalizeSessionBinding,
  type SessionBinding,
} from "../../../contracts/session-state";

export interface CodexWorkspaceParams {
  model: string;
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

export function getCodexParamsMap(binding: SessionBinding | null | undefined): Record<string, CodexWorkspaceParams> {
  return binding?.codexParamsByWorkspaceRoot && typeof binding.codexParamsByWorkspaceRoot === "object"
    ? binding.codexParamsByWorkspaceRoot
    : {};
}

export function getWorkspaceBootstrapThreadMap(binding: SessionBinding | null | undefined): Record<string, string> {
  return binding?.workspaceBootstrapThreadIdByWorkspaceRoot
    && typeof binding.workspaceBootstrapThreadIdByWorkspaceRoot === "object"
    ? binding.workspaceBootstrapThreadIdByWorkspaceRoot
    : {};
}
