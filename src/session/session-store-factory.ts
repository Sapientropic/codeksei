import { normalizeText } from "../core/text-normalization";
import { SessionStore } from "./session-store";

export function createSessionStore(filePath: unknown): SessionStore | null {
  const normalizedFilePath = normalizeText(filePath);
  if (!normalizedFilePath) {
    return null;
  }
  return new SessionStore({ filePath: normalizedFilePath });
}
