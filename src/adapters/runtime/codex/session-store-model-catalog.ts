import type { SessionState } from "../../../contracts/session-state";
import {
  normalizeModelCatalog,
  type AvailableModelCatalogView,
} from "../../../contracts/model-catalog";
import { isRecord } from "./session-store-bindings";

export type { AvailableModelCatalogView } from "../../../contracts/model-catalog";

export function getAvailableModelCatalogFromState(state: SessionState): AvailableModelCatalogView | null {
  const raw = state.availableModelCatalog;
  if (!isRecord(raw)) {
    return null;
  }
  const models = normalizeModelCatalog(raw.models);
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
  const normalizedModels = normalizeModelCatalog(models);
  if (!normalizedModels.length) {
    return null;
  }
  state.availableModelCatalog = {
    models: normalizedModels,
    updatedAt: new Date().toISOString(),
  };
  return getAvailableModelCatalogFromState(state);
}
