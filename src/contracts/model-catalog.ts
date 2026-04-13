interface ModelCatalogPlainObject extends Record<string, unknown> {}

export interface RawModelCatalogEntry extends ModelCatalogPlainObject {
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

export interface RawModelCatalogListResponse extends ModelCatalogPlainObject {
  result?: {
    data?: unknown;
  } & ModelCatalogPlainObject;
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
  const normalizedCurrent = normalizeCatalogText(currentModel).toLowerCase();
  if (normalizedCurrent) {
    const matched = findModelByQuery(normalizedModels, normalizedCurrent);
    if (matched) {
      return matched;
    }
  }
  return normalizedModels.find((item) => item.isDefault) || normalizedModels[0] || null;
}

export function findModelByQuery(models: unknown, query: unknown): NormalizedModelCatalogEntry | null {
  const normalizedQuery = normalizeCatalogText(query).toLowerCase();
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
  const normalizedQuery = normalizeCatalogText(query).toLowerCase();
  if (!normalizedQuery) {
    return "";
  }
  return normalizeReasoningEfforts(efforts).find((effort) => effort.toLowerCase() === normalizedQuery) || "";
}

export function supportsReasoningEffort(
  model: Pick<NormalizedModelCatalogEntry, "supportedReasoningEfforts"> | null | undefined,
  effort: unknown,
): boolean {
  const normalizedEffort = normalizeCatalogText(effort);
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

export function normalizeCatalogText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSingleModel(model: RawModelCatalogEntry): NormalizedModelCatalogEntry | null {
  const modelId = normalizeCatalogText(model.model);
  const id = normalizeCatalogText(model.id);
  const normalizedModel = modelId || id;
  if (!normalizedModel) {
    return null;
  }
  return {
    id,
    model: normalizedModel,
    displayName: normalizeCatalogText(model.displayName || model.display_name),
    supportedReasoningEfforts: normalizeReasoningEfforts(
      model.supportedReasoningEfforts || model.supported_reasoning_efforts,
    ),
    defaultReasoningEffort: normalizeCatalogText(model.defaultReasoningEffort || model.default_reasoning_effort),
    isDefault: Boolean(model.isDefault || model.is_default),
  };
}

function normalizeSingleReasoningEffort(effort: unknown): string {
  if (typeof effort === "string") {
    return normalizeCatalogText(effort);
  }
  if (!isPlainObject(effort)) {
    return "";
  }
  return normalizeCatalogText(effort.reasoningEffort || effort.reasoning_effort);
}

function isPlainObject(value: unknown): value is ModelCatalogPlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type {
  ModelCatalogPlainObject,
};
