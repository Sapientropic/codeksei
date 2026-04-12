// @ts-check

import { sanitizeProtocolLeakText } from "../../adapters/runtime/codex/protocol-leak-monitor";
import { normalizeAssistantPhase } from "../../adapters/runtime/codex/message-utils";

const STREAM_PROGRESS_MAX_CHARS = 120;
const STREAM_PROGRESS_MAX_LINES = 2;
const WEIXIN_DUPLICATE_BLOCK_MIN_CHARS = 120;
const WEIXIN_DUPLICATE_BLOCK_MIN_SEGMENTS = 2;

export interface VisibleDeliveryItem {
  itemId?: string;
  text?: string;
  phase?: string;
}

export interface SanitizedReplyText {
  suppress: boolean;
  text: string;
}

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeLineEndings(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n");
}

export function trimOuterBlankLines(text: unknown): string {
  return String(text || "")
    .replace(/^\s*\n+/g, "")
    .replace(/\n+\s*$/g, "");
}

function indentBlock(text: unknown): string {
  const normalized = trimOuterBlankLines(normalizeLineEndings(text));
  if (!normalized) {
    return "";
  }
  return normalized.split("\n").map((line) => `    ${line}`).join("\n");
}

export function markdownToPlainText(text: unknown): string {
  let result = normalizeLineEndings(text);
  result = result.replace(/```([^\n]*)\n?([\s\S]*?)```/g, (_match, language: string, code: string) => {
    const label = String(language || "").trim();
    const body = indentBlock(String(code || ""));
    return label ? `\n${label}:\n${body}\n` : `\n代码:\n${body}\n`;
  });
  result = result.replace(/```([^\n]*)\n?([\s\S]*)$/g, (_match, language: string, code: string) => {
    const label = String(language || "").trim();
    const body = indentBlock(String(code || ""));
    return label ? `\n${label}:\n${body}\n` : `\n代码:\n${body}\n`;
  });
  result = result.replace(/!\[[^\]]*]\([^)]*\)/g, "");
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/^#{1,6}\s*(.+)$/gm, "$1");
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/\*([^*]+)\*/g, "$1");
  result = result.replace(/^>\s?/gm, "> ");
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_match, inner: string) =>
    String(inner || "").split("|").map((cell) => cell.trim()).join("  ")
  );
  result = result.replace(/\n{3,}/g, "\n\n");
  return trimOuterBlankLines(result);
}

export function buildVisibleItemDedupKey(text: unknown): string {
  return trimOuterBlankLines(markdownToPlainText(normalizeLineEndings(text)));
}

function normalizeSilentSentinelText(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z_]/g, "");
}

function isSilentSentinelToken(value: unknown): boolean {
  const normalized = normalizeSilentSentinelText(value);
  return normalized === "SILENT";
}

function containsStructuredSilentSignal(value: unknown): boolean {
  return /\{\s*"codeksei_action"\s*:\s*"silent"\s*\}/i.test(String(value || ""));
}

function stripSilentSentinelArtifacts(value: unknown): string {
  return normalizeLineEndings(String(value || ""))
    .replace(/\{\s*"codeksei_action"\s*:\s*"silent"\s*\}/gi, "")
    .split("\n")
    .map((line) => {
      const parts = line.split(/\s+/);
      const kept = parts.filter((part) => !isSilentSentinelToken(part));
      return kept.join(" ").trim();
    })
    .filter((line, index, lines) => line || (index > 0 && index < lines.length - 1))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function arraysEqual(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function collapseAdjacentRepeatedSegments(
  text: unknown,
  { pattern, joiner }: { pattern: RegExp; joiner: string },
): string {
  const segments = String(text || "")
    .split(pattern)
    .map((segment) => trimOuterBlankLines(segment))
    .filter(Boolean);
  if (segments.length < WEIXIN_DUPLICATE_BLOCK_MIN_SEGMENTS * 2) {
    return trimOuterBlankLines(text);
  }

  const normalizedSegments = segments.map((segment) =>
    buildVisibleItemDedupKey(segment).replace(/\s+/gu, " ").trim()
  );
  for (let span = Math.floor(segments.length / 2); span >= 1; span -= 1) {
    for (let start = 0; (start + span * 2) <= segments.length; start += 1) {
      const left = normalizedSegments.slice(start, start + span);
      const right = normalizedSegments.slice(start + span, start + span * 2);
      if (!left.length || !arraysEqual(left, right)) {
        continue;
      }

      const normalizedBlock = left.join("\n");
      if (
        normalizedBlock.length < WEIXIN_DUPLICATE_BLOCK_MIN_CHARS
        || left.length < WEIXIN_DUPLICATE_BLOCK_MIN_SEGMENTS
      ) {
        continue;
      }

      return trimOuterBlankLines([
        ...segments.slice(0, start),
        ...segments.slice(start, start + span),
        ...segments.slice(start + span * 2),
      ].join(joiner));
    }
  }

  return trimOuterBlankLines(text);
}

function collapseRepeatedWechatReplyText(text: unknown): string {
  let collapsed = trimOuterBlankLines(normalizeLineEndings(text));
  if (!collapsed || collapsed.length < WEIXIN_DUPLICATE_BLOCK_MIN_CHARS * 2) {
    return collapsed;
  }

  const splitters = [
    { pattern: /\n{2,}/u, joiner: "\n\n" },
    { pattern: /\n+/u, joiner: "\n" },
  ];
  for (let pass = 0; pass < 4; pass += 1) {
    let next = collapsed;
    for (const splitter of splitters) {
      next = collapseAdjacentRepeatedSegments(next, splitter);
      if (next !== collapsed) {
        break;
      }
    }
    if (next === collapsed) {
      return collapsed;
    }
    collapsed = next;
  }
  return collapsed;
}

export function isBriefStreamingProgressText(text: unknown): boolean {
  const raw = trimOuterBlankLines(normalizeLineEndings(text));
  if (!raw) {
    return false;
  }
  if (
    raw.includes("```")
    || raw.includes("\n\n")
    || /\[[^\]]+\]\([^)]+\)/u.test(raw)
    || /^\s*(?:[-*]|\d+\.)\s/mu.test(raw)
    || raw.includes("【继续任务】")
    || raw.includes("【当前状态】")
    || raw.includes("【执行前检查】")
  ) {
    return false;
  }
  const plain = buildVisibleItemDedupKey(raw);
  if (!plain || plain.length > STREAM_PROGRESS_MAX_CHARS) {
    return false;
  }
  const lineCount = plain.split("\n").filter(Boolean).length;
  return lineCount > 0 && lineCount <= STREAM_PROGRESS_MAX_LINES;
}

export function shouldStreamImmediately(item: VisibleDeliveryItem | null | undefined): boolean {
  if (!item?.text || item.itemId === "__watchdog__") {
    return false;
  }
  const phase = normalizeAssistantPhase(item.phase);
  if (phase === "final") {
    return true;
  }
  if (!isBriefStreamingProgressText(item.text)) {
    return false;
  }
  if (phase === "commentary") {
    return true;
  }
  return true;
}

export function rememberVisiblePart(parts: string[], seenParts: Set<string>, text: unknown): void {
  const dedupeKey = buildVisibleItemDedupKey(text);
  if (dedupeKey && seenParts.has(dedupeKey)) {
    return;
  }
  if (dedupeKey) {
    seenParts.add(dedupeKey);
  }
  parts.push(String(text || ""));
}

function shouldSuppressSystemReply(replyTarget: { provider?: unknown } | null | undefined, plainReplyText: unknown): boolean {
  if (replyTarget?.provider !== "system") {
    return false;
  }
  const normalized = normalizeLineEndings(String(plainReplyText || ""));
  const compact = normalized.trim();
  if (!compact) {
    return false;
  }
  if (normalizeSilentSentinelText(compact) === "SILENT") {
    return true;
  }
  if (containsStructuredSilentSignal(normalized)) {
    return true;
  }
  return normalized
    .split("\n")
    .map((line) => normalizeSilentSentinelText(line.trim()))
    .some((line) => line === "SILENT");
}

export function sanitizeReplyText(
  replyTarget: { provider?: unknown } | null | undefined,
  plainReplyText: unknown,
): SanitizedReplyText {
  const normalized = normalizeLineEndings(String(plainReplyText || ""));
  if (!normalized) {
    return { suppress: false, text: "" };
  }
  const protocolSanitized = sanitizeProtocolLeakText(normalized);
  const safeText = protocolSanitized.text || "";
  if (shouldSuppressSystemReply(replyTarget, safeText)) {
    return { suppress: true, text: "" };
  }
  const cleaned = stripSilentSentinelArtifacts(safeText);
  const deduped = normalizeText(replyTarget?.provider) === "weixin"
    ? collapseRepeatedWechatReplyText(cleaned)
    : cleaned;
  return {
    suppress: false,
    text: trimOuterBlankLines(deduped),
  };
}
