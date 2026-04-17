import { normalizeText } from "./text-normalization";

export type JsonObject = Record<string, unknown>;

export function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

export function tryParseJson(text: unknown): JsonObject | null {
  try {
    const parsed = JSON.parse(String(text || "").trim());
    return parsed && typeof parsed === "object" ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

export function extractFirstJsonObject(text: unknown): string {
  const input = String(text || "");
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return "";
  }
  return input.slice(start, end + 1);
}

export function parseSemanticJson(text: unknown): JsonObject {
  const direct = tryParseJson(text);
  if (direct) {
    return direct;
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(String(text || ""));
  if (fenced?.[1]) {
    const parsed = tryParseJson(fenced[1]);
    if (parsed) {
      return parsed;
    }
  }

  const objectCandidate = extractFirstJsonObject(text);
  const parsed = tryParseJson(objectCandidate);
  if (parsed) {
    return parsed;
  }

  throw new Error("semantic extractor did not return valid JSON");
}

export { normalizeText };
