import * as fs from "node:fs";
import * as path from "node:path";

import { PRIMARY_NOTE_SYNC_MARKER_PREFIX } from "../core/branding";
import { listTrackedProjects } from "../core/project-radar";
import {
  normalizeDisplayPath,
  resolveCrossPlatformPath,
  resolveCrossPlatformPathFromRoot,
} from "../core/path-utils";
import { writeForeignTextDocument } from "../state/json-state";

const SLOT_MARKER_PREFIX = PRIMARY_NOTE_SYNC_MARKER_PREFIX;

function resolveNoteSyncTarget(config: any = {}, options: any = {}) {
  const normalizedProject = normalizeText(options.project);
  const normalizedPath = normalizeText(options.path);
  if (normalizedProject && normalizedPath) {
    throw new Error("--project 和 --path 只能二选一");
  }
  if (!normalizedProject && !normalizedPath) {
    throw new Error("缺少目标 note，传 --project <slug> 或 --path <path>");
  }

  if (normalizedProject) {
    const trackedProjects = listTrackedProjects(config);
    const matched = trackedProjects.find((project: any) => matchesProjectSelector(project, normalizedProject));
    if (!matched) {
      const available = trackedProjects.map((project: any) => project.slug).join(", ");
      throw new Error(`找不到代码项目: ${normalizedProject}；当前可用 slug: ${available}`);
    }
    return {
      kind: "project",
      label: matched.slug,
      filePath: matched.notePath,
    };
  }

  return {
    kind: "path",
    label: normalizedPath,
    filePath: resolveNotePath(config.workspaceRoot, normalizedPath),
  };
}

function resolveNotePath(workspaceRoot: any, targetPath: any) {
  if (path.isAbsolute(targetPath) || path.win32.isAbsolute(targetPath)) {
    return resolveCrossPlatformPath(targetPath);
  }
  const baseRoot = normalizeText(workspaceRoot) || process.cwd();
  return resolveCrossPlatformPathFromRoot(baseRoot, targetPath);
}

function syncNoteFile(options: any = {}) {
  const filePath = normalizeText(options.filePath);
  if (!filePath) {
    throw new Error("note filePath 不能为空");
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`note 文件不存在: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`只能同步文件，不能同步目录: ${filePath}`);
  }

  const current = fs.readFileSync(filePath, "utf8");
  const result = syncNoteContent(current, options);
  if (result.changed) {
    writeForeignTextDocument(filePath, result.content, { encoding: "utf8" });
  }
  return {
    ...result,
    filePath: normalizeDisplayPath(filePath),
  };
}

function syncNoteContent(content: any, options: any = {}) {
  const section = normalizeText(options.section);
  if (!section) {
    throw new Error("缺少 --section");
  }

  const style = normalizeStyle(options.style);
  const text = style === "bullet"
    ? normalizeBulletText(options.text)
    : normalizeParagraphText(options.text);
  if (!text) {
    throw new Error("note 内容不能为空，传 --text 或通过 stdin 输入");
  }

  let working = normalizeFileEnding(content);
  if (!working) {
    working = "";
  }
  if (working && !working.endsWith("\n")) {
    working += "\n";
  }

  let range = findSectionRange(working, section);
  let createdSection = false;
  if (!range) {
    working = appendSection(working, section);
    range = findSectionRange(working, section);
    createdSection = true;
  }
  if (!range) {
    throw new Error(`无法定位 section: ${section}`);
  }

  const currentBody = working.slice(range.contentStart, range.end);
  const nextBody = normalizeText(options.slot)
    ? upsertManagedSlot(currentBody, range.level, {
      slot: options.slot,
      style,
      text,
    })
    : upsertSectionEntry(currentBody, range.level, {
      style,
      text,
      maxItems: normalizeMaxItems(options.maxItems),
    });

  const next = replaceSectionBody(working, range, nextBody);
  const finalContent = ensureTrailingNewline(next);
  return {
    changed: normalizeFileEnding(finalContent) !== ensureTrailingNewline(content),
    createdSection,
    content: finalContent,
  };
}

function upsertManagedSlot(sectionBody: any, parentLevel: any, options: any = {}) {
  const slot = normalizeText(options.slot);
  if (!slot) {
    throw new Error("slot 不能为空");
  }
  const block = buildManagedBlock(slot, options.text, options.style);
  const existingPattern = buildManagedSlotPattern(slot);

  const normalizedBody = normalizeFileEnding(sectionBody);
  if (existingPattern.test(normalizedBody)) {
    return normalizedBody.replace(existingPattern, block).trimEnd();
  }

  const { main, suffix } = splitSectionBody(normalizedBody, parentLevel);
  return joinSectionParts(main, suffix, block);
}

function buildManagedBlock(slot: any, text: any, style: any) {
  const markerStart = `<!-- ${SLOT_MARKER_PREFIX}:${slot}:start -->`;
  const markerEnd = `<!-- ${SLOT_MARKER_PREFIX}:${slot}:end -->`;
  const body = renderEntryText(text, style);
  return [markerStart, body, markerEnd].join("\n");
}

function buildManagedSlotPattern(slot: any) {
  const normalizedSlot = escapeRegExp(slot);
  return new RegExp(
    `<!--\\s*${escapeRegExp(SLOT_MARKER_PREFIX)}:${normalizedSlot}:start\\s*-->[\\s\\S]*?<!--\\s*${escapeRegExp(SLOT_MARKER_PREFIX)}:${normalizedSlot}:end\\s*-->`,
    "u"
  );
}

function upsertSectionEntry(sectionBody: any, parentLevel: any, options: any = {}) {
  const { main, suffix } = splitSectionBody(sectionBody, parentLevel);
  const nextMain = options.style === "paragraph"
    ? upsertParagraph(main, options.text)
    : upsertBullet(main, options.text, options.maxItems);
  return joinSectionParts(nextMain, suffix);
}

function splitSectionBody(sectionBody: any, parentLevel: any) {
  const normalizedBody = normalizeFileEnding(sectionBody);
  for (const heading of parseHeadings(normalizedBody)) {
    if (heading.level > parentLevel) {
      return {
        main: normalizedBody.slice(0, heading.index).trimEnd(),
        suffix: normalizedBody.slice(heading.index).trim(),
      };
    }
  }
  return {
    main: normalizedBody.trimEnd(),
    suffix: "",
  };
}

function joinSectionParts(main: any, suffix: any, injectedBlock: string = "") {
  const normalizedMain = normalizeFileEnding(main).trimEnd();
  const normalizedSuffix = normalizeFileEnding(suffix).trim();
  const normalizedBlock = normalizeFileEnding(injectedBlock).trim();
  const parts = [];

  if (normalizedMain) {
    parts.push(normalizedMain);
  }
  if (normalizedBlock) {
    parts.push(normalizedBlock);
  }
  if (normalizedSuffix) {
    parts.push(normalizedSuffix);
  }
  return parts.join("\n\n").trimEnd();
}

function upsertBullet(sectionMain: any, text: any, maxItems: number = 0) {
  const normalizedText = normalizeBulletText(text);
  if (!normalizedText) {
    return normalizeFileEnding(sectionMain).trimEnd();
  }

  const lines = normalizeFileEnding(sectionMain).split("\n");
  const bulletIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^-\s+(.*)$/u.exec(String(lines[index] || "").trim());
    if (!match) {
      continue;
    }
    if (normalizeBulletText(match[1]) === normalizedText) {
      return normalizeFileEnding(sectionMain).trimEnd();
    }
    bulletIndexes.push(index);
  }

  const entryLine = `- ${normalizedText}`;
  if (bulletIndexes.length) {
    lines.splice(bulletIndexes[0], 0, entryLine);
  } else {
    while (lines.length && !String(lines[lines.length - 1] || "").trim()) {
      lines.pop();
    }
    if (lines.length) {
      lines.push("");
    }
    lines.push(entryLine);
  }

  if (maxItems > 0) {
    let seen = 0;
    const trimmedLines = [];
    for (const line of lines) {
      const isBullet = /^-\s+/.test(String(line || "").trim());
      if (!isBullet) {
        trimmedLines.push(line);
        continue;
      }
      seen += 1;
      if (seen <= maxItems) {
        trimmedLines.push(line);
      }
    }
    return trimBlock(trimmedLines.join("\n"));
  }

  return trimBlock(lines.join("\n"));
}

function upsertParagraph(sectionMain: any, text: any) {
  const normalizedText = normalizeParagraphText(text);
  if (!normalizedText) {
    return normalizeFileEnding(sectionMain).trimEnd();
  }

  const blocks = normalizeFileEnding(sectionMain)
    .split(/\n{2,}/u)
    .map((block: any) => block.trim())
    .filter(Boolean);
  const comparableText = normalizeComparableText(normalizedText);
  if (blocks.some((block: any) => normalizeComparableText(block) === comparableText)) {
    return normalizeFileEnding(sectionMain).trimEnd();
  }

  const normalizedMain = normalizeFileEnding(sectionMain).trimEnd();
  if (!normalizedMain) {
    return normalizedText;
  }
  return `${normalizedMain}\n\n${normalizedText}`;
}

function renderEntryText(text: any, style: any) {
  if (style === "paragraph") {
    return normalizeParagraphText(text);
  }
  return `- ${normalizeBulletText(text)}`;
}

function replaceSectionBody(content: any, range: any, newBody: any) {
  const before = content.slice(0, range.contentStart).replace(/\s*$/u, "");
  const after = content.slice(range.end).replace(/^\s*/u, "");
  const parts = [before];
  const normalizedBody = trimBlock(newBody);
  if (normalizedBody) {
    parts.push(normalizedBody);
  }
  if (after) {
    parts.push(after);
  }
  return parts.filter(Boolean).join("\n\n");
}

function findSectionRange(content: any, sectionTitle: any) {
  const headings = parseHeadings(content);
  const normalizedTitle = normalizeHeadingText(sectionTitle);
  const currentHeading = headings.find((heading: any) => normalizeHeadingText(heading.title) === normalizedTitle);
  if (!currentHeading) {
    return null;
  }
  const nextHeading = headings.find((heading: any) =>
    heading.index > currentHeading.index && heading.level <= currentHeading.level
  );
  return {
    level: currentHeading.level,
    headingStart: currentHeading.index,
    contentStart: currentHeading.lineEnd,
    end: nextHeading ? nextHeading.index : content.length,
  };
}

function parseHeadings(content: any) {
  const normalized = normalizeFileEnding(content);
  const headings = [];
  let index = 0;
  let activeFenceMarker = "";

  while (index < normalized.length) {
    const nextBreak = normalized.indexOf("\n", index);
    const lineBreakIndex = nextBreak === -1 ? normalized.length : nextBreak;
    const hasTrailingNewline = nextBreak !== -1;
    const line = normalized.slice(index, lineBreakIndex);
    const lineEnd = hasTrailingNewline ? lineBreakIndex + 1 : lineBreakIndex;
    const trimmed = line.trim();
    const fenceMatch = /^\s*(```+|~~~+)/u.exec(line);

    if (activeFenceMarker) {
      if (fenceMatch && fenceMatch[1][0] === activeFenceMarker) {
        activeFenceMarker = "";
      }
      index = lineEnd;
      continue;
    }

    if (fenceMatch) {
      activeFenceMarker = fenceMatch[1][0];
      index = lineEnd;
      continue;
    }

    if (!trimmed || /^\s*>/u.test(line)) {
      index = lineEnd;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (headingMatch) {
      headings.push({
        level: headingMatch[1].length,
        title: headingMatch[2],
        index,
        lineEnd,
      });
    }
    index = lineEnd;
  }
  return headings;
}

function appendSection(content: any, sectionTitle: any) {
  const normalized = normalizeFileEnding(content).replace(/\s*$/u, "");
  const heading = `## ${sectionTitle}`;
  if (!normalized) {
    return `${heading}\n`;
  }
  return `${normalized}\n\n${heading}\n`;
}

function matchesProjectSelector(project: any, selector: any) {
  const normalizedSelector = normalizeText(selector).toLowerCase();
  return project.slug.toLowerCase() === normalizedSelector
    || normalizeText(project.title).toLowerCase() === normalizedSelector
    || (Array.isArray(project.aliases)
      && project.aliases.some((alias: any) => normalizeText(alias).toLowerCase() === normalizedSelector));
}

function normalizeStyle(value: any) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized || normalized === "bullet") {
    return "bullet";
  }
  if (normalized === "paragraph") {
    return "paragraph";
  }
  throw new Error(`不支持的 note style: ${value}`);
}

function normalizeMaxItems(value: any) {
  const raw = String(value || "").trim();
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--max-items 必须是正整数: ${value}`);
  }
  return parsed;
}

function normalizeBulletText(value: any) {
  return normalizeParagraphText(value).replace(/\s*\n+\s*/gu, " ").replace(/\s{2,}/gu, " ").trim();
}

function normalizeParagraphText(value: any) {
  return normalizeFileEnding(value).trim();
}

function normalizeHeadingText(value: any) {
  return normalizeText(value).replace(/\s+/gu, " ").toLowerCase();
}

function normalizeComparableText(value: any) {
  return normalizeParagraphText(value).replace(/\s+/gu, " ").toLowerCase();
}

function normalizeFileEnding(value: any) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureTrailingNewline(value: any) {
  const normalized = normalizeFileEnding(value);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function trimBlock(value: any) {
  return normalizeFileEnding(value).replace(/^\s*\n/gu, "").replace(/\n\s*$/gu, "").trimEnd();
}

function escapeRegExp(value: any) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export {
  appendSection,
  findSectionRange,
  normalizeBulletText,
  normalizeStyle,
  resolveNoteSyncTarget,
  syncNoteContent,
  syncNoteFile,
};
