import * as fs from "node:fs";
import * as path from "node:path";
import { PACKAGE_NAME } from "../../contracts/app-env";
import { LEGACY_TIMELINE_TIMEZONE } from "../../core/timezone";
import { logWarn } from "../../core/logging";
import { writeForeignTextDocument } from "../../state/json-state";
import type { CommandExecutionResult } from "../../contracts/cli-contract";
import { runCliMutation } from "../../core/cli-mutation";
import { parseArgs, resolveBody, type DiaryWriteOptions } from "./args";
import { buildDiaryFileSkeleton, insertDiaryEntry } from "./document";
import { buildDiaryWriteEntryPayloads, resolveTodoDoneTimelineText } from "./payloads";
import {
  formatDate,
  formatDateTime,
  formatTime,
  normalizeLineItem,
  normalizeSection,
} from "./shared";

interface DiaryWriteConfig {
  cliIdempotencyLedgerFile?: string;
  diaryDir?: string;
  timezone?: unknown;
}


export type { DiaryWriteConfig, DiaryWriteOptions };

export async function runDiaryWriteCommand(config: DiaryWriteConfig, args: string[] = []) {
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
  return runCliMutation<Record<string, unknown>>({
    commandKey: "diary.write",
    config,
    configSource: {
      diaryDir,
      timezone,
    },
    dryRun: Boolean(options.dryRun),
    dryRunResult: {
      data: {
        date: dateString,
        filePath,
        section,
        time: timeString,
      },
      text: [
        "diary write dry-run",
        `file: ${filePath}`,
        `section: ${section}`,
        `time: ${timeString}`,
      ].join("\n"),
    },
    execute: async () => {
      fs.mkdirSync(diaryDir, { recursive: true });
      ensureDiaryFile(filePath, now, timezone);
      const current = fs.readFileSync(filePath, "utf8");
      const timelineResolution = resolveTodoDoneTimelineText({
        existingContent: current,
        section,
        timeString,
        title: options.title,
        body,
        todoState: options.state,
        timelineText: options.timelineText,
      });
      if (timelineResolution.mode === "point_in_time") {
        logWarn(
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
        todoState: options.state,
        timelineText: options.timelineText,
      });
      const next = entryPayloads.reduce(
        (draft, payload) => insertDiaryEntry(draft, payload, dateString),
        current,
      );
      writeForeignTextDocument(filePath, next, { encoding: "utf8" });
      return {
        data: {
          date: dateString,
          filePath,
          payloadCount: entryPayloads.length,
          section,
          time: timeString,
        },
        text: `diary written: ${filePath}`,
      } satisfies CommandExecutionResult;
    },
    idempotencyKey: normalizeLineItem((options as Record<string, unknown>).idempotencyKey),
    request: {
      body,
      date: dateString,
      section,
      time: timeString,
      timelineText: options.timelineText,
      title: options.title,
      todoState: options.state,
    },
    resolvedTargets: {
      date: dateString,
      filePath,
      section,
    },
    sideEffects: [
      {
        kind: "write_diary",
        target: filePath,
      },
    ],
  });
}

function ensureDiaryFile(filePath: string, now: Date, timezone: unknown = LEGACY_TIMELINE_TIMEZONE): void {
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return;
  }
  const createdAt = formatDateTime(now, timezone);
  const updated = formatDate(now, timezone);
  writeForeignTextDocument(filePath, buildDiaryFileSkeleton({ createdAt, updated }), { encoding: "utf8" });
}
