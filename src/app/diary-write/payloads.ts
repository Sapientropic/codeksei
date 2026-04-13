import {
  DEFAULT_SECTION,
  type DiaryEntryTodoState,
  type DiarySection,
  type TodoTimelineResolutionMode,
  buildSectionLineText,
  normalizeBody,
  normalizeLineItem,
  normalizeSection,
  normalizeTodoClock,
  normalizeTodoState,
} from "./shared";
import {
  buildTodoLine,
  findTodoStartTimeInDiaryContent,
  type NormalizedDiaryEntryPayload,
} from "./document";

export interface BuildDiaryEntryArgs {
  timeString: string;
  title?: string;
  body: string;
}

export interface BuildDiaryEntryPayloadArgs {
  section?: unknown;
  timeString: string;
  title?: unknown;
  body?: unknown;
  todoState?: unknown;
}

export interface BuildDiaryWriteEntryPayloadsArgs extends BuildDiaryEntryPayloadArgs {
  existingContent?: string;
  timelineText?: unknown;
}

export interface TodoTimelineResolution {
  text: string;
  mode: TodoTimelineResolutionMode;
}

export function buildDiaryEntry({ timeString, title, body }: BuildDiaryEntryArgs): string {
  const heading = title ? `### ${timeString} ${title.trim()}` : `### ${timeString}`;
  return `${heading}\n\n${body}`;
}

export function buildDiaryEntryPayload({
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

export function buildDiaryWriteEntryPayloads({
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

export function resolveTodoDoneTimelineText({
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

  const capturedStartTime = normalizeTodoClock(existingTodoStartTime);
  const normalizedTime = normalizeLineItem(timeString);
  if (capturedStartTime && normalizedTime && capturedStartTime !== normalizedTime) {
    return `${capturedStartTime}-${normalizedTime} ${lineText}`;
  }
  return normalizedTime ? `${normalizedTime} ${lineText}` : lineText;
}
