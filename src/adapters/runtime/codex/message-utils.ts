// @ts-check

import { normalizeLineEndings } from "../../../core/text-normalization";

export interface AssistantItemPayload {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  phase?: unknown;
  content?: unknown;
  metadata?: {
    phase?: unknown;
  };
}

export interface RuntimeMessageParams {
  delta?: unknown;
  phase?: unknown;
  content?: unknown;
  item?: AssistantItemPayload;
  metadata?: {
    phase?: unknown;
  };
  turn?: {
    id?: unknown;
    error?: {
      message?: unknown;
    };
  };
  error?: {
    message?: unknown;
  };
  threadId?: unknown;
  turnId?: unknown;
}

export interface RuntimeMessage {
  method?: unknown;
  params?: RuntimeMessageParams;
  result?: {
    thread?: {
      id?: unknown;
    };
  };
}

export function extractThreadId(response: RuntimeMessage | null | undefined): string | null {
  return normalizeIdentifier(response?.result?.thread?.id) || null;
}

export function extractThreadIdFromParams(params: RuntimeMessageParams | null | undefined): string {
  return normalizeIdentifier(params?.threadId);
}

export function extractTurnIdFromParams(params: RuntimeMessageParams | null | undefined): string {
  return normalizeIdentifier(params?.turnId || params?.turn?.id);
}

export function isAssistantItemCompleted(message: RuntimeMessage | null | undefined): boolean {
  return message?.method === "item/completed"
    && normalizeIdentifier(message?.params?.item?.type).toLowerCase() === "agentmessage";
}

export function extractAssistantText(params: RuntimeMessageParams | null | undefined): string {
  return extractAssistantDeltaText(params) || extractAssistantSnapshotText(params);
}

export function extractAssistantDeltaText(params: RuntimeMessageParams | null | undefined): string {
  return typeof params?.delta === "string" && params.delta.length > 0
    ? normalizeLineEndings(params.delta)
    : "";
}

export function extractAssistantSnapshotText(params: RuntimeMessageParams | null | undefined): string {
  const snapshotCandidates = [
    params?.item?.text,
  ];
  for (const value of snapshotCandidates) {
    if (typeof value === "string" && value.length > 0) {
      return normalizeLineEndings(value);
    }
  }

  const contentObjects = [
    params?.item?.content,
    params?.content,
  ];
  for (const content of contentObjects) {
    const extracted = extractRawTextFromContent(content);
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

export function extractAssistantDeltaFragment(
  params: RuntimeMessageParams | null | undefined,
): { text: string; fragmentKind: string } {
  const deltaText = extractAssistantDeltaText(params);
  if (deltaText) {
    return {
      text: deltaText,
      fragmentKind: "delta",
    };
  }
  const snapshotText = extractAssistantSnapshotText(params);
  if (snapshotText) {
    return {
      text: snapshotText,
      fragmentKind: "snapshot",
    };
  }
  return {
    text: "",
    fragmentKind: "",
  };
}

export function extractCompletedAssistantText(params: RuntimeMessageParams | null | undefined): string {
  return extractAssistantSnapshotText(params);
}

export function extractAssistantPhase(params: RuntimeMessageParams | null | undefined): string {
  const candidates = [
    params?.phase,
    params?.item?.phase,
    params?.item?.metadata?.phase,
    params?.metadata?.phase,
  ];
  for (const value of candidates) {
    const normalized = normalizeAssistantPhase(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export function extractFailureText(params: RuntimeMessageParams | null | undefined): string {
  const rawMessage = normalizeIdentifier(params?.turn?.error?.message || params?.error?.message);
  return rawMessage ? `执行失败：${rawMessage}` : "执行失败";
}

function normalizeIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeAssistantPhase(value: unknown): string {
  const normalized = normalizeIdentifier(value).toLowerCase();
  if (normalized === "commentary") {
    return "commentary";
  }
  // Raw Codex sessions currently emit `commentary` and `final_answer`.
  // Keep this alias list here so stream-delivery does not fall back to fragile
  // text heuristics just because the upstream phase label changed shape.
  if (normalized === "final" || normalized === "final_answer") {
    return "final";
  }
  return "";
}

const LATIN_OR_DIGIT_CHAR = /[\p{Script=Latin}\p{Nd}]/u;
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const OPENING_PUNCTUATION_CHARS = "([{<“‘「『【（《〈";
const CLOSING_PUNCTUATION_CHARS = ".,;:!?)]}>\"”’」』】）》〉、。，；：！？";
const SEGMENT_JOINER_CHARS = "-/";
const APOSTROPHE_CHARS = "'’";

function extractRawTextFromContent(content: unknown): string {
  if (typeof content === "string" && content.length > 0) {
    return normalizeLineEndings(content);
  }

  if (!content) {
    return "";
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const entry of content) {
      if (typeof entry === "string" && entry.length > 0) {
        parts.push(normalizeLineEndings(entry));
        continue;
      }
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const entryType = String(record.type || "").toLowerCase();
      if (entryType === "text" && typeof record.text === "string" && record.text.length > 0) {
        parts.push(normalizeLineEndings(record.text));
        continue;
      }
      if (typeof record.text === "string" && record.text.length > 0) {
        parts.push(normalizeLineEndings(record.text));
        continue;
      }
      if (typeof record.value === "string" && record.value.length > 0) {
        parts.push(normalizeLineEndings(record.value));
      }
    }
    return joinCodexTextContentSegments(parts);
  }

  if (typeof content !== "object") {
    return "";
  }

  const record = content as Record<string, unknown>;
  if (typeof record.text === "string" && record.text.length > 0) {
    return normalizeLineEndings(record.text);
  }

  return "";
}

function joinCodexTextContentSegments(parts: string[]): string {
  let joined = "";
  for (const part of parts) {
    if (!part) {
      continue;
    }
    // Codex can split one human-readable sentence across multiple text spans.
    // Rejoining with `join("")` silently eats English word boundaries, but this
    // logic is runtime-specific and should not become a generic normalizer.
    if (!joined) {
      joined = part;
      continue;
    }
    joined += shouldInsertCodexSegmentSpace(joined, part) ? ` ${part}` : part;
  }
  return joined;
}

function shouldInsertCodexSegmentSpace(previousText: string, nextText: string): boolean {
  const previousChar = getLastCodePoint(previousText);
  const nextChar = getFirstCodePoint(nextText);
  if (!previousChar || !nextChar) {
    return false;
  }
  if (/\s/u.test(previousChar) || /\s/u.test(nextChar)) {
    return false;
  }
  if (OPENING_PUNCTUATION_CHARS.includes(previousChar)) {
    return false;
  }
  if (SEGMENT_JOINER_CHARS.includes(previousChar) || SEGMENT_JOINER_CHARS.includes(nextChar)) {
    return false;
  }
  if (APOSTROPHE_CHARS.includes(nextChar) || CLOSING_PUNCTUATION_CHARS.includes(nextChar)) {
    return false;
  }
  if (isCjkChar(previousChar) || isCjkChar(nextChar)) {
    return false;
  }
  if (!isLatinOrDigitChar(nextChar)) {
    return false;
  }
  return isLatinOrDigitChar(previousChar) || CLOSING_PUNCTUATION_CHARS.includes(previousChar);
}

function getFirstCodePoint(text: string): string {
  return Array.from(String(text || ""))[0] || "";
}

function getLastCodePoint(text: string): string {
  const characters = Array.from(String(text || ""));
  return characters[characters.length - 1] || "";
}

function isLatinOrDigitChar(value: string): boolean {
  return Boolean(value) && LATIN_OR_DIGIT_CHAR.test(value);
}

function isCjkChar(value: string): boolean {
  return Boolean(value) && CJK_CHAR.test(value);
}
