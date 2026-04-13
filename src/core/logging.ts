import { inspect } from "node:util";

import { redactSensitiveText } from "../contracts/redact";
import { normalizeText } from "../contracts/text-normalization";

type LogMethod = "error" | "log" | "warn";

function formatLogPart(part: unknown): string {
  if (part instanceof Error) {
    return normalizeText(part.stack) || normalizeText(part.message) || String(part);
  }
  if (typeof part === "string") {
    return part;
  }
  if (typeof part === "number" || typeof part === "boolean" || typeof part === "bigint") {
    return String(part);
  }
  if (typeof part === "undefined" || part === null) {
    return "";
  }
  try {
    return JSON.stringify(part);
  } catch {
    return inspect(part, {
      breakLength: Infinity,
      compact: true,
      depth: 5,
      sorted: true,
    });
  }
}

function formatLogText(parts: unknown[]): string {
  return redactSensitiveText(parts.map((part) => formatLogPart(part)).filter(Boolean).join(" "), 4_000);
}

function emitLog(method: LogMethod, parts: unknown[]): void {
  const text = formatLogText(parts);
  if (!text) {
    return;
  }
  console[method](text);
}

export function logInfo(...parts: unknown[]): void {
  emitLog("log", parts);
}

export function logWarn(...parts: unknown[]): void {
  emitLog("warn", parts);
}

export function logError(...parts: unknown[]): void {
  emitLog("error", parts);
}

export { formatLogText };
