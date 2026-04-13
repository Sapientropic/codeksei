export function normalizePlainTextForWeixin(text: unknown): string {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  return trimOuterBlankLines(normalized.replace(/\n\s*\n(?:\s*\n)+/g, "\n\n"));
}

export function chunkReplyText(text: unknown, limit = 3500): string[] {
  const normalized = trimOuterBlankLines(String(text || "").replace(/\r\n/g, "\n"));
  if (!normalized.trim()) {
    return [];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    const splitIndex = Math.max(
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf(" "),
    );
    const cut = splitIndex > limit * 0.4 ? splitIndex + (candidate[splitIndex] === "\n" ? 0 : 1) : limit;
    const chunk = trimOuterBlankLines(remaining.slice(0, cut));
    if (chunk.trim()) {
      chunks.push(chunk);
    }
    remaining = trimOuterBlankLines(remaining.slice(cut));
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.filter(Boolean);
}

export function chunkReplyTextForWeixin(text: unknown, limit = 80): string[] {
  const normalized = trimOuterBlankLines(String(text || "").replace(/\r\n/g, "\n"));
  if (!normalized.trim()) {
    return [];
  }

  const boundaries = collectStreamingBoundaries(normalized);
  if (!boundaries.length) {
    return chunkReplyText(normalized, limit);
  }

  const units: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    if (boundary <= start) {
      continue;
    }
    const unit = trimOuterBlankLines(normalized.slice(start, boundary));
    if (unit) {
      units.push(unit);
    }
    start = boundary;
  }

  const tail = trimOuterBlankLines(normalized.slice(start));
  if (tail) {
    units.push(tail);
  }

  if (!units.length) {
    return chunkReplyText(normalized, limit);
  }

  const chunks: string[] = [];
  for (const unit of units) {
    if (unit.length <= limit) {
      chunks.push(unit);
      continue;
    }
    chunks.push(...chunkReplyText(unit, limit));
  }
  return chunks.filter(Boolean);
}

export function packChunksForWeixinDelivery(
  chunks: unknown,
  maxMessages = 10,
  maxChunkChars = 3800,
): string[] {
  const normalizedChunks = Array.isArray(chunks)
    ? chunks.map((chunk) => normalizePlainTextForWeixin(chunk)).filter(Boolean)
    : [];
  if (!normalizedChunks.length) {
    return normalizedChunks;
  }
  const packed: string[] = [];
  for (const chunk of normalizedChunks) {
    if (chunk.length <= maxChunkChars) {
      packed.push(chunk);
      continue;
    }
    packed.push(...chunkReplyText(chunk, maxChunkChars));
  }

  // `maxMessages` stays as an extreme safety budget, but readability wins over
  // bubble minimization. Preserve semantic chunk boundaries instead of merging
  // them back together just to hit a smaller message count.
  void maxMessages;
  return packed;
}

export function collectStreamingBoundaries(text: string): number[] {
  const boundaries = new Set<number>();

  const regex = /\n\s*\n+/g;
  let match = regex.exec(text);
  while (match) {
    boundaries.add(match.index + match[0].length);
    match = regex.exec(text);
  }

  const listRegex = /\n(?:(?:[-*])\s+|(?:\d+\.)\s+)/g;
  match = listRegex.exec(text);
  while (match) {
    boundaries.add(match.index + 1);
    match = listRegex.exec(text);
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] || "";
    if (!/[。！？!?]/.test(char)) {
      continue;
    }

    let end = index + 1;
    while (end < text.length && /["'”’）)\]」』】]/.test(text[end] || "")) {
      end += 1;
    }
    while (end < text.length && /[\t \n]/.test(text[end] || "")) {
      end += 1;
    }
    boundaries.add(end);
  }

  return Array.from(boundaries).sort((left, right) => left - right);
}

export function trimOuterBlankLines(text: unknown): string {
  return String(text || "")
    .replace(/^\s*\n+/g, "")
    .replace(/\n+\s*$/g, "");
}
