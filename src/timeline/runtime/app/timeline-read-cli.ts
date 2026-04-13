import type { TimelineRuntimeConfig } from "../../runtime-config";
import { getCommandArgsSchema } from "../../../contracts/command-args";
import { parseCliArgs } from "../../../core/cli-args";
import { readTimelineDay } from "../application/timeline/read-day";
import type { TimelineReadDayResult } from "../contracts";

interface TimelineReadCliOptions extends Record<string, unknown> {
  help: boolean;
  date: string;
}

async function runTimelineReadCommand(
  config: TimelineRuntimeConfig,
  args: string[] = process.argv.slice(3),
): Promise<TimelineReadDayResult | null> {
  const options = parseTimelineReadArgs(args);
  if (options.help) {
    return null;
  }

  return readTimelineDay(config, { date: options.date });
}

function parseTimelineReadArgs(args: string[]): TimelineReadCliOptions {
  return parseCliArgs<TimelineReadCliOptions>(args, getCommandArgsSchema("timelineRead"));
}

function buildTimelineReadHelp() {
  return `
用法: codeksei timeline read --date YYYY-MM-DD

用途:
  - 读取某一天当前已有的时间轴事件
  - 供 agent 或用户在修改前先查看目标日期，而不是直接读取原始 JSON

返回内容:
  - date
  - exists
  - status
  - updatedAt
  - eventCount
  - events

说明:
  - 这里只返回目标日期的受控数据，不返回完整 facts 或 taxonomy
  - 修改某天前，推荐先执行 read，再执行 write
`;
}

export { buildTimelineReadHelp, parseTimelineReadArgs, runTimelineReadCommand };
