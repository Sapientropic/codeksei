const fs = require("fs");
const path = require("path");
const { PACKAGE_NAME } = require("../core/branding");
const {
  LEGACY_TIMELINE_TIMEZONE,
  formatDateInTimezone,
  formatDateTimeInTimezone,
  formatTimeInTimezone,
} = require("../core/timezone");

const DEFAULT_SECTION = "supplement";
const SECTION_HEADINGS = Object.freeze({
  todo: "Todo",
  timeline: "时间线事实",
  fragment: "今日碎片",
  supplement: "补充记录",
  summary: "总结",
});
const TODO_STATE_MARKERS = Object.freeze({
  open: " ",
  done: "x",
});

async function runDiaryWriteCommand(config) {
  const args = process.argv.slice(4);
  const options = parseArgs(args);
  const body = await resolveBody(options);
  if (!body) {
    throw new Error("日记内容不能为空，传 --text 或通过 stdin 输入");
  }

  const now = new Date();
  const timezone = config?.timezone || LEGACY_TIMELINE_TIMEZONE;
  const dateString = options.date || formatDate(now, timezone);
  const timeString = options.time || formatTime(now, timezone);
  const section = normalizeSection(options.section);
  const todoState = normalizeTodoState(options.state, section);
  const usesLegacyTodoDoneFallback = shouldSynthesizeTodoDoneTimelineText({
    section,
    todoState,
    timelineText: options.timelineText,
  });
  const filePath = path.join(config.diaryDir, `${dateString}.md`);
  const entryPayloads = buildDiaryWriteEntryPayloads({
    section,
    timeString,
    title: options.title,
    body,
    todoState,
    timelineText: options.timelineText,
  });
  if (usesLegacyTodoDoneFallback) {
    console.warn(
      `[${PACKAGE_NAME}] diary:write legacy todo-done call omitted --timeline-text; `
      + "synthesized a minimal point-in-time diary fact to keep the cutover atomic."
    );
  }

  fs.mkdirSync(config.diaryDir, { recursive: true });
  ensureDiaryFile(filePath, now, timezone);
  const current = fs.readFileSync(filePath, "utf8");
  const next = entryPayloads.reduce(
    (draft, payload) => insertDiaryEntry(draft, payload, dateString),
    current
  );
  fs.writeFileSync(filePath, next, "utf8");
  console.log(`diary written: ${filePath}`);
}

function parseArgs(args) {
  const options = {
    text: "",
    title: "",
    date: "",
    time: "",
    section: DEFAULT_SECTION,
    state: "",
    timelineText: "",
    useStdin: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--text") {
      options.text = readOptionValue(args, index, "--text");
      index += 1;
      continue;
    }
    if (arg === "--title") {
      options.title = readOptionValue(args, index, "--title");
      index += 1;
      continue;
    }
    if (arg === "--date") {
      options.date = readOptionValue(args, index, "--date");
      index += 1;
      continue;
    }
    if (arg === "--time") {
      options.time = readOptionValue(args, index, "--time");
      index += 1;
      continue;
    }
    if (arg === "--section") {
      options.section = readOptionValue(args, index, "--section");
      index += 1;
      continue;
    }
    if (arg === "--state") {
      options.state = readOptionValue(args, index, "--state");
      index += 1;
      continue;
    }
    if (arg === "--timeline-text") {
      options.timelineText = readOptionValue(args, index, "--timeline-text");
      index += 1;
      continue;
    }
    if (arg === "--stdin") {
      options.useStdin = true;
      continue;
    }
    throw new Error(`未知参数: ${arg}`);
  }
  return options;
}

function readOptionValue(args, index, optionName) {
  const next = args[index + 1];
  if (typeof next !== "string" || next.startsWith("--")) {
    throw new Error(`${optionName} 需要一个值`);
  }
  return String(next);
}

async function resolveBody(options) {
  const inlineText = normalizeBody(options.text);
  if (inlineText) {
    return inlineText;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return normalizeBody(await readStdin());
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

function buildDiaryEntry({ timeString, title, body }) {
  const heading = title ? `### ${timeString} ${title.trim()}` : `### ${timeString}`;
  return `${heading}\n\n${body}`;
}

function buildDiaryEntryPayload({ section = DEFAULT_SECTION, timeString, title, body, todoState = "open" }) {
  const normalizedSection = normalizeSection(section);
  const normalizedTitle = normalizeLineItem(title);
  const normalizedBody = normalizeBody(body);
  if (!normalizedBody) {
    throw new Error("日记内容不能为空，传 --text 或通过 stdin 输入");
  }

  if (normalizedSection === "supplement") {
    return {
      section: normalizedSection,
      entry: buildDiaryEntry({
        timeString,
        title: normalizedTitle,
        body: normalizedBody,
      }),
      title: normalizedTitle,
      body: normalizedBody,
    };
  }

  const lineText = buildSectionLineText({ title: normalizedTitle, body: normalizedBody });
  if (!lineText) {
    throw new Error("当前 section 需要非空单行内容");
  }

  if (normalizedSection === "todo") {
    const normalizedState = normalizeTodoState(todoState, normalizedSection);
    return {
      section: normalizedSection,
      entry: `- [${TODO_STATE_MARKERS[normalizedState]}] ${lineText}`,
      text: lineText,
      todoState: normalizedState,
    };
  }

  return {
    section: normalizedSection,
    entry: `- ${lineText}`,
    text: lineText,
  };
}

function buildDiaryWriteEntryPayloads({
  section = DEFAULT_SECTION,
  timeString,
  title,
  body,
  todoState = "open",
  timelineText = "",
}) {
  const normalizedSection = normalizeSection(section);
  const normalizedTodoState = normalizeTodoState(todoState, normalizedSection);
  const normalizedTimelineText = normalizeLineItem(timelineText)
    || synthesizeTodoDoneTimelineText({ section, timeString, title, body, todoState });

  if (normalizedTimelineText && (normalizedSection !== "todo" || normalizedTodoState !== "done")) {
    throw new Error("--timeline-text 只支持和 --section todo --state done 一起使用");
  }

  const entries = [
    buildDiaryEntryPayload({
      section: normalizedSection,
      timeString,
      title,
      body,
      todoState: normalizedTodoState,
    }),
  ];

  if (normalizedTimelineText) {
    entries.push(buildDiaryEntryPayload({
      section: "timeline",
      timeString,
      body: normalizedTimelineText,
    }));
  }

  return entries;
}

function shouldSynthesizeTodoDoneTimelineText({ section = DEFAULT_SECTION, todoState = "open", timelineText = "" }) {
  const normalizedSection = normalizeSection(section);
  const normalizedTodoState = normalizeTodoState(todoState, normalizedSection);
  return normalizedSection === "todo"
    && normalizedTodoState === "done"
    && !normalizeLineItem(timelineText);
}

function synthesizeTodoDoneTimelineText({
  section = DEFAULT_SECTION,
  timeString = "",
  title = "",
  body = "",
  todoState = "open",
}) {
  if (!shouldSynthesizeTodoDoneTimelineText({ section, todoState })) {
    return "";
  }

  const lineText = buildSectionLineText({ title, body });
  if (!lineText) {
    return "";
  }

  // Keep stale prompts from dropping the diary hard fact entirely. This
  // compatibility bridge records only a minimal point-in-time fact; fresh
  // callers should still pass --timeline-text with the real cutover context.
  const normalizedTime = normalizeLineItem(timeString);
  return normalizedTime ? `${normalizedTime} ${lineText}` : lineText;
}

function ensureDiaryFile(filePath, now, timezone = LEGACY_TIMELINE_TIMEZONE) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return;
  }
  const createdAt = formatDateTime(now, timezone);
  const updated = formatDate(now, timezone);
  fs.writeFileSync(filePath, buildDiaryFileSkeleton({ createdAt, updated }), "utf8");
}

function buildDiaryFileSkeleton({ createdAt, updated }) {
  return [
    "---",
    `created: ${createdAt}`,
    `updated: ${updated}`,
    "---",
    "## Todo",
    "- [ ] ",
    "",
    "## 时间线事实",
    "- ",
    "",
    "## 今日碎片",
    "- ",
    "",
    "## 补充记录",
    "",
    "## 总结",
    "",
  ].join("\n");
}

function insertDiaryEntry(content, entry, updatedDate) {
  const normalizedContent = normalizeFileEnding(content);
  const withUpdatedFrontmatter = updateFrontmatterValue(normalizedContent, "updated", updatedDate);
  const payload = normalizeEntryPayload(entry);
  if (payload.section === "supplement") {
    return insertSupplementEntry(withUpdatedFrontmatter, payload);
  }
  return insertBulletSectionEntry(withUpdatedFrontmatter, payload);
}

function findInsertionPoint(content) {
  const supplementSection = locateSectionStart(content, "补充记录");
  if (supplementSection >= 0) {
    const nextHeading = locateNextLevelTwoHeading(content, supplementSection + 1);
    return nextHeading >= 0 ? nextHeading : content.length;
  }
  const summarySection = locateSectionStart(content, "总结");
  if (summarySection >= 0) {
    return summarySection;
  }
  return content.length;
}

function locateSectionStart(content, headingText) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(headingText)}\\s*$`, "m");
  const match = pattern.exec(content);
  return match ? match.index : -1;
}

function locateNextLevelTwoHeading(content, fromIndex) {
  const pattern = /^##\s+/gm;
  pattern.lastIndex = fromIndex;
  const match = pattern.exec(content);
  return match ? match.index : -1;
}

function normalizeEntryPayload(entry) {
  if (typeof entry === "string") {
    return {
      section: DEFAULT_SECTION,
      entry: entry.trim(),
      title: "",
      body: "",
    };
  }
  const payload = entry && typeof entry === "object" ? entry : {};
  return {
    section: normalizeSection(payload.section),
    entry: String(payload.entry || "").trim(),
    text: normalizeLineItem(payload.text),
    title: normalizeLineItem(payload.title),
    body: normalizeBody(payload.body),
    todoState: normalizeTodoState(payload.todoState, normalizeSection(payload.section)),
  };
}

function insertSupplementEntry(content, payload) {
  const range = findSectionRange(content, SECTION_HEADINGS.supplement);
  if (!range || !payload.entry) {
    return content;
  }
  const existingBody = content.slice(range.contentStart, range.end);
  if (hasSupplementDuplicate(existingBody, payload)) {
    return content;
  }
  const normalizedBody = normalizeFileEnding(existingBody).trim();
  const nextBody = normalizedBody ? `${normalizedBody}\n\n${payload.entry}` : payload.entry;
  return replaceSectionBody(content, range, nextBody);
}

function insertBulletSectionEntry(content, payload) {
  const headingText = SECTION_HEADINGS[payload.section];
  const range = findSectionRange(content, headingText);
  if (!range || !payload.entry) {
    return content;
  }

  const lines = extractSectionLines(content.slice(range.contentStart, range.end), payload.section);
  const nextLines = payload.section === "todo"
    ? upsertTodoLine(lines, payload)
    : upsertBulletLine(lines, payload);
  return replaceSectionBody(content, range, nextLines.join("\n"));
}

function findSectionRange(content, headingText) {
  const sectionStart = locateSectionStart(content, headingText);
  if (sectionStart < 0) {
    return null;
  }
  const lineEnd = content.indexOf("\n", sectionStart);
  const contentStart = lineEnd >= 0 ? lineEnd + 1 : content.length;
  const end = locateNextLevelTwoHeading(content, contentStart);
  return {
    sectionStart,
    contentStart,
    end: end >= 0 ? end : content.length,
  };
}

function extractSectionLines(sectionBody, section) {
  const normalizedBody = normalizeFileEnding(sectionBody);
  const lines = normalizedBody.split("\n").map((line) => line.replace(/\s+$/u, ""));
  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  return lines.filter((line) => !isPlaceholderLine(line, section));
}

function isPlaceholderLine(line, section) {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return true;
  }
  if (section === "todo") {
    return trimmed === "-"
      || trimmed === "- [ ]"
      || trimmed === "- [x]"
      || trimmed === "- [X]";
  }
  return trimmed === "-" || trimmed === "*";
}

function upsertTodoLine(lines, payload) {
  const nextLines = Array.isArray(lines) ? [...lines] : [];
  const desiredLine = `- [${TODO_STATE_MARKERS[payload.todoState]}] ${payload.text}`;
  for (let index = 0; index < nextLines.length; index += 1) {
    const match = /^- \[( |x|X)\] (.*)$/u.exec(String(nextLines[index] || ""));
    if (!match) {
      continue;
    }
    if (normalizeLineItem(match[2]) !== payload.text) {
      continue;
    }
    nextLines[index] = desiredLine;
    return nextLines;
  }
  nextLines.push(desiredLine);
  return nextLines;
}

function upsertBulletLine(lines, payload) {
  const nextLines = Array.isArray(lines) ? [...lines] : [];
  for (const line of nextLines) {
    const match = /^- (.*)$/u.exec(String(line || ""));
    if (!match) {
      continue;
    }
    if (normalizeLineItem(match[1]) === payload.text) {
      return nextLines;
    }
  }
  nextLines.push(payload.entry);
  return nextLines;
}

function replaceSectionBody(content, range, newBody) {
  const before = content.slice(0, range.contentStart).replace(/\s*$/u, "");
  const after = content.slice(range.end).replace(/^\s*/u, "");
  const parts = [before];
  if (newBody.trim()) {
    parts.push(newBody.trimEnd());
  }
  if (after) {
    parts.push(after);
  }
  return `${parts.filter(Boolean).join("\n\n").trimEnd()}\n`;
}

function hasSupplementDuplicate(sectionBody, payload) {
  const targetBody = normalizeBody(payload.body);
  if (!targetBody) {
    return false;
  }
  const targetTitle = normalizeLineItem(payload.title);
  return parseSupplementBlocks(sectionBody).some((block) =>
    block.title === targetTitle && block.body === targetBody
  );
}

function parseSupplementBlocks(sectionBody) {
  const normalizedBody = normalizeFileEnding(sectionBody).trim();
  if (!normalizedBody) {
    return [];
  }
  return normalizedBody
    .split(/\n(?=###\s)/u)
    .map((block) => {
      const lines = block.split("\n");
      const heading = String(lines.shift() || "").trim();
      const match = /^###\s+\d{2}:\d{2}(?:\s+(.*))?$/u.exec(heading);
      return {
        title: normalizeLineItem(match?.[1] || ""),
        body: normalizeBody(lines.join("\n")),
      };
    })
    .filter((block) => block.body);
}

function updateFrontmatterValue(content, key, value) {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const frontmatterEnd = content.indexOf("\n---\n", 4);
  if (frontmatterEnd < 0) {
    return content;
  }
  const frontmatter = content.slice(4, frontmatterEnd);
  const body = content.slice(frontmatterEnd + 5);
  const keyPattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, "m");
  const nextFrontmatter = keyPattern.test(frontmatter)
    ? frontmatter.replace(keyPattern, `${key}: ${value}`)
    : `${frontmatter}\n${key}: ${value}`;
  return `---\n${nextFrontmatter}\n---\n${body.replace(/^\n*/u, "")}`;
}

function normalizeFileEnding(content) {
  return String(content || "").replace(/\r\n/g, "\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSectionLineText({ title, body }) {
  const normalizedTitle = normalizeLineItem(title);
  const normalizedBody = normalizeLineItem(body);
  if (normalizedTitle && normalizedBody) {
    return `${normalizedTitle}: ${normalizedBody}`;
  }
  return normalizedTitle || normalizedBody;
}

function normalizeSection(value) {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case "":
    case "supplement":
      return "supplement";
    case "todo":
      return "todo";
    case "timeline":
      return "timeline";
    case "fragment":
      return "fragment";
    case "summary":
      return "summary";
    default:
      throw new Error(`不支持的日记 section: ${value}`);
  }
}

function normalizeTodoState(value, section = DEFAULT_SECTION) {
  const normalizedSection = normalizeSection(section);
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedSection !== "todo") {
    if (normalizedValue) {
      throw new Error("--state 只支持和 --section todo 一起使用");
    }
    return "open";
  }
  if (!normalizedValue) {
    return "open";
  }
  if (normalizedValue === "open" || normalizedValue === "done") {
    return normalizedValue;
  }
  throw new Error(`不支持的 Todo state: ${value}`);
}

function normalizeBody(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeLineItem(value) {
  return normalizeBody(value).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function formatDate(date, timezone = LEGACY_TIMELINE_TIMEZONE) {
  return formatDateInTimezone(date, timezone);
}

function formatTime(date, timezone = LEGACY_TIMELINE_TIMEZONE) {
  return formatTimeInTimezone(date, timezone);
}

function formatDateTime(date, timezone = LEGACY_TIMELINE_TIMEZONE) {
  return formatDateTimeInTimezone(date, timezone);
}

module.exports = {
  buildDiaryEntry,
  buildDiaryEntryPayload,
  buildDiaryWriteEntryPayloads,
  buildDiaryFileSkeleton,
  insertDiaryEntry,
  normalizeSection,
  normalizeTodoState,
  parseArgs,
  runDiaryWriteCommand,
};
