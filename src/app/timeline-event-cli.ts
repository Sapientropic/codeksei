import * as crypto from "node:crypto";

import { getCommandArgsSchema } from "../contracts/command-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import {
  LEGACY_TIMELINE_TIMEZONE,
  coerceLocalDateTimeToIso,
} from "../core/timezone";
import * as cliArgsModule from "../core/cli-args";

interface TimelineEventOptions extends Record<string, unknown> {
  help?: boolean;
  useStdin?: boolean;
  finalize?: boolean;
  date?: unknown;
  start?: unknown;
  end?: unknown;
  title?: unknown;
  note?: unknown;
  categoryId?: unknown;
  subcategoryId?: unknown;
  eventNodeId?: unknown;
  mode?: unknown;
  eventId?: unknown;
  tags?: unknown[];
}

interface TimelineEventConfig {
  timezone?: unknown;
}

interface TimelineIntegrationRunner {
  runSubcommand(command: string, args: string[]): Promise<unknown>;
}

interface TimelineEventPayload {
  categoryId?: string;
  endAt: string;
  eventNodeId?: string;
  id: string;
  note?: string;
  startAt: string;
  subcategoryId?: string;
  tags?: string[];
  title: string;
}

const { parseCliArgs } = cliArgsModule as {
  parseCliArgs(args: string[], schema: unknown): TimelineEventOptions;
};

async function runTimelineEventCommand(
  timelineIntegration: TimelineIntegrationRunner,
  configOrArgs: TimelineEventConfig | string[] = {},
  argsMaybe: string[] = [],
): Promise<void> {
  const config: TimelineEventConfig = Array.isArray(configOrArgs) ? {} : (configOrArgs || {});
  const args = Array.isArray(configOrArgs) ? configOrArgs : argsMaybe;
  const options = parseTimelineEventArgs(args);
  if (options.help) {
    console.log(buildTerminalLeafHelp("timeline.event", { timezone: config.timezone }));
    return;
  }

  const note = await resolveNote(options);
  const writeArgs = buildTimelineEventWriteArgs(options, note, config);
  await timelineIntegration.runSubcommand("write", writeArgs);
}

function parseTimelineEventArgs(args: string[]): TimelineEventOptions {
  return parseCliArgs(args, getCommandArgsSchema("timelineEvent"));
}

async function resolveNote(options: TimelineEventOptions): Promise<string> {
  const inline = normalizeText(options.note);
  if (inline) {
    return inline;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return normalizeText(await readStdin());
}

function buildTimelineEventWriteArgs(
  options: TimelineEventOptions,
  note: string = "",
  config: TimelineEventConfig = {},
): string[] {
  const date = normalizeDate(options.date);
  if (!date) {
    throw new Error("缺少有效日期，使用 --date YYYY-MM-DD");
  }
  const timezone = normalizeTimezoneConfigValue(config.timezone) || LEGACY_TIMELINE_TIMEZONE;

  const title = normalizeText(options.title);
  if (!title) {
    throw new Error("缺少标题，使用 --title \"事件标题\"");
  }

  const mode = normalizeText(options.mode) || "merge";
  if (!["merge", "replace"].includes(mode)) {
    throw new Error("不支持的写入模式，只能用 --mode merge|replace");
  }

  if (!normalizeText(options.eventNodeId) && !normalizeText(options.subcategoryId)) {
    throw new Error("缺少分类信息，至少传 --event-node 或 --subcategory");
  }

  const startAt = normalizeTimelineEventTimestamp(date, options.start, "--start", timezone);
  const endAt = normalizeTimelineEventTimestamp(date, options.end, "--end", timezone);
  validateEventRange({ date, startAt, endAt });

  const event: TimelineEventPayload = {
    id: normalizeText(options.eventId) || `evt_${crypto.randomUUID()}`,
    startAt,
    endAt,
    title,
  };
  if (note) {
    event.note = note;
  }
  if (normalizeText(options.categoryId)) {
    event.categoryId = normalizeText(options.categoryId);
  }
  if (normalizeText(options.subcategoryId)) {
    event.subcategoryId = normalizeText(options.subcategoryId);
  }
  if (normalizeText(options.eventNodeId)) {
    event.eventNodeId = normalizeText(options.eventNodeId);
  }
  if (Array.isArray(options.tags) && options.tags.length) {
    event.tags = options.tags.map((tag: unknown) => normalizeText(tag)).filter(Boolean);
  }

  const payload = {
    date,
    events: [event],
  };

  const args = [
    "--date",
    date,
    "--mode",
    mode,
    "--json",
    JSON.stringify(payload),
  ];
  if (options.finalize) {
    args.push("--finalize");
  }
  return args;
}

function normalizeDate(value: unknown): string {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeTimelineEventTimestamp(
  date: string,
  value: unknown,
  flagName: string,
  timezone: string = LEGACY_TIMELINE_TIMEZONE,
): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`缺少时间，使用 ${flagName} HH:mm 或完整时间戳`);
  }

  const timestamp = coerceLocalDateTimeToIso(normalized, {
    timeZone: timezone,
    defaultDate: date,
  });
  if (timestamp) {
    return timestamp;
  }

  throw new Error(`不支持的时间格式: ${flagName}=${normalized}`);
}

function validateEventRange({ date, startAt, endAt }: { date: string; startAt: string; endAt: string }): void {
  if (!startAt.startsWith(`${date}T`) || !endAt.startsWith(`${date}T`)) {
    throw new Error("timeline:event 要求 start/end 都落在 --date 对应这一天内");
  }

  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("无法解析 start/end 时间");
  }
  if (startMs >= endMs) {
    throw new Error("--end 必须晚于 --start，且 timeline:event 不支持跨天事件");
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve: (value: string) => void, reject: (reason?: unknown) => void) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

export {
  runTimelineEventCommand,
  parseTimelineEventArgs,
  buildTimelineEventWriteArgs,
  normalizeTimelineEventTimestamp,
};

function normalizeTimezoneConfigValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
