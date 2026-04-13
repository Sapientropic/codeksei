import { normalizeText } from "./text-normalization";
import { logWarn } from "./logging";

interface SuppressedErrorOptions {
  label: string;
  reason: string;
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.stack || String(error);
  }
  return String(error || "unknown error");
}

export function isMissingFileLikeError(error: unknown): boolean {
  const message = formatErrorMessage(error).toLowerCase();
  return message.includes("enoent")
    || message.includes("no such file")
    || message.includes("cannot find the file")
    || message.includes("找不到");
}

export function isAlreadyClosedLikeError(error: unknown): boolean {
  const message = formatErrorMessage(error).toLowerCase();
  return message.includes("already closed")
    || message.includes("target closed")
    || message.includes("browser has been closed")
    || message.includes("session closed")
    || message.includes("closed");
}

export function logSuppressedError(
  error: unknown,
  {
    label,
    reason,
  }: SuppressedErrorOptions,
): void {
  const message = normalizeText(formatErrorMessage(error)) || "unknown error";
  logWarn(`[codeksei] suppressed ${label} reason=${reason} error=${message}`);
}

export async function ignoreCleanupError<T>(
  promise: Promise<T>,
  options: SuppressedErrorOptions,
): Promise<T | undefined> {
  return ignoreBestEffortError(promise, options);
}

export async function ignoreBestEffortError<T>(
  promise: Promise<T>,
  options: SuppressedErrorOptions,
): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    if (!isMissingFileLikeError(error) && !isAlreadyClosedLikeError(error)) {
      logSuppressedError(error, options);
    }
    return undefined;
  }
}
