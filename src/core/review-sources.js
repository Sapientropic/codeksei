// @ts-check

const fs = require("fs");
const path = require("path");
const { normalizeDisplayPath } = require("./path-utils");
const { parseManagedBulletList } = require("./review-document");

function collectDiaryEntries(diaryDir, startDate, endDate) {
  const normalizedDiaryDir = normalizeText(diaryDir);
  if (!normalizedDiaryDir || !fs.existsSync(normalizedDiaryDir)) {
    return [];
  }
  return fs.readdirSync(normalizedDiaryDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(name))
    .map((name) => name.replace(/\.md$/u, ""))
    .filter((date) => date >= startDate && date <= endDate)
    .sort()
    .map((date) => parseDiaryFile(path.join(normalizedDiaryDir, `${date}.md`), date))
    .filter(Boolean);
}

function collectNightlyEntries(reviewFolderPath, startDate, endDate) {
  const normalizedFolderPath = normalizeText(reviewFolderPath);
  // Weekly/monthly review should quietly fall back to diary-only mode when the
  // nightly folder is not configured yet, rather than turning a missing helper
  // note into a hard failure.
  if (!normalizedFolderPath || !fs.existsSync(normalizedFolderPath)) {
    return [];
  }
  return fs.readdirSync(normalizedFolderPath)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(name))
    .map((name) => name.replace(/\.md$/u, ""))
    .filter((date) => date >= startDate && date <= endDate)
    .sort()
    .map((date) => parseNightlyReviewFile(path.join(normalizedFolderPath, `${date}.md`), date))
    .filter(Boolean);
}

function parseDiaryFile(filePath, date) {
  const content = normalizeLineEnding(fs.readFileSync(filePath, "utf8"));
  return {
    date,
    filePath: normalizeDisplayPath(filePath),
    todo: parseTodoSection(readSectionBody(content, "Todo")),
    timeline: parseBulletSection(readSectionBody(content, "时间线事实")),
    fragment: parseBulletSection(readSectionBody(content, "今日碎片")),
    supplement: parseSupplementSection(readSectionBody(content, "补充记录")),
    summary: parseSummarySection(readSectionBody(content, "总结")),
  };
}

function parseNightlyReviewFile(filePath, date) {
  const content = normalizeLineEnding(fs.readFileSync(filePath, "utf8"));
  return {
    date,
    filePath: normalizeDisplayPath(filePath),
    progress: parseManagedBulletList(content, "progress"),
    friction: parseManagedBulletList(content, "friction"),
    openLoops: parseManagedBulletList(content, "open-loops"),
    carryForward: parseManagedBulletList(content, "carry-forward"),
    closeout: parseManagedBulletList(content, "closeout"),
    signals: parseManagedBulletList(content, "signals"),
  };
}

function readSectionBody(content, headingText) {
  const startPattern = new RegExp(`^##\\s+${escapeRegExp(headingText)}\\s*$`, "m");
  const startMatch = startPattern.exec(content);
  if (!startMatch) {
    return "";
  }
  const headingEnd = content.indexOf("\n", startMatch.index);
  const contentStart = headingEnd >= 0 ? headingEnd + 1 : content.length;
  const rest = content.slice(contentStart);
  const nextHeading = /^\##\s+/m.exec(rest);
  if (!nextHeading) {
    return rest.trim();
  }
  return rest.slice(0, nextHeading.index).trim();
}

function parseTodoSection(body) {
  const open = [];
  const done = [];
  for (const line of splitLines(body)) {
    const match = /^- \[( |x|X)\] (.*)$/u.exec(line);
    if (!match) {
      continue;
    }
    const text = normalizeLineItem(stripTodoMetadata(match[2]));
    if (!text) {
      continue;
    }
    if (match[1].toLowerCase() === "x") {
      done.push(text);
    } else {
      open.push(text);
    }
  }
  return { open, done };
}

function stripTodoMetadata(value) {
  return String(value || "")
    .replace(/\s*<!--\s*codeksei-todo:start=\d{2}:\d{2}\s*-->\s*$/u, "")
    .trim();
}

function parseBulletSection(body) {
  return splitLines(body)
    .map((line) => {
      const match = /^-\s+(.*)$/u.exec(line);
      return normalizeLineItem(match ? match[1] : "");
    })
    .filter(Boolean);
}

function parseSummarySection(body) {
  return splitLines(body)
    .map((line) => {
      if (/^-\s+/u.test(line)) {
        return normalizeLineItem(line.replace(/^-\s+/u, ""));
      }
      return normalizeLineItem(line);
    })
    .filter((line) => line && !isReviewLeadIn(line));
}

function parseSupplementSection(body) {
  const normalized = normalizeLineEnding(body).trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\n(?=###\s)/u)
    .map((block) => {
      const lines = block.split("\n");
      const heading = normalizeLineItem(lines.shift());
      const match = /^###\s+(\d{2}:\d{2})(?:\s+(.*))?$/u.exec(heading);
      return {
        time: match?.[1] || "",
        title: normalizeLineItem(match?.[2] || ""),
        body: normalizeBody(lines.join("\n")),
      };
    })
    .filter((item) => item.title || item.body);
}

function isReviewLeadIn(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return true;
  }
  return /^今天有\d+条主线[:：]?$/u.test(normalized)
    || /^[^：:]{1,20}[：:]$/u.test(normalized);
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  collectDiaryEntries,
  collectNightlyEntries,
  parseDiaryFile,
  parseNightlyReviewFile,
};
