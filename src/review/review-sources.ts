// @ts-check

import * as fs from "node:fs";
import * as path from "node:path";

import { normalizeDisplayPath } from "../core/path-utils";
import { parseManagedBulletList } from "./review-document";

function collectDiaryEntries(diaryDir: any, startDate: any, endDate: any) {
  const normalizedDiaryDir = normalizeText(diaryDir);
  if (!normalizedDiaryDir || !fs.existsSync(normalizedDiaryDir)) {
    return [];
  }
  return fs.readdirSync(normalizedDiaryDir)
    .filter((name: any) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(name))
    .map((name: any) => name.replace(/\.md$/u, ""))
    .filter((date: any) => date >= startDate && date <= endDate)
    .sort()
    .map((date: any) => parseDiaryFile(path.join(normalizedDiaryDir, `${date}.md`), date))
    .filter(Boolean);
}

function collectNightlyEntries(reviewFolderPath: any, startDate: any, endDate: any) {
  const normalizedFolderPath = normalizeText(reviewFolderPath);
  // Weekly/monthly review should quietly fall back to diary-only mode when the
  // nightly folder is not configured yet, rather than turning a missing helper
  // note into a hard failure.
  if (!normalizedFolderPath || !fs.existsSync(normalizedFolderPath)) {
    return [];
  }
  return fs.readdirSync(normalizedFolderPath)
    .filter((name: any) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(name))
    .map((name: any) => name.replace(/\.md$/u, ""))
    .filter((date: any) => date >= startDate && date <= endDate)
    .sort()
    .map((date: any) => parseNightlyReviewFile(path.join(normalizedFolderPath, `${date}.md`), date))
    .filter(Boolean);
}

function parseDiaryFile(filePath: any, date: any) {
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

function parseNightlyReviewFile(filePath: any, date: any) {
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

function readSectionBody(content: any, headingText: any) {
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

function parseTodoSection(body: any) {
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

function stripTodoMetadata(value: any) {
  return String(value || "")
    .replace(/\s*<!--\s*codeksei-todo:start=\d{2}:\d{2}\s*-->\s*$/u, "")
    .trim();
}

function parseBulletSection(body: any) {
  return splitLines(body)
    .map((line: any) => {
      const match = /^-\s+(.*)$/u.exec(line);
      return normalizeLineItem(match ? match[1] : "");
    })
    .filter(Boolean);
}

function parseSummarySection(body: any) {
  return splitLines(body)
    .map((line: any) => {
      if (/^-\s+/u.test(line)) {
        return normalizeLineItem(line.replace(/^-\s+/u, ""));
      }
      return normalizeLineItem(line);
    })
    .filter((line: any) => line && !isReviewLeadIn(line));
}

function parseSupplementSection(body: any) {
  const normalized = normalizeLineEnding(body).trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\n(?=###\s)/u)
    .map((block: any) => {
      const lines = block.split("\n");
      const heading = normalizeLineItem(lines.shift());
      const match = /^###\s+(\d{2}:\d{2})(?:\s+(.*))?$/u.exec(heading);
      return {
        time: match?.[1] || "",
        title: normalizeLineItem(match?.[2] || ""),
        body: normalizeBody(lines.join("\n")),
      };
    })
    .filter((item: any) => item.title || item.body);
}

function isReviewLeadIn(value: any) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return true;
  }
  return /^今天有\d+条主线[:：]?$/u.test(normalized)
    || /^[^：:]{1,20}[：:]$/u.test(normalized);
}

function splitLines(body: any) {
  return normalizeLineEnding(body)
    .split("\n")
    .map((line: any) => String(line || "").trim())
    .filter(Boolean);
}

function normalizeBody(value: any) {
  return normalizeLineEnding(value).trim();
}

function normalizeLineItem(value: any) {
  return normalizeBody(value).replace(/\s*\n+\s*/gu, " ").replace(/\s{2,}/gu, " ").trim();
}

function normalizeLineEnding(value: any) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegExp(value: any) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export {
  collectDiaryEntries,
  collectNightlyEntries,
  parseDiaryFile,
  parseNightlyReviewFile,
};
