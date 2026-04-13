import type { SessionState } from "../../../contracts/session-state";
import { normalizeModelCatalog } from "./model-catalog";
import { isRecord } from "./session-store-bindings";

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

export function getAvailableModelCatalogFromState(state: SessionState): AvailableModelCatalogView | null {
  const raw = state.availableModelCatalog;
  if (!isRecord(raw)) {
    return null;
  }
  const models = normalizeModelCatalog(raw.models) as NormalizedModelCatalogEntry[];
  if (!models.length) {
    return null;
  }
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
  return { models, updatedAt };
}

export function setAvailableModelCatalogInState(
  state: SessionState,
  models: unknown,
): AvailableModelCatalogView | null {
  const normalizedModels = normalizeModelCatalog(models) as NormalizedModelCatalogEntry[];
  if (!normalizedModels.length) {
    return null;
  }
  state.availableModelCatalog = {
    models: normalizedModels,
    updatedAt: new Date().toISOString(),
  };
  return getAvailableModelCatalogFromState(state);
}
