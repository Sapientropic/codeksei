import * as fs from "node:fs";
import * as path from "node:path";

import { getCommandArgsSchema } from "../contracts/command-args";
import {
  LEGACY_TIMELINE_TIMEZONE,
  formatDateInTimezone,
  formatDateTimeInTimezone,
  formatTimeInTimezone,
} from "../core/timezone";
import { writeForeignTextDocument } from "../state/json-state";
import * as brandingModule from "../core/branding";
import * as cliArgsModule from "../core/cli-args";

const DEFAULT_SECTION = "supplement" as const;
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

type DiarySection = keyof typeof SECTION_HEADINGS;
type TodoState = keyof typeof TODO_STATE_MARKERS;
type DiaryEntryTodoState = TodoState | "";
type TodoTimelineResolutionMode = "explicit" | "none" | "range_from_todo" | "point_in_time";

interface DiaryWriteConfig extends Record<string, unknown> {
  diaryDir?: string;
  timezone?: unknown;
}

interface DiaryWriteOptions extends Record<string, unknown> {
  text?: unknown;
  title?: unknown;
  date?: string;
  time?: string;
  section?: unknown;
  state?: unknown;
  timelineText?: unknown;
  useStdin?: boolean;
}

interface BuildDiaryEntryArgs {
  timeString: string;
  title?: string;
  body: string;
}

interface BuildDiaryEntryPayloadArgs {
  section?: unknown;
  timeString: string;
  title?: unknown;
  body?: unknown;
  todoState?: unknown;
}

interface BuildDiaryWriteEntryPayloadsArgs extends BuildDiaryEntryPayloadArgs {
  existingContent?: string;
  timelineText?: unknown;
}

interface NormalizeEntryPayloadInput {
  section?: unknown;
  entry?: unknown;
  text?: unknown;
  title?: unknown;
  body?: unknown;
  todoState?: unknown;
  todoStartedAt?: unknown;
}

interface NormalizedDiaryEntryPayload {
  section: DiarySection;
  entry: string;
  text: string;
  title: string;
  body: string;
  todoState: DiaryEntryTodoState;
  todoStartedAt: string;
}

interface SectionRange {
  sectionStart: number;
  contentStart: number;
  end: number;
}

interface TodoLineParseResult {
  todoState: TodoState;
  text: string;
  todoStartedAt: string;
}

interface TodoTimelineResolution {
  text: string;
  mode: TodoTimelineResolutionMode;
}

const { PACKAGE_NAME } = brandingModule as {
  PACKAGE_NAME: string;
};

const { parseCliArgs } = cliArgsModule as {
  parseCliArgs(args: string[], schema: unknown): DiaryWriteOptions;
};

async function runDiaryWriteCommand(config: DiaryWriteConfig, args: string[] = []) {
  const options = parseArgs(args);
  const body = await resolveBody(options);
  if (!body) {
    throw new Error("日记内容不能为空，传 --text 或通过 stdin 输入");
  }

  const now = new Date();
  const timezone = config?.timezone || LEGACY_TIMELINE_TIMEZONE;
  const diaryDir = normalizeLineItem(config.diaryDir);
  if (!diaryDir) {
    throw new Error("缺少有效 diaryDir，无法写入日记");
  }
  const dateString = options.date || formatDate(now, timezone);
  const timeString = options.time || formatTime(now, timezone);
  const section = normalizeSection(options.section);
  const filePath = path.join(diaryDir, `${dateString}.md`);
  fs.mkdirSync(diaryDir, { recursive: true });
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
    (draft, payload) => insertDiaryEntry(draft, payload, dateString),
    current
  );
  writeForeignTextDocument(filePath, next, { encoding: "utf8" });
  console.log(`diary written: ${filePath}`);
}

function parseArgs(args: string[]): DiaryWriteOptions {
  return parseCliArgs(args, getCommandArgsSchema("diaryWrite")) as DiaryWriteOptions;
}

function readOptionValue(args: string[], index: number, optionName: string): string {
  const next = args[index + 1];
  if (typeof next !== "string" || next.startsWith("--")) {
    throw new Error(`${optionName} 需要一个值`);
  }
  return String(next);
}

async function resolveBody(options: DiaryWriteOptions): Promise<string> {
  const inlineText = normalizeBody(options.text);
  if (inlineText) {
    return inlineText;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return normalizeBody(await readStdin());
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

function buildDiaryEntry({ timeString, title, body }: BuildDiaryEntryArgs): string {
  const heading = title ? `### ${timeString} ${title.trim()}` : `### ${timeString}`;
  return `${heading}\n\n${body}`;
}

function buildDiaryEntryPayload({
  section = DEFAULT_SECTION,
  timeString,
  title = "",
  body = "",
  todoState = "open",
}: BuildDiaryEntryPayloadArgs): NormalizedDiaryEntryPayload {
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
      text: "",
      title: normalizedTitle,
      body: normalizedBody,
      todoState: "",
      todoStartedAt: "",
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
      title: "",
      body: normalizedBody,
      todoState: normalizedState,
      todoStartedAt,
    };
  }

  return {
    section: normalizedSection,
    entry: `- ${lineText}`,
    text: lineText,
    title: "",
    body: normalizedBody,
    todoState: "",
    todoStartedAt: "",
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
}: BuildDiaryWriteEntryPayloadsArgs): NormalizedDiaryEntryPayload[] {
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

function shouldSynthesizeTodoDoneTimelineText({
  section = DEFAULT_SECTION,
  todoState = "open",
  timelineText = "",
}: {
  section?: unknown;
  todoState?: unknown;
  timelineText?: unknown;
}): boolean {
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
}: BuildDiaryWriteEntryPayloadsArgs): TodoTimelineResolution {
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
}: {
  section?: unknown;
  timeString?: unknown;
  title?: unknown;
  body?: unknown;
  todoState?: unknown;
  existingTodoStartTime?: unknown;
}): string {
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

function ensureDiaryFile(filePath: string, now: Date, timezone: unknown = LEGACY_TIMELINE_TIMEZONE): void {
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return;
  }
  const createdAt = formatDateTime(now, timezone);
  const updated = formatDate(now, timezone);
  writeForeignTextDocument(filePath, buildDiaryFileSkeleton({ createdAt, updated }), { encoding: "utf8" });
}

function buildDiaryFileSkeleton({ createdAt, updated }: { createdAt: string; updated: string }): string {
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

function insertDiaryEntry(content: string, entry: string | NormalizeEntryPayloadInput, updatedDate: string): string {
  const normalizedContent = normalizeFileEnding(content);
  const withUpdatedFrontmatter = updateFrontmatterValue(normalizedContent, "updated", updatedDate);
  const payload = normalizeEntryPayload(entry);
  if (payload.section === "supplement") {
    return insertSupplementEntry(withUpdatedFrontmatter, payload);
  }
  return insertBulletSectionEntry(withUpdatedFrontmatter, payload);
}

function findInsertionPoint(content: string): number {
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

function locateSectionStart(content: string, headingText: string): number {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(headingText)}\\s*$`, "m");
  const match = pattern.exec(content);
  return match ? match.index : -1;
}

function locateNextLevelTwoHeading(content: string, fromIndex: number): number {
  const pattern = /^##\s+/gm;
  pattern.lastIndex = fromIndex;
  const match = pattern.exec(content);
  return match ? match.index : -1;
}

function normalizeEntryPayload(entry: string | NormalizeEntryPayloadInput): NormalizedDiaryEntryPayload {
  if (typeof entry === "string") {
    return {
      section: DEFAULT_SECTION,
      entry: entry.trim(),
      text: "",
      title: "",
      body: "",
      todoState: "",
      todoStartedAt: "",
    };
  }
  const payload: NormalizeEntryPayloadInput = entry && typeof entry === "object" ? entry : {};
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

function insertSupplementEntry(content: string, payload: NormalizedDiaryEntryPayload): string {
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

function insertBulletSectionEntry(content: string, payload: NormalizedDiaryEntryPayload): string {
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

function findSectionRange(content: string, headingText: string): SectionRange | null {
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

function extractSectionLines(sectionBody: string, section: DiarySection): string[] {
  const normalizedBody = normalizeFileEnding(sectionBody);
  const lines = normalizedBody.split("\n").map((line) => line.replace(/\s+$/u, ""));
  while (lines.length && !(lines[0] || "").trim()) {
    lines.shift();
  }
  while (lines.length && !(lines[lines.length - 1] || "").trim()) {
    lines.pop();
  }
  return lines.filter((line) => !isPlaceholderLine(line, section));
}

function isPlaceholderLine(line: string, section: DiarySection): boolean {
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

function upsertTodoLine(lines: string[], payload: NormalizedDiaryEntryPayload): string[] {
  const nextLines = Array.isArray(lines) ? [...lines] : [];
  const nextTodoState = normalizeTodoState(payload.todoState, "todo");
  for (let index = 0; index < nextLines.length; index += 1) {
    const parsed = parseTodoLine(nextLines[index] || "");
    if (!parsed) {
      continue;
    }
    if (parsed.text !== payload.text) {
      continue;
    }
    nextLines[index] = buildTodoLine({
      text: payload.text,
      todoState: nextTodoState,
      todoStartedAt: resolveTodoStartedAtForUpsert(parsed, payload),
    });
    return nextLines;
  }
  nextLines.push(buildTodoLine({
    text: payload.text,
    todoState: nextTodoState,
    todoStartedAt: payload.todoStartedAt,
  }));
  return nextLines;
}

function resolveTodoStartedAtForUpsert(
  parsed: TodoLineParseResult | null | undefined,
  payload: Partial<Pick<NormalizedDiaryEntryPayload, "todoStartedAt" | "todoState">>,
): string {
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

function upsertBulletLine(lines: string[], payload: NormalizedDiaryEntryPayload): string[] {
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

function replaceSectionBody(content: string, range: SectionRange, newBody: string): string {
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

function hasSupplementDuplicate(sectionBody: string, payload: NormalizedDiaryEntryPayload): boolean {
  const targetBody = normalizeBody(payload.body);
  if (!targetBody) {
    return false;
  }
  const targetTitle = normalizeLineItem(payload.title);
  return parseSupplementBlocks(sectionBody).some((block) =>
    block.title === targetTitle && block.body === targetBody
  );
}

function parseSupplementBlocks(sectionBody: string): Array<{ title: string; body: string }> {
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

function updateFrontmatterValue(content: string, key: string, value: string): string {
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

function normalizeFileEnding(content: unknown): string {
  return String(content || "").replace(/\r\n/g, "\n");
}

function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSectionLineText({ title, body }: { title?: unknown; body?: unknown }): string {
  const normalizedTitle = normalizeLineItem(title);
  const normalizedBody = normalizeLineItem(body);
  if (normalizedTitle && normalizedBody) {
    return `${normalizedTitle}: ${normalizedBody}`;
  }
  return normalizedTitle || normalizedBody;
}

function buildTodoLine({
  text,
  todoState = "open",
  todoStartedAt = "",
}: {
  text: string;
  todoState?: TodoState;
  todoStartedAt?: unknown;
}): string {
  const startMarker = buildTodoStartMarker(todoStartedAt);
  return `- [${TODO_STATE_MARKERS[todoState as keyof typeof TODO_STATE_MARKERS]}] ${text}${startMarker}`;
}

function buildTodoStartMarker(value: unknown): string {
  const normalized = normalizeTodoClock(value);
  return normalized ? ` <!-- codeksei-todo:start=${normalized} -->` : "";
}

function parseTodoLine(line: string): TodoLineParseResult | null {
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

function stripTodoMetadata(value: unknown): string {
  return String(value || "").replace(TODO_START_MARKER_RE, "").trim();
}

function findTodoStartTimeInDiaryContent(
  content: string,
  { title = "", body = "" }: { title?: unknown; body?: unknown } = {},
): string {
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
    const parsed = parseTodoLine(lines[index] || "");
    if (!parsed || parsed.text !== targetText) {
      continue;
    }
    return parsed.todoStartedAt;
  }
  return "";
}

function normalizeSection(value: unknown): DiarySection {
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

function normalizeTodoState(value: unknown, section: unknown = DEFAULT_SECTION): TodoState {
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

function normalizeBody(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeLineItem(value: unknown): string {
  return normalizeBody(value).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function normalizeTodoClock(value: unknown): string {
  const normalized = normalizeLineItem(value);
  return /^\d{2}:\d{2}$/u.test(normalized) ? normalized : "";
}

function formatDate(date: unknown, timezone: unknown = LEGACY_TIMELINE_TIMEZONE): string {
  return formatDateInTimezone(date, timezone);
}

function formatTime(date: unknown, timezone: unknown = LEGACY_TIMELINE_TIMEZONE): string {
  return formatTimeInTimezone(date, timezone);
}

function formatDateTime(date: unknown, timezone: unknown = LEGACY_TIMELINE_TIMEZONE): string {
  return formatDateTimeInTimezone(date, timezone);
}

export {
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
