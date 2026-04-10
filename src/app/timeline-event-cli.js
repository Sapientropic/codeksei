const crypto = require("crypto");

const LOCAL_TIMEZONE_OFFSET = "+08:00";

async function runTimelineEventCommand(timelineIntegration, args = process.argv.slice(4)) {
  const options = parseTimelineEventArgs(args);
  if (options.help) {
    printTimelineEventHelp();
    return;
  }

  const note = await resolveNote(options);
  const writeArgs = buildTimelineEventWriteArgs(options, note);
  await timelineIntegration.runSubcommand("write", writeArgs);
}

function parseTimelineEventArgs(args) {
  const options = {
    help: false,
    date: "",
    start: "",
    end: "",
    title: "",
    note: "",
    categoryId: "",
    subcategoryId: "",
    eventNodeId: "",
    mode: "merge",
    eventId: "",
    finalize: false,
    useStdin: false,
    tags: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "").trim();
    if (!token) {
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--stdin") {
      options.useStdin = true;
      continue;
    }
    if (token === "--finalize") {
      options.finalize = true;
      continue;
    }

    const value = String(args[index + 1] || "").trim();
    if (!value || value.startsWith("--")) {
      throw new Error(`参数缺少值: ${token}`);
    }

    switch (token) {
      case "--date":
        options.date = value;
        break;
      case "--start":
        options.start = value;
        break;
      case "--end":
        options.end = value;
        break;
      case "--title":
        options.title = value;
        break;
      case "--note":
        options.note = value;
        break;
      case "--category":
        options.categoryId = value;
        break;
      case "--subcategory":
        options.subcategoryId = value;
        break;
      case "--event-node":
        options.eventNodeId = value;
        break;
      case "--mode":
        options.mode = value;
        break;
      case "--id":
        options.eventId = value;
        break;
      case "--tag":
        options.tags.push(value);
        break;
      default:
        throw new Error(`未知参数: ${token}`);
    }
    index += 1;
  }

  return options;
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

function buildTimelineEventWriteArgs(options, note = "") {
  const date = normalizeDate(options.date);
  if (!date) {
    throw new Error("缺少有效日期，使用 --date YYYY-MM-DD");
  }

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

  const startAt = normalizeTimelineEventTimestamp(date, options.start, "--start");
  const endAt = normalizeTimelineEventTimestamp(date, options.end, "--end");
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

function normalizeTimelineEventTimestamp(date, value, flagName) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`缺少时间，使用 ${flagName} HH:mm 或完整时间戳`);
  }

  if (/^\d{2}:\d{2}$/.test(normalized)) {
    return `${date}T${normalized}:00${LOCAL_TIMEZONE_OFFSET}`;
  }

  if (/^\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return `${date}T${normalized}${LOCAL_TIMEZONE_OFFSET}`;
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
    return `${normalized.replace(" ", "T")}${LOCAL_TIMEZONE_OFFSET}`;
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?([zZ]|[+-]\d{2}:\d{2})$/.test(normalized)) {
    return normalized.replace(" ", "T");
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

function printTimelineEventHelp() {
  console.log(`
用法: npm run timeline:event -- --date YYYY-MM-DD --start HH:mm --end HH:mm --title "标题" (--event-node <id> | --subcategory <id>) [其他参数]

用途:
  - 写单条时间轴事件，不必手写 raw JSON
  - 适合把一个明确的时间块快速追加进当天 timeline
  - 如果要一次写多条事件，或直接替换整批 events，继续用 timeline:write

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
  npm run timeline:event -- --date 2026-04-10 --start 09:30 --end 10:15 --title "看 cyberboss 提交历史" --subcategory work.dev --category work --note "为了补日记和时间线先核对最近改动。"
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
