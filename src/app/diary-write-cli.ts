const fs = require("fs");
const path = require("path");
const { PACKAGE_NAME } = require("../core/branding");
const { getCommandArgsSchema } = require("../contracts/command-args");
const { parseCliArgs } = require("../core/cli-args");
const { writeForeignTextDocument } = require("../state/json-state");
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
const TODO_LINE_RE = /^- \[( |x|X)\] (.*)$/u;
const TODO_START_MARKER_RE = /\s*<!--\s*codeksei-todo:start=(\d{2}:\d{2})\s*-->\s*$/u;

async function runDiaryWriteCommand(config: any, args: any[] = []) {
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
  const filePath = path.join(config.diaryDir, `${dateString}.md`);
  fs.mkdirSync(config.diaryDir, { recursive: true });
  ensureDiaryFile(filePath, now, timezone);
  const current = fs.readFileSync(filePath, "utf8");
  const timelineResolution = resolveTodoDoneTimelineText({
    existingContent: current,
    section,
    timeString,
    title: options.title,
    body,
    // Keep the raw CLI flag here too. Otherwise non-todo writes inherit the
    // synthesized internal "open" default and trip the same guard that is
    // meant only for explicit --state misuse.
    todoState: options.state,
    timelineText: options.timelineText,
  });
  if (timelineResolution.mode === "point_in_time") {
    console.warn(
      `[${PACKAGE_NAME}] diary:write todo-done call omitted --timeline-text and no captured Todo start time was found; `
      + "synthesized only a point-in-time diary fact. Prefer opening the live Todo earlier, or pass exact cutover wording via --timeline-text."
    );
  }
  const entryPayloads = buildDiaryWriteEntryPayloads({
    existingContent: current,
    section,
    timeString,
    title: options.title,
    body,
    // Keep the raw CLI flag here. Non-todo writes internally normalize the
    // missing state to "open" for cutover bookkeeping, but treating that
    // synthesized default as an explicit --state would wrongly reject
    // fragment/timeline writes.
    todoState: options.state,
    timelineText: options.timelineText,
  });
  const next = entryPayloads.reduce(
    (draft: any, payload: any) => insertDiaryEntry(draft, payload, dateString),
    current
  );
  writeForeignTextDocument(filePath, next, { encoding: "utf8" });
  console.log(`diary written: ${filePath}`);
}

function parseArgs(args: any) {
  return parseCliArgs(args, getCommandArgsSchema("diaryWrite"));
}

function readOptionValue(args: any, index: any, optionName: any) {
  const next = args[index + 1];
  if (typeof next !== "string" || next.startsWith("--")) {
    throw new Error(`${optionName} 需要一个值`);
  }
  return String(next);
}

async function resolveBody(options: any) {
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
  return new Promise((resolve: any, reject: any) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: any) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

function buildDiaryEntry({ timeString, title, body }: any) {
  const heading = title ? `### ${timeString} ${title.trim()}` : `### ${timeString}`;
  return `${heading}\n\n${body}`;
}

function buildDiaryEntryPayload({ section = DEFAULT_SECTION, timeString, title = "", body = "", todoState = "open" }: any) {
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
    const todoStartedAt = normalizedState === "open" ? normalizeTodoClock(timeString) : "";
    return {
      section: normalizedSection,
      entry: buildTodoLine({
        text: lineText,
        todoState: normalizedState,
        todoStartedAt,
      }),
      text: lineText,
      todoState: normalizedState,
      todoStartedAt,
    };
  }

  return {
    section: normalizedSection,
    entry: `- ${lineText}`,
    text: lineText,
  };
}

function buildDiaryWriteEntryPayloads({
  existingContent = "",
  section = DEFAULT_SECTION,
  timeString,
  title,
  body,
  todoState = "",
  timelineText = "",
}: any) {
  const normalizedSection = normalizeSection(section);
  const normalizedTodoState = normalizeTodoState(todoState, normalizedSection);
  const normalizedTimelineText = resolveTodoDoneTimelineText({
    existingContent,
    section,
    timeString,
    title,
    body,
    todoState,
    timelineText,
  }).text;

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

function shouldSynthesizeTodoDoneTimelineText({ section = DEFAULT_SECTION, todoState = "open", timelineText = "" }: any) {
  const normalizedSection = normalizeSection(section);
  const normalizedTodoState = normalizeTodoState(todoState, normalizedSection);
  return normalizedSection === "todo"
    && normalizedTodoState === "done"
    && !normalizeLineItem(timelineText);
}

function resolveTodoDoneTimelineText({
  existingContent = "",
  section = DEFAULT_SECTION,
  timeString = "",
  title = "",
  body = "",
  todoState = "open",
  timelineText = "",
}: any) {
  const explicitTimelineText = normalizeLineItem(timelineText);
  if (explicitTimelineText) {
    return {
      text: explicitTimelineText,
      mode: "explicit",
    };
  }

  if (!shouldSynthesizeTodoDoneTimelineText({ section, todoState })) {
    return {
      text: "",
      mode: "none",
    };
  }

  const existingTodoStartTime = findTodoStartTimeInDiaryContent(existingContent, {
    title,
    body,
  });
  const synthesized = synthesizeTodoDoneTimelineText({
    section,
    timeString,
    title,
    body,
    todoState,
    existingTodoStartTime,
  });
  return {
    text: synthesized,
    mode: existingTodoStartTime ? "range_from_todo" : "point_in_time",
  };
}

function synthesizeTodoDoneTimelineText({
  section = DEFAULT_SECTION,
  timeString = "",
  title = "",
  body = "",
  todoState = "open",
  existingTodoStartTime = "",
}: any) {
  if (!shouldSynthesizeTodoDoneTimelineText({ section, todoState })) {
    return "";
  }

  const lineText = buildSectionLineText({ title, body });
  if (!lineText) {
    return "";
  }

  // Keep stale prompts from dropping the diary hard fact entirely. When the
  // same live Todo already captured a reliable start time, reuse it here so
  // todo-first workflow can still produce an accurate diary range at cutover.
  const capturedStartTime = normalizeTodoClock(existingTodoStartTime);
  const normalizedTime = normalizeLineItem(timeString);
  if (capturedStartTime && normalizedTime && capturedStartTime !== normalizedTime) {
    return `${capturedStartTime}-${normalizedTime} ${lineText}`;
  }
  return normalizedTime ? `${normalizedTime} ${lineText}` : lineText;
}

function ensureDiaryFile(filePath: any, now: any, timezone: any = LEGACY_TIMELINE_TIMEZONE) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return;
  }
  const createdAt = formatDateTime(now, timezone);
  const updated = formatDate(now, timezone);
  writeForeignTextDocument(filePath, buildDiaryFileSkeleton({ createdAt, updated }), { encoding: "utf8" });
}

function buildDiaryFileSkeleton({ createdAt, updated }: any) {
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

function insertDiaryEntry(content: any, entry: any, updatedDate: any) {
  const normalizedContent = normalizeFileEnding(content);
  const withUpdatedFrontmatter = updateFrontmatterValue(normalizedContent, "updated", updatedDate);
  const payload = normalizeEntryPayload(entry);
  if (payload.section === "supplement") {
    return insertSupplementEntry(withUpdatedFrontmatter, payload);
  }
  return insertBulletSectionEntry(withUpdatedFrontmatter, payload);
}

function findInsertionPoint(content: any) {
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

function locateSectionStart(content: any, headingText: any) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(headingText)}\\s*$`, "m");
  const match = pattern.exec(content);
  return match ? match.index : -1;
}

function locateNextLevelTwoHeading(content: any, fromIndex: any) {
  const pattern = /^##\s+/gm;
  pattern.lastIndex = fromIndex;
  const match = pattern.exec(content);
  return match ? match.index : -1;
}

function normalizeEntryPayload(entry: any) {
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
    todoStartedAt: normalizeTodoClock(payload.todoStartedAt),
  };
}

function insertSupplementEntry(content: any, payload: any) {
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

function insertBulletSectionEntry(content: any, payload: any) {
  const headingText = SECTION_HEADINGS[payload.section as keyof typeof SECTION_HEADINGS];
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

function findSectionRange(content: any, headingText: any) {
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

function extractSectionLines(sectionBody: any, section: any) {
  const normalizedBody = normalizeFileEnding(sectionBody);
  const lines = normalizedBody.split("\n").map((line: any) => line.replace(/\s+$/u, ""));
  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  return lines.filter((line: any) => !isPlaceholderLine(line, section));
}

function isPlaceholderLine(line: any, section: any) {
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

function upsertTodoLine(lines: any, payload: any) {
  const nextLines = Array.isArray(lines) ? [...lines] : [];
  for (let index = 0; index < nextLines.length; index += 1) {
    const parsed = parseTodoLine(nextLines[index]);
    if (!parsed) {
      continue;
    }
    if (parsed.text !== payload.text) {
      continue;
    }
    nextLines[index] = buildTodoLine({
      text: payload.text,
      todoState: payload.todoState,
      todoStartedAt: resolveTodoStartedAtForUpsert(parsed, payload),
    });
    return nextLines;
  }
  nextLines.push(buildTodoLine({
    text: payload.text,
    todoState: payload.todoState,
    todoStartedAt: payload.todoStartedAt,
  }));
  return nextLines;
}

function resolveTodoStartedAtForUpsert(parsed: any, payload: any) {
  const existingState = parsed?.todoState || "open";
  const existingStartedAt = normalizeTodoClock(parsed?.todoStartedAt);
  const payloadStartedAt = normalizeTodoClock(payload?.todoStartedAt);
  const nextState = normalizeTodoState(payload?.todoState, "todo");

  // Repeated writes against the same live open Todo should keep the original
  // block start. But if the same text gets reopened after it was already done,
  // the new open write represents a fresh block and must reset the captured
  // start time instead of leaking the old finished block's timestamp.
  if (nextState === "open") {
    if (existingState === "open") {
      return existingStartedAt || payloadStartedAt;
    }
    return payloadStartedAt || existingStartedAt;
  }

  return existingStartedAt || payloadStartedAt;
}

function upsertBulletLine(lines: any, payload: any) {
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

function replaceSectionBody(content: any, range: any, newBody: any) {
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

function hasSupplementDuplicate(sectionBody: any, payload: any) {
  const targetBody = normalizeBody(payload.body);
  if (!targetBody) {
    return false;
  }
  const targetTitle = normalizeLineItem(payload.title);
  return parseSupplementBlocks(sectionBody).some((block: any) =>
    block.title === targetTitle && block.body === targetBody
  );
}

function parseSupplementBlocks(sectionBody: any) {
  const normalizedBody = normalizeFileEnding(sectionBody).trim();
  if (!normalizedBody) {
    return [];
  }
  return normalizedBody
    .split(/\n(?=###\s)/u)
    .map((block: any) => {
      const lines = block.split("\n");
      const heading = String(lines.shift() || "").trim();
      const match = /^###\s+\d{2}:\d{2}(?:\s+(.*))?$/u.exec(heading);
      return {
        title: normalizeLineItem(match?.[1] || ""),
        body: normalizeBody(lines.join("\n")),
      };
    })
    .filter((block: any) => block.body);
}

function updateFrontmatterValue(content: any, key: any, value: any) {
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

function normalizeFileEnding(content: any) {
  return String(content || "").replace(/\r\n/g, "\n");
}

function escapeRegExp(value: any) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSectionLineText({ title, body }: any) {
  const normalizedTitle = normalizeLineItem(title);
  const normalizedBody = normalizeLineItem(body);
  if (normalizedTitle && normalizedBody) {
    return `${normalizedTitle}: ${normalizedBody}`;
  }
  return normalizedTitle || normalizedBody;
}

function buildTodoLine({ text, todoState = "open", todoStartedAt = "" }: any) {
  const startMarker = buildTodoStartMarker(todoStartedAt);
  return `- [${TODO_STATE_MARKERS[todoState as keyof typeof TODO_STATE_MARKERS]}] ${text}${startMarker}`;
}

function buildTodoStartMarker(value: any) {
  const normalized = normalizeTodoClock(value);
  return normalized ? ` <!-- codeksei-todo:start=${normalized} -->` : "";
}

function parseTodoLine(line: any) {
  const match = TODO_LINE_RE.exec(String(line || ""));
  if (!match) {
    return null;
  }
  const rawText = String(match[2] || "");
  const startMarker = TODO_START_MARKER_RE.exec(rawText);
  return {
    todoState: String(match[1] || "").toLowerCase() === "x" ? "done" : "open",
    text: normalizeLineItem(stripTodoMetadata(rawText)),
    todoStartedAt: normalizeTodoClock(startMarker?.[1] || ""),
  };
}

function stripTodoMetadata(value: any) {
  return String(value || "").replace(TODO_START_MARKER_RE, "").trim();
}

function findTodoStartTimeInDiaryContent(content: any, { title = "", body = "" }: any = {}) {
  const normalizedContent = normalizeFileEnding(content);
  if (!normalizedContent.trim()) {
    return "";
  }
  const range = findSectionRange(normalizedContent, SECTION_HEADINGS.todo);
  if (!range) {
    return "";
  }
  const targetText = buildSectionLineText({ title, body });
  if (!targetText) {
    return "";
  }
  const lines = extractSectionLines(normalizedContent.slice(range.contentStart, range.end), "todo");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseTodoLine(lines[index]);
    if (!parsed || parsed.text !== targetText) {
      continue;
    }
    return parsed.todoStartedAt;
  }
  return "";
}

function normalizeSection(value: any) {
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

function normalizeTodoState(value: any, section: any = DEFAULT_SECTION) {
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

function normalizeBody(value: any) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeLineItem(value: any) {
  return normalizeBody(value).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function normalizeTodoClock(value: any) {
  const normalized = normalizeLineItem(value);
  return /^\d{2}:\d{2}$/u.test(normalized) ? normalized : "";
}

function formatDate(date: any, timezone: any = LEGACY_TIMELINE_TIMEZONE) {
  return formatDateInTimezone(date, timezone);
}

function formatTime(date: any, timezone: any = LEGACY_TIMELINE_TIMEZONE) {
  return formatTimeInTimezone(date, timezone);
}

function formatDateTime(date: any, timezone: any = LEGACY_TIMELINE_TIMEZONE) {
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
  parseTodoLine,
  runDiaryWriteCommand,
  resolveTodoDoneTimelineText,
};

export {};
