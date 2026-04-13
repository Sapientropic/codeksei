import type { TimelineMergeDayInput } from "../contracts";
import type { TimelineRuntimeConfig } from "../../runtime-config";
import { getCommandArgsSchema } from "../../../contracts/command-args";
import { parseCliArgs } from "../../../core/cli-args";
import { writeTimelineDay } from "../application/timeline/write-day";

interface TimelineWriteCliOptions extends Record<string, unknown> {
  help: boolean;
  date: string;
  json: string;
  mode: string;
  finalize: boolean;
  useStdin: boolean;
}

async function runTimelineWriteCommand(
  config: TimelineRuntimeConfig,
  args: string[] = process.argv.slice(3),
): Promise<{ date: string; mode: string; eventCount: number; status: string } | null> {
  const options = parseTimelineWriteArgs(args);
  if (options.help) {
    return null;
  }

  const body = await resolveBody(options);
  if (!body) {
    throw new Error("timeline-write 需要 JSON，传 --json 或通过 stdin 输入");
  }

  const payload = parsePayload(body);
  const result = await writeTimelineDay(config, {
    ...payload,
    date: options.date || payload.date || "",
    mode: options.mode || payload.mode || "merge",
    finalize: options.finalize,
  });
  return result;
}

function parseTimelineWriteArgs(args: string[]): TimelineWriteCliOptions {
  return parseCliArgs<TimelineWriteCliOptions>(args, getCommandArgsSchema("timelineWrite"));
}

async function resolveBody(options: TimelineWriteCliOptions): Promise<string> {
  if (String(options.json || "").trim()) {
    return options.json.trim();
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return readStdin();
}

function parsePayload(body: string): TimelineMergeDayInput & { date?: string; mode?: string } {
  const normalized = String(body || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(normalized);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("timeline-write JSON 必须是对象");
  }
  return parsed as TimelineMergeDayInput & { date?: string; mode?: string };
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

function buildTimelineWriteHelp() {
  return `
用法: codeksei timeline write --date YYYY-MM-DD [--mode merge|replace] [--json '{"events":[...]}']
  或: cat payload.json | codeksei timeline write --date YYYY-MM-DD --stdin

事件建议:
  - title: 短标题，直接显示在时间轴块里
  - note: 详细备注，写背景、上下文和补充描述

事件必填:
  - 必须提供 startAt 和 endAt
  - 必须提供以下两种之一：
    1. eventNodeId
    2. subcategoryId（此时 categoryId 也建议一起提供）
  - 如果没传 eventNodeId，且 subcategoryId 也无法推导出 categoryId，写入会直接报错
  - title 建议始终显式提供；如果缺 title，只有 eventNodeId 能回填标题时才允许写入

写入建议:
  - 新增事件前，如果不确定分类或 eventNode，先执行 codeksei timeline categories
  - 修改已有事件前，先执行 codeksei timeline read --date YYYY-MM-DD

时间约束:
  - 所有事件必须落在当前 date 这一天内，不能跨天
  - 睡眠如果跨过 00:00，必须拆成两段：
    凌晨睡眠写到当天前半夜，夜间睡眠写到当天后半夜
  - 不要生成一条从当天晚上直接延续到次日早上的事件

示例 JSON:
  {
    "date": "2026-04-05",
    "events": [
      {
        "id": "evt_demo_1",
        "startAt": "2026-04-05T09:00:00+08:00",
        "endAt": "2026-04-05T09:45:00+08:00",
        "title": "早餐和出门准备",
        "note": "起床后洗漱、吃早餐，收拾东西准备出门。",
        "categoryId": "life",
        "subcategoryId": "life.daily",
        "tags": ["早餐", "出门前"]
      }
    ]
  }
`;
}

export { buildTimelineWriteHelp, parseTimelineWriteArgs, resolveBody, runTimelineWriteCommand };
