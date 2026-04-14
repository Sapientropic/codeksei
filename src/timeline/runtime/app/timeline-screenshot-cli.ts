import * as path from "node:path";

import type { TimelineScreenshotOptions } from "../contracts";
import { writeStdoutLine } from "../../../core/terminal-output";
import type { TimelineRuntimeConfig } from "../../runtime-config";
import {
  captureTimelineScreenshot,
  SCREENSHOT_SELECTOR_MAP,
  resolveTimelineScreenshotOptions,
} from "../application/timeline/capture-screenshot";

type TimelineScreenshotCliParseResult =
  | { help: true }
  | ({ help: false } & TimelineScreenshotOptions);

interface TimelineScreenshotInput {
  help: boolean;
  outputFile?: string;
  selector?: string;
  range?: string;
  date?: string;
  week?: string;
  month?: string;
  category?: string;
  subcategory?: string;
  width?: string;
  height?: string;
  sidePadding?: string;
}

async function runTimelineScreenshotCommand(config: TimelineRuntimeConfig): Promise<void> {
  const options = parseTimelineScreenshotRuntimeArgs(process.argv.slice(3), config);
  if (options.help) {
    printHelp();
    return;
  }
  const result = await captureTimelineScreenshot(config, options);
  writeStdoutLine(`timeline screenshot saved: ${result.outputFile}`);
}

function parseTimelineScreenshotRuntimeArgs(args: string[], config: TimelineRuntimeConfig): TimelineScreenshotCliParseResult {
  const options: TimelineScreenshotInput = { help: false };

  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "").trim();
    if (!token) {
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--output") {
      options.outputFile = path.resolve(requireValue(token, args[index + 1]));
      index += 1;
      continue;
    }
    if (token === "--selector") {
      options.selector = requireValue(token, args[index + 1]).trim();
      index += 1;
      continue;
    }
    if (token === "--range") {
      options.range = requireValue(token, args[index + 1]).trim();
      index += 1;
      continue;
    }
    if (token === "--date") {
      options.date = requireValue(token, args[index + 1]).trim();
      index += 1;
      continue;
    }
    if (token === "--week") {
      options.week = requireValue(token, args[index + 1]).trim();
      index += 1;
      continue;
    }
    if (token === "--month") {
      options.month = requireValue(token, args[index + 1]).trim();
      index += 1;
      continue;
    }
    if (token === "--category") {
      options.category = requireValue(token, args[index + 1]).trim();
      index += 1;
      continue;
    }
    if (token === "--subcategory" || token === "--detail") {
      options.subcategory = requireValue(token, args[index + 1]).trim();
      index += 1;
      continue;
    }
    if (token === "--width") {
      options.width = requireValue(token, args[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--height") {
      options.height = requireValue(token, args[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--side-padding") {
      options.sidePadding = requireValue(token, args[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`未知参数: ${token}`);
  }

  if (options.help) {
    return { help: true };
  }

  return {
    ...resolveTimelineScreenshotOptions(config, options),
    help: false,
  };
}

function requireValue(token: string, value: string | undefined): string {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.startsWith("--")) {
    throw new Error(`参数缺少值: ${token}`);
  }
  return normalized;
}

function printHelp() {
  writeStdoutLine(`
用法: codeksei timeline screenshot [--output ./timeline-shot.png] [--selector timeline|analytics|events|CSS]

截图前视图调整:
  --range day|week|month|日|周|月
  --date YYYY-MM-DD
  --week WEEK_KEY
  --month YYYY-MM
  --category 分类 id 或 label
  --subcategory 明细 id 或 label
  --detail 明细 id 或 label（等同于 --subcategory）

局部截图 selector:
  - main       主视图整页
  - timeline   时间轴区域，包含范围切换和时间轴面板
  - analytics  类别分布、子类明细和趋势三块分析区
  - events     事件明细区

自然语言映射建议:
  - “截主视图” / “截整页”                 -> --selector main
  - “截时间轴” / “只截 timeline”           -> --selector timeline
  - “截类别明细趋势” / “截分析区”         -> --selector analytics
  - “截事件” / “只截事件列表”             -> --selector events
  - “截某天日视图”                         -> --range day --date YYYY-MM-DD
  - “截某月月视图”                         -> --range month --month YYYY-MM
  - “截工作 > 编码的分析区”                -> --category 工作 --detail 编码 --selector analytics
  - “截工作 > 编码的事件列表”              -> --category 工作 --detail 编码 --selector events

选择建议:
  - 只要用户想看某个分类/明细的时间分布，优先用 --selector analytics
  - 只有明确要看事件卡片列表时，才用 --selector events

也可以直接传自定义 CSS selector，例如:
  codeksei timeline screenshot --selector ".pie-chart-shell"

当前内置映射:
${Object.entries(SCREENSHOT_SELECTOR_MAP)
    .map(([key, value]) => `  - ${key} => ${value}`)
    .join("\n")}
`);
}

export { runTimelineScreenshotCommand };
export { parseTimelineScreenshotRuntimeArgs };
