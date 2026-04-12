// @ts-check

const {
  buildVisibleItemDedupKey,
  normalizeLineEndings,
  trimOuterBlankLines,
} = require("./visible-text");

function normalizeFragmentKind(value: any) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "delta") {
    return "delta";
  }
  if (normalized === "snapshot") {
    return "snapshot";
  }
  if (normalized === "completed_snapshot") {
    return "completed_snapshot";
  }
  return "";
}

function normalizeVisibleStreamingText(text: any) {
  return buildVisibleItemDedupKey(text).replace(/\s+/gu, " ").trim();
}

function normalizeStreamingSnapshotSemanticText(text: any) {
  return normalizeVisibleStreamingText(text)
    .replace(/[\p{P}\p{S}]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function chooseStreamingSnapshotReplacement(base: any, incoming: any) {
  void base;
  void incoming;
  return "";
}

function chooseCompletedSnapshotReplacement(streamed: any, finalized: any) {
  void streamed;
  void finalized;
  return "";
}

function appendDeltaFragment(current: any, next: any) {
  const base = String(current || "");
  const incoming = String(next || "");
  if (!incoming) {
    return base;
  }
  if (!base) {
    return incoming;
  }
  if (base.endsWith(incoming)) {
    return base;
  }
  if (incoming.startsWith(base)) {
    return incoming;
  }
  const maxOverlap = Math.min(base.length, incoming.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (base.slice(-size) === incoming.slice(0, size)) {
      return `${base}${incoming.slice(size)}`;
    }
  }
  return `${base}${incoming}`;
}

function appendStreamingText(current: any, next: any) {
  const base = String(current || "");
  const incoming = String(next || "");
  if (!incoming) {
    return base;
  }
  if (!base) {
    return incoming;
  }
  if (base.endsWith(incoming)) {
    return base;
  }
  if (incoming.startsWith(base)) {
    return incoming;
  }

  const replacement = chooseStreamingSnapshotReplacement(base, incoming);
  if (replacement) {
    return replacement;
  }

  const maxOverlap = Math.min(base.length, incoming.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (base.slice(-size) === incoming.slice(0, size)) {
      return `${base}${incoming.slice(size)}`;
    }
  }

  return `${base}${incoming}`;
}

function mergeCompletedItemText(current: any, completed: any) {
  const streamed = String(current || "");
  const finalized = String(completed || "");
  if (!finalized) {
    return streamed;
  }
  if (!streamed) {
    return finalized;
  }
  // Upstream can resend the same final item with only whitespace / formatting
  // differences between delta and completed snapshots. Treat those as the same
  // semantic block so we do not concatenate two copies of the same answer.
  if (normalizeVisibleStreamingText(streamed) === normalizeVisibleStreamingText(finalized)) {
    return finalized;
  }
  const finalizedReplacement = chooseCompletedSnapshotReplacement(streamed, finalized);
  if (finalizedReplacement) {
    return finalizedReplacement;
  }
  return appendStreamingText(streamed, finalized);
}

function mergeAuthoritativeItemText(current: any, incoming: any, { fragmentKind = "", completed = false }: any = {}) {
  const base = normalizeLineEndings(current);
  const next = normalizeLineEndings(incoming);
  const normalizedFragmentKind = normalizeFragmentKind(
    completed ? "completed_snapshot" : fragmentKind
  ) || (completed ? "completed_snapshot" : "delta");
  if (!next) {
    return { text: base, relation: "keep" };
  }
  if (!base) {
    return {
      text: next,
      relation: normalizedFragmentKind === "delta" ? "append" : "replace",
    };
  }
  if (normalizedFragmentKind === "delta") {
    const appended = appendDeltaFragment(base, next);
    if (appended === base) {
      return { text: base, relation: "keep" };
    }
    if (appended === next) {
      return { text: next, relation: "replace" };
    }
    return { text: appended, relation: "append" };
  }

  const baseVisible = normalizeVisibleStreamingText(base);
  const nextVisible = normalizeVisibleStreamingText(next);
  const baseSemantic = normalizeStreamingSnapshotSemanticText(base);
  const nextSemantic = normalizeStreamingSnapshotSemanticText(next);
  const equivalent = (baseVisible && baseVisible === nextVisible)
    || (baseSemantic && baseSemantic === nextSemantic);
  if (equivalent) {
    if (normalizedFragmentKind === "completed_snapshot") {
      return { text: next, relation: "replace" };
    }
    return next.length >= base.length
      ? { text: next, relation: "replace" }
      : { text: base, relation: "keep" };
  }

  const nextContainsBase = (
    (baseVisible && nextVisible && (nextVisible.startsWith(baseVisible) || nextVisible.includes(baseVisible)))
    || (baseSemantic && nextSemantic && (nextSemantic.startsWith(baseSemantic) || nextSemantic.includes(baseSemantic)))
  );
  if (nextContainsBase) {
    return { text: next, relation: "replace" };
  }

  const baseContainsNext = (
    (baseVisible && nextVisible && (baseVisible.startsWith(nextVisible) || baseVisible.includes(nextVisible)))
    || (baseSemantic && nextSemantic && (baseSemantic.startsWith(nextSemantic) || baseSemantic.includes(nextSemantic)))
  );
  if (baseContainsNext) {
    if (normalizedFragmentKind === "completed_snapshot") {
      return { text: next, relation: "replace" };
    }
    return { text: base, relation: "keep" };
  }

  return { text: next, relation: "rewrite" };
}

function buildComparisonMap(text: any, { stripPunctuation = false }: any = {}) {
  const raw = normalizeLineEndings(String(text || ""));
  const rawToComparison = new Array(raw.length + 1);
  let comparison = "";
  let lastWasSpace = true;
  rawToComparison[0] = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (/\s/u.test(character)) {
      if (!comparison || lastWasSpace) {
        rawToComparison[index + 1] = comparison.length;
        continue;
      }
      comparison += " ";
      lastWasSpace = true;
      rawToComparison[index + 1] = comparison.length;
      continue;
    }
    if (stripPunctuation && /[\p{P}\p{S}]/u.test(character)) {
      rawToComparison[index + 1] = comparison.length;
      continue;
    }
    comparison += character;
    lastWasSpace = false;
    rawToComparison[index + 1] = comparison.length;
  }

  while (comparison.endsWith(" ")) {
    comparison = comparison.slice(0, -1);
  }

  return { raw, comparison, rawToComparison };
}

function comparisonIndexToRawIndex(map: any, comparisonLength: any) {
  if (!map || !Array.isArray(map.rawToComparison) || comparisonLength <= 0) {
    return 0;
  }
  for (let index = 0; index < map.rawToComparison.length; index += 1) {
    if (map.rawToComparison[index] >= comparisonLength) {
      return index;
    }
  }
  return map.raw.length;
}

function computeVisibleDeliveryDelta(previous: any, next: any) {
  const before = trimOuterBlankLines(normalizeLineEndings(previous));
  const after = trimOuterBlankLines(normalizeLineEndings(next));
  if (!after) {
    return {
      delta: "",
      relation: "keep",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: before,
    };
  }
  if (!before) {
    return {
      delta: after,
      relation: "initial",
      deliveredVisibleBefore: "",
      deliveredVisibleAfter: after,
    };
  }
  if (after === before) {
    return {
      delta: "",
      relation: "keep",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: before,
    };
  }
  if (after.startsWith(before)) {
    return {
      delta: after.slice(before.length),
      relation: "extend",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: after,
    };
  }

  const visibleBefore = normalizeVisibleStreamingText(before);
  const visibleAfter = normalizeVisibleStreamingText(after);
  if (visibleBefore && visibleBefore === visibleAfter) {
    return {
      delta: "",
      relation: "equivalent",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: before,
    };
  }
  if (visibleBefore && visibleAfter.startsWith(visibleBefore)) {
    const nextMap = buildComparisonMap(after);
    const previousMap = buildComparisonMap(before);
    return {
      delta: after.slice(comparisonIndexToRawIndex(nextMap, previousMap.comparison.length)),
      relation: "normalized_extend",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: after,
    };
  }

  const semanticBefore = normalizeStreamingSnapshotSemanticText(before);
  const semanticAfter = normalizeStreamingSnapshotSemanticText(after);
  if (semanticBefore && semanticBefore === semanticAfter) {
    return {
      delta: "",
      relation: "semantic_equivalent",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: before,
    };
  }
  if (semanticBefore && semanticAfter.startsWith(semanticBefore)) {
    const nextMap = buildComparisonMap(after, { stripPunctuation: true });
    const previousMap = buildComparisonMap(before, { stripPunctuation: true });
    return {
      delta: after.slice(comparisonIndexToRawIndex(nextMap, previousMap.comparison.length)),
      relation: "semantic_extend",
      deliveredVisibleBefore: before,
      deliveredVisibleAfter: after,
    };
  }

  return {
    delta: "",
    relation: "rewrite_without_extension",
    deliveredVisibleBefore: before,
    deliveredVisibleAfter: before,
  };
}

module.exports = {
  appendDeltaFragment,
  appendStreamingText,
  buildComparisonMap,
  comparisonIndexToRawIndex,
  computeVisibleDeliveryDelta,
  mergeAuthoritativeItemText,
  mergeCompletedItemText,
  normalizeFragmentKind,
  normalizeStreamingSnapshotSemanticText,
  normalizeVisibleStreamingText,
};

export {};
