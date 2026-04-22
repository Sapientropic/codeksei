import {
  DEFAULT_SECTION,
  TODO_LINE_RE,
  TODO_START_MARKER_RE,
  TODO_STATE_MARKERS,
  type DiaryEntryTodoState,
  type DiarySection,
  type TodoState,
  buildSectionLineText,
  escapeRegExp,
  getDiarySectionHeading,
  getDiarySectionHeadingAliases,
  normalizeBody,
  normalizeFileEnding,
  normalizeLineItem,
  normalizeSection,
  normalizeTodoClock,
  normalizeTodoState,
  resolveDiaryLocale,
  stripTodoMetadata,
} from "./shared";

export interface NormalizeEntryPayloadInput {
  section?: unknown;
  entry?: unknown;
  text?: unknown;
  title?: unknown;
  body?: unknown;
  todoState?: unknown;
  todoStartedAt?: unknown;
}

export interface NormalizedDiaryEntryPayload {
  section: DiarySection;
  entry: string;
  text: string;
  title: string;
  body: string;
  todoState: DiaryEntryTodoState;
  todoStartedAt: string;
}

export interface SectionRange {
  sectionStart: number;
  contentStart: number;
  end: number;
}

export interface TodoLineParseResult {
  todoState: TodoState;
  text: string;
  todoStartedAt: string;
}

export function buildDiaryFileSkeleton({
  createdAt,
  locale,
  updated,
}: {
  createdAt: string;
  locale?: unknown;
  updated: string;
}): string {
  const localeKey = resolveDiaryLocale(locale);
  const frontmatter = [
    "---",
    `created: ${createdAt}`,
    `updated: ${updated}`,
    ...(localeKey === "en" ? ["codeksei_locale: en"] : []),
    "---",
  ];
  return [
    ...frontmatter,
    `## ${getDiarySectionHeading("todo", localeKey)}`,
    "- [ ] ",
    "",
    `## ${getDiarySectionHeading("timeline", localeKey)}`,
    "- ",
    "",
    `## ${getDiarySectionHeading("fragment", localeKey)}`,
    "- ",
    "",
    `## ${getDiarySectionHeading("supplement", localeKey)}`,
    "",
    `## ${getDiarySectionHeading("summary", localeKey)}`,
    "",
  ].join("\n");
}

export function insertDiaryEntry(content: string, entry: string | NormalizeEntryPayloadInput, updatedDate: string): string {
  const normalizedContent = normalizeFileEnding(content);
  const withUpdatedFrontmatter = updateFrontmatterValue(normalizedContent, "updated", updatedDate);
  const payload = normalizeEntryPayload(entry);
  if (payload.section === "supplement") {
    return insertSupplementEntry(withUpdatedFrontmatter, payload);
  }
  return insertBulletSectionEntry(withUpdatedFrontmatter, payload);
}

export function normalizeEntryPayload(entry: string | NormalizeEntryPayloadInput): NormalizedDiaryEntryPayload {
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

export function findSectionRange(content: string, headingText: string): SectionRange | null {
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

export function findDiarySectionRange(content: string, section: DiarySection): SectionRange | null {
  for (const headingText of getDiarySectionHeadingAliases(section)) {
    const range = findSectionRange(content, headingText);
    if (range) {
      return range;
    }
  }
  return null;
}

export function extractSectionLines(sectionBody: string, section: DiarySection): string[] {
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

export function parseTodoLine(line: string): TodoLineParseResult | null {
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

export function buildTodoLine({
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

export function findTodoStartTimeInDiaryContent(
  content: string,
  { title = "", body = "" }: { title?: unknown; body?: unknown } = {},
): string {
  const normalizedContent = normalizeFileEnding(content);
  if (!normalizedContent.trim()) {
    return "";
  }
  const range = findDiarySectionRange(normalizedContent, "todo");
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

function insertSupplementEntry(content: string, payload: NormalizedDiaryEntryPayload): string {
  const range = findDiarySectionRange(content, "supplement");
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
  const range = findDiarySectionRange(content, payload.section);
  if (!range || !payload.entry) {
    return content;
  }

  const lines = extractSectionLines(content.slice(range.contentStart, range.end), payload.section);
  const nextLines = payload.section === "todo"
    ? upsertTodoLine(lines, payload)
    : upsertBulletLine(lines, payload);
  return replaceSectionBody(content, range, nextLines.join("\n"));
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
    if (!parsed || parsed.text !== payload.text) {
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

function buildTodoStartMarker(value: unknown): string {
  const normalized = normalizeTodoClock(value);
  return normalized ? ` <!-- codeksei-todo:start=${normalized} -->` : "";
}
