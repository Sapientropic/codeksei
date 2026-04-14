import { normalizeText } from "./text-normalization";

interface PersonReferenceConfigInput {
  userName?: unknown;
}

function normalizePersonName(value: unknown): string {
  return normalizeText(value);
}

function resolveConfiguredPersonName(config: PersonReferenceConfigInput = {}): string {
  return normalizePersonName(config?.userName);
}

function resolvePromptPersonZh(config: PersonReferenceConfigInput = {}): string {
  return resolveConfiguredPersonName(config) || "眼前这个人";
}

function resolvePromptPersonEn(config: PersonReferenceConfigInput = {}): string {
  return resolveConfiguredPersonName(config) || "the person you're with";
}

export {
  normalizePersonName,
  resolveConfiguredPersonName,
  resolvePromptPersonEn,
  resolvePromptPersonZh,
};
