import { normalizeText } from "../../../core/text-normalization";
type PlainObject = Record<string, unknown>;

export interface RawModelCatalogEntry extends PlainObject {
  id?: unknown;
  model?: unknown;
  displayName?: unknown;
  display_name?: unknown;
  supportedReasoningEfforts?: unknown;
  supported_reasoning_efforts?: unknown;
  defaultReasoningEffort?: unknown;
  default_reasoning_effort?: unknown;
  isDefault?: unknown;
  is_default?: unknown;
}

export interface RawModelCatalogListResponse extends PlainObject {
  result?: {
    data?: unknown;
  } & PlainObject;
  data?: unknown;
}

export interface NormalizedModelCatalogEntry {
  id: string;
  model: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
  isDefault: boolean;
}

export interface AvailableModelCatalogView {
  models: NormalizedModelCatalogEntry[];
  updatedAt: string;
}

export function extractModelCatalogFromListResponse(response: unknown): NormalizedModelCatalogEntry[] {
  const source = isPlainObject(response) ? response as RawModelCatalogListResponse : {};
  const result = isPlainObject(source.result) ? source.result : {};
  const candidates = Array.isArray(result.data)
    ? result.data
    : Array.isArray(source.data)
      ? source.data
      : [];
  return normalizeModelCatalog(candidates);
}

export function resolveEffectiveModelForEffort(
  models: unknown,
  currentModel: unknown,
): NormalizedModelCatalogEntry | null {
  const normalizedModels = normalizeModelCatalog(models);
  if (!normalizedModels.length) {
    return null;
  }
  const normalizedCurrent = normalizeText(currentModel).toLowerCase();
  if (normalizedCurrent) {
    const matched = findModelByQuery(normalizedModels, normalizedCurrent);
    if (matched) {
      return matched;
    }
  }
  return normalizedModels.find((item) => item.isDefault) || normalizedModels[0] || null;
}

export function findModelByQuery(models: unknown, query: unknown): NormalizedModelCatalogEntry | null {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return null;
  }
  const normalizedModels = normalizeModelCatalog(models);
  return normalizedModels.find((item) => (
    item.model.toLowerCase() === normalizedQuery
    || item.id.toLowerCase() === normalizedQuery
  )) || null;
}

export function findReasoningEffortByQuery(
  efforts: unknown,
  query: unknown,
): string {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return "";
  }
  return normalizeReasoningEfforts(efforts).find((effort) => effort.toLowerCase() === normalizedQuery) || "";
}

export function supportsReasoningEffort(
  model: Pick<NormalizedModelCatalogEntry, "supportedReasoningEfforts"> | null | undefined,
  effort: unknown,
): boolean {
  const normalizedEffort = normalizeText(effort);
  if (!normalizedEffort) {
    return false;
  }
  return Boolean(findReasoningEffortByQuery(model?.supportedReasoningEfforts || [], normalizedEffort));
}

export function normalizeModelCatalog(models: unknown): NormalizedModelCatalogEntry[] {
  if (!Array.isArray(models)) {
    return [];
  }
  const normalized: NormalizedModelCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const rawModel of models) {
    if (!isPlainObject(rawModel)) {
      continue;
    }
    const model = normalizeSingleModel(rawModel);
    if (!model) {
      continue;
    }
    const dedupeKey = model.model.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push(model);
  }
  return normalized;
}

export function normalizeReasoningEfforts(efforts: unknown): string[] {
  if (!Array.isArray(efforts)) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const effort of efforts) {
    const normalized = normalizeSingleReasoningEffort(effort);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
export { normalizeText };

function normalizeSingleModel(model: RawModelCatalogEntry): NormalizedModelCatalogEntry | null {
  const modelId = normalizeText(model.model);
  const id = normalizeText(model.id);
  const normalizedModel = modelId || id;
  if (!normalizedModel) {
    return null;
  }
  return {
    id,
    model: normalizedModel,
    displayName: normalizeText(model.displayName || model.display_name),
    supportedReasoningEfforts: normalizeReasoningEfforts(
      model.supportedReasoningEfforts || model.supported_reasoning_efforts,
    ),
    defaultReasoningEffort: normalizeText(model.defaultReasoningEffort || model.default_reasoning_effort),
    isDefault: Boolean(model.isDefault || model.is_default),
  };
}

function normalizeSingleReasoningEffort(effort: unknown): string {
  if (typeof effort === "string") {
    return normalizeText(effort);
  }
  if (!isPlainObject(effort)) {
    return "";
  }
  return normalizeText(effort.reasoningEffort || effort.reasoning_effort);
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type {
  PlainObject as ModelCatalogPlainObject,
};

