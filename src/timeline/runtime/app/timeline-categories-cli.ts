import type { TimelineRuntimeConfig } from "../../runtime-config";
import { listTimelineCategories } from "../application/timeline/list-categories";
import type { TimelineCategoriesResult } from "../contracts";

async function runTimelineCategoriesCommand(
  config: TimelineRuntimeConfig,
  args: string[] = process.argv.slice(3),
): Promise<TimelineCategoriesResult | null> {
  if (args.includes("--help") || args.includes("-h")) {
    return null;
  }

  return listTimelineCategories(config);
}

function buildTimelineCategoriesHelp() {
  return `
用法: codeksei timeline categories

用途:
  - 读取当前可用的 category / subcategory / eventNode 摘要
  - 供写入前确认应该复用哪个分类或 eventNode

说明:
  - 这里只返回受控 taxonomy 摘要，不返回整库原始 state
  - 如果不确定是否需要新增 eventNode，先看 categories
`;
}

export { buildTimelineCategoriesHelp, runTimelineCategoriesCommand };
