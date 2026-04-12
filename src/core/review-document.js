// @ts-check

const {
  PRIMARY_REVIEW_MARKER_PREFIX,
  LEGACY_REVIEW_MARKER_PREFIX,
} = require("./branding");
const {
  LEGACY_TIMELINE_TIMEZONE,
  formatDateInTimezone,
  formatDateTimeInTimezone,
} = require("./timezone");

const REVIEW_MARKER_PREFIX = PRIMARY_REVIEW_MARKER_PREFIX;
const REVIEW_MARKER_PREFIXES = [PRIMARY_REVIEW_MARKER_PREFIX, LEGACY_REVIEW_MARKER_PREFIX];

function buildReviewSections(kind, carryLabel) {
  if (kind === "nightly") {
    return [
      { heading: "## 今晚窗口", slot: "window" },
      { heading: "## 今天最真实的推进", slot: "progress" },
      { heading: "## 今天的消耗与摩擦", slot: "friction" },
      { heading: "## 今晚还开着的线头", slot: "open-loops" },
      { heading: `## ${carryLabel}`, slot: "carry-forward" },
      { heading: "## 睡前收口摘录", slot: "closeout" },
      { heading: "## 值得带走的信号", slot: "signals" },
      { heading: "## Agent 判断", staticBody: "- " },
    ];
  }
  return [
    { heading: "## 本周期窗口", slot: "window" },
    { heading: "## 这段时间最真实的推进", slot: "progress" },
    { heading: "## 消耗与摩擦", slot: "friction" },
    { heading: "## 还开着的线头", slot: "open-loops" },
    { heading: `## ${carryLabel}`, slot: "carry-forward" },
    { heading: "## 每天收口摘录", slot: "daily-summaries" },
    { heading: "## 值得回看的补充记录", slot: "supplements" },
    { heading: "## Agent 判断", staticBody: "- " },
  ];
}

function buildReviewFileSkeleton(review, now = new Date()) {
  const timezone = review?.window?.timezone || LEGACY_TIMELINE_TIMEZONE;
  const createdAt = formatDateTimeInTimezone(now, timezone);
  const updated = formatDateInTimezone(now, timezone);
  const frontmatter = [
    "---",
    `created: ${createdAt}`,
    `updated: ${updated}`,
    "type: review",
    `review_period: ${review.profile.kind}`,
    `period_label: ${review.draft.periodLabel}`,
    `period_start: ${review.window.startDate}`,
    `period_end: ${review.window.endDate}`,
    `source_diary_days: ${review.draft.sourceDiaryDays}`,
  ];

  if (review.profile.kind !== "nightly") {
    frontmatter.push(`source_nightly_days: ${review.draft.sourceNightlyDays}`);
  }

  frontmatter.push(
    "status: working",
    "tags:",
    ...review.profile.tags.map((tag) => `  - ${tag}`),
    "---",
    `# ${review.draft.periodTitle}`,
    "",
    `> ${review.profile.intro} `,
    ""
  );

  for (const section of review.profile.sections) {
    frontmatter.push(section.heading);
    if (section.slot) {
      frontmatter.push(buildManagedBlock(section.slot, ""));
    } else {
      frontmatter.push(section.staticBody || "");
    }
    frontmatter.push("");
  }

  return frontmatter.join("\n");
}

function syncReviewContent(content, review, now = new Date()) {
  const timezone = review?.window?.timezone || LEGACY_TIMELINE_TIMEZONE;
  let next = ensureReviewSections(normalizeLineEnding(content), review);
  next = updateFrontmatterValue(next, "updated", formatDateInTimezone(now, timezone));
  next = updateFrontmatterValue(next, "period_label", review.draft.periodLabel);
  next = updateFrontmatterValue(next, "period_start", review.window.startDate);
  next = updateFrontmatterValue(next, "period_end", review.window.endDate);
  next = updateFrontmatterValue(next, "source_diary_days", String(review.diaryEntries.length));
  if (review.profile.kind !== "nightly") {
    next = updateFrontmatterValue(next, "source_nightly_days", String(review.nightlyEntries.length));
  }

  next = replaceHeading(next, 1, review.draft.periodTitle);
  for (const [slot, body] of Object.entries(review.draft.content)) {
    next = upsertManagedBlock(next, slot, body);
  }
  return ensureTrailingNewline(next);
}

function ensureReviewSections(content, review) {
  let next = content;
  for (const section of review.profile.sections) {
    const headingPattern = new RegExp(`^${escapeRegExp(section.heading)}\\s*$`, "m");
    const hasHeading = headingPattern.test(next);
    const hasBlock = !section.slot || hasManagedBlock(next, section.slot);
    if (hasHeading && hasBlock) {
      continue;
    }

    const sectionBody = section.slot
      ? buildManagedBlock(section.slot, "")
      : (section.staticBody || "");

    if (!hasHeading) {
      next = `${next.replace(/\s*$/u, "")}\n\n${section.heading}\n${sectionBody}\n`;
      continue;
    }

    if (section.slot && !hasBlock) {
      next = next.replace(
        headingPattern,
        `${section.heading}\n${buildManagedBlock(section.slot, "")}`
      );
    }
  }
  return next;
}

function upsertManagedBlock(content, slot, body) {
  const block = buildManagedBlock(slot, body);
  const pattern = buildManagedBlockPattern(slot);
  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }
  return `${content.replace(/\s*$/u, "")}\n\n${block}\n`;
}

function buildManagedBlock(slot, body) {
  return [
    `<!-- ${REVIEW_MARKER_PREFIX}:${slot}:start -->`,
    String(body || "").trim(),
    `<!-- ${REVIEW_MARKER_PREFIX}:${slot}:end -->`,
  ].join("\n");
}

function hasManagedBlock(content, slot) {
  return REVIEW_MARKER_PREFIXES.some((prefix) => {
    const markerStart = `<!-- ${prefix}:${slot}:start -->`;
    const markerEnd = `<!-- ${prefix}:${slot}:end -->`;
    return content.includes(markerStart) && content.includes(markerEnd);
  });
}

function readManagedBlock(content, slot) {
  const pattern = buildManagedBlockPattern(slot, true);
  const match = pattern.exec(content);
  return match?.[1] || "";
}

function buildManagedBlockPattern(slot, captureBody = false) {
  // Keep reading both legacy and current marker prefixes so old review notes
  // can be upgraded in place instead of silently forking a second managed block.
  const prefixPattern = REVIEW_MARKER_PREFIXES.map(escapeRegExp).join("|");
  const normalizedSlot = escapeRegExp(slot);
  const bodyPattern = captureBody ? "([\\s\\S]*?)" : "[\\s\\S]*?";
  return new RegExp(
    `<!--\\s*(?:${prefixPattern}):${normalizedSlot}:start\\s*-->\\n?${bodyPattern}\\n?<!--\\s*(?:${prefixPattern}):${normalizedSlot}:end\\s*-->`,
    "u"
  );
}

function parseManagedBulletList(content, slot) {
  return splitLines(readManagedBlock(content, slot))
    .map((line) => {
      if (/^###\s+/u.test(line)) {
        return "";
      }
      if (/^-\s+/u.test(line)) {
        return normalizeLineItem(line.replace(/^-\s+/u, ""));
      }
      return normalizeLineItem(line);
    })
    .filter((line) => line && !isGeneratedFallbackLine(line));
}

function replaceHeading(content, level, title) {
  const pattern = new RegExp(`^${"#".repeat(level)}\\s+.*$`, "m");
  if (!pattern.test(content)) {
    return content;
  }
  return content.replace(pattern, `${"#".repeat(level)} ${title}`);
}

function updateFrontmatterValue(content, key, value) {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) {
    return content;
  }
  const frontmatter = content.slice(4, end);
  const rest = content.slice(end + 5);
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, "m");
  const nextFrontmatter = pattern.test(frontmatter)
    ? frontmatter.replace(pattern, `${key}: ${value}`)
    : `${frontmatter}\n${key}: ${value}`;
  return `---\n${nextFrontmatter}\n---\n${rest.replace(/^\n*/u, "")}`;
}

function isGeneratedFallbackLine(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return true;
  }
  return /还没有可用|还没有明显|没有明显还开着|没有明显的摩擦|下一次先从最小动作|明天先从最小动作|没有可引用的每日总结|没有值得回看的补充记录|睡前收口还没有写出来|还没有稳定到值得带走的信号/u.test(normalized);
}

function splitLines(body) {
  return normalizeLineEnding(body)
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

function normalizeBody(value) {
  return normalizeLineEnding(value).trim();
}

function normalizeLineItem(value) {
  return normalizeBody(value).replace(/\s*\n+\s*/gu, " ").replace(/\s{2,}/gu, " ").trim();
}

function normalizeLineEnding(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureTrailingNewline(value) {
  const normalized = normalizeLineEnding(value);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  buildReviewFileSkeleton,
  buildReviewSections,
  parseManagedBulletList,
  syncReviewContent,
};
