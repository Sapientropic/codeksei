import type { TimelineRuntimeConfig } from "../../runtime-config";
import { getCommandArgsSchema } from "../../../contracts/command-args";
import { parseCliArgs } from "../../../core/cli-args";
import { listTimelineProposals } from "../application/timeline/list-proposals";
import type { TimelineProposalsResult } from "../contracts";

interface TimelineProposalsCliOptions extends Record<string, unknown> {
  help: boolean;
  date: string;
}

async function runTimelineProposalsCommand(
  config: TimelineRuntimeConfig,
  args: string[] = process.argv.slice(3),
): Promise<TimelineProposalsResult | null> {
  const options = parseTimelineProposalsArgs(args);
  if (options.help) {
    return null;
  }

  return listTimelineProposals(config, { date: options.date });
}

function parseTimelineProposalsArgs(args: string[]): TimelineProposalsCliOptions {
  return parseCliArgs<TimelineProposalsCliOptions>(args, getCommandArgsSchema("timelineProposals"));
}

function buildTimelineProposalsHelp() {
  return `
用法: codeksei timeline proposals [--date YYYY-MM-DD]

用途:
  - 查看写入时顺带新增的 eventNode 提案
  - 供排查“为什么出现了新节点”或“某天新增了哪些候选节点”

说明:
  - 不传 --date 时返回全部 proposals
  - 传 --date 时只返回对应日期的 proposals
`;
}

export { buildTimelineProposalsHelp, parseTimelineProposalsArgs, runTimelineProposalsCommand };
