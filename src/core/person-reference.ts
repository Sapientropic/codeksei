import { normalizeText } from "./text-normalization";

function normalizePersonName(value: unknown): string {
  return normalizeText(value);
}

function resolveConfiguredPersonName(config: Record<string, unknown> = {}): string {
  return normalizePersonName(config?.userName);
}

function resolvePromptPersonZh(config: Record<string, unknown> = {}): string {
  return resolveConfiguredPersonName(config) || "眼前这个人";
}

function resolvePromptPersonEn(config: Record<string, unknown> = {}): string {
  return resolveConfiguredPersonName(config) || "the person you're with";
}

export {
  normalizePersonName,
  resolveConfiguredPersonName,
  resolvePromptPersonEn,
  resolvePromptPersonZh,
};
