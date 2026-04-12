const crypto = require("crypto");
const { getCommandArgsSchema } = require("../contracts/command-args");
const { parseCliArgs } = require("../core/cli-args");
const {
  LEGACY_TIMELINE_TIMEZONE,
  coerceLocalDateTimeToIso,
} = require("../core/timezone");

async function runTimelineEventCommand(timelineIntegration, configOrArgs = {}, argsMaybe = []) {
  const config = Array.isArray(configOrArgs) ? {} : (configOrArgs || {});
  const args = Array.isArray(configOrArgs) ? configOrArgs : argsMaybe;
  const options = parseTimelineEventArgs(args);
  if (options.help) {
    printTimelineEventHelp(config.timezone);
    return;
  }

  const note = await resolveNote(options);
  const writeArgs = buildTimelineEventWriteArgs(options, note, config);
  await timelineIntegration.runSubcommand("write", writeArgs);
}

function parseTimelineEventArgs(args) {
  return parseCliArgs(args, getCommandArgsSchema("timelineEvent"));
}

async function resolveNote(options) {
  const inline = normalizeText(options.note);
  if (inline) {
    return inline;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return normalizeText(await readStdin());
}

function buildTimelineEventWriteArgs(options, note = "", config = {}) {
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

  const event = {
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
    event.tags = options.tags.map((tag) => normalizeText(tag)).filter(Boolean);
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

function normalizeDate(value) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeTimelineEventTimestamp(date, value, flagName, timezone = LEGACY_TIMELINE_TIMEZONE) {
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

function validateEventRange({ date, startAt, endAt }) {
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

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function printTimelineEventHelp(timezone = LEGACY_TIMELINE_TIMEZONE) {
  const resolvedTimezone = normalizeTimezoneConfigValue(timezone) || LEGACY_TIMELINE_TIMEZONE;
  console.log(`
用法: npm run timeline:event -- --date YYYY-MM-DD --start HH:mm --end HH:mm --title "标题" (--event-node <id> | --subcategory <id>) [其他参数]

用途:
  - 写单条时间轴事件，不必手写 raw JSON
  - 适合把一个明确的时间块快速追加进当天 timeline
  - 如果要一次写多条事件，或直接替换整批 events，继续用 timeline:write
  - 不带 offset 的本地时间默认按 ${resolvedTimezone} 解释

常用参数:
  --date YYYY-MM-DD
  --start HH:mm | 完整时间戳
  --end HH:mm | 完整时间戳
  --title "事件标题"
  --note "详细备注"        可选；也可用 --stdin 从标准输入读 note
  --event-node <id>        与 taxonomy 里的 eventNode 对应
  --subcategory <id>       不传 event-node 时至少提供它
  --category <id>          subcategory 无法自动反推时建议一起传
  --tag <text>             可重复传多次
  --mode merge|replace     默认 merge
  --finalize               按 timeline-for-agent 的 finalize 语义写入

示例:
  npm run timeline:event -- --date 2026-04-10 --start 09:30 --end 10:15 --title "看 Codeksei 提交历史" --subcategory work.dev --category work --note "为了补日记和时间线先核对最近改动。"
  @'
补充背景和为什么要记录这段。
'@ | npm run timeline:event -- --date 2026-04-10 --start 10:20 --end 10:45 --title "整理营养师笔记结构" --subcategory study.reading --stdin
`);
}

module.exports = {
  runTimelineEventCommand,
  parseTimelineEventArgs,
  buildTimelineEventWriteArgs,
  normalizeTimelineEventTimestamp,
};

function normalizeTimezoneConfigValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
