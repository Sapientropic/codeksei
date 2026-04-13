import { normalizeText } from "../contracts/text-normalization";

function formatTerminalPart(part: unknown): string {
  if (part instanceof Error) {
    return normalizeText(part.stack) || normalizeText(part.message) || String(part);
  }
  if (typeof part === "string") {
    return part;
  }
  if (typeof part === "undefined" || part === null) {
    return "";
  }
  if (typeof part === "object") {
    try {
      return JSON.stringify(part, null, 2);
    } catch {
      return String(part);
    }
  }
  return String(part);
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function writeStdout(text: unknown): void {
  process.stdout.write(formatTerminalPart(text));
}

export function writeStdoutLine(text: unknown = ""): void {
  process.stdout.write(ensureTrailingNewline(formatTerminalPart(text)));
}

export function writeStderrLine(text: unknown = ""): void {
  process.stderr.write(ensureTrailingNewline(formatTerminalPart(text)));
}

export function writeJson(value: unknown, { stderr = false }: { stderr?: boolean } = {}): void {
  const text = ensureTrailingNewline(JSON.stringify(value, null, 2));
  if (stderr) {
    process.stderr.write(text);
    return;
  }
  process.stdout.write(text);
}
