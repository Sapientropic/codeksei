import {
  findCommandAction,
  type CommandAction,
  type CommandLeafHelpKey,
  type PlannedTerminalTopic,
} from "./command-surface";
import { listCommandArgFlagsForHelp } from "./command-args";
import {
  buildTerminalActionExample,
  buildTerminalEntryUsage,
} from "../core/terminal-command-usage";

export interface CommandHelpDocument {
  usage: readonly string[];
  body?: readonly string[];
  bodyLabel?: string;
  examples?: readonly string[];
  includeFlagBlock?: boolean;
}

type CommandHelpContext = Record<string, unknown>;
type CommandHelpBuilder<TContext extends CommandHelpContext = CommandHelpContext> = (context: TContext) => CommandHelpDocument;

const TOPIC_HELP = {
  reminder: () => ({
    usage: [buildExample("reminder.create", true)],
    bodyLabel: "补充：",
    body: [
      `  先用 ${buildTerminalEntryUsage("app.accounts", "public")} 看可用 sender id；不要填昵称或自己猜的微信号`,
      "  当前选中的 sender id 必须已经有可用的 context_token；否则命令会直接失败",
      "  不带 offset 的本地时间按当前 runtime timezone 解释；显式偏移时间戳按原值保留",
    ],
  }),
  diary: () => ({
    usage: [buildExample("diary.append", true)],
    bodyLabel: "补充：",
    body: [
      "  open loop / 明确待跟进 -> todo；事后完成块 -> timeline；灵感碎片 -> fragment；解释判断 -> supplement；收口带走 -> summary",
      "  todo open 时也会把它记成这条 live block 的开始时间",
      "  如果 todo done 省略 --timeline-text，会优先复用同一 Todo 已捕获的开始时间来补 HH:mm-HH:mm 硬事实；只有找不到开始时间时才退回成单点时间。",
      "  如果只是补记一条已经完成的事实，直接写 timeline 会更顺手。",
    ],
  }),
  channel: () => ({
    usage: [buildExample("channel.send_file", true)],
  }),
  system: () => ({
    usage: [`${buildExample("system.send", true)} / ${buildTerminalEntryUsage("system.checkin_poller", "public")}`],
  }),
  timeline: () => ({
    usage: [
      `${buildExample("timeline.event", true)} / ${buildTerminalEntryUsage("timeline.write", "public")} <args> / ${buildTerminalEntryUsage("timeline.read", "public")} <args> / ${buildTerminalEntryUsage("timeline.categories", "public")} / ${buildTerminalEntryUsage("timeline.proposals", "public")} <args> / ${buildTerminalEntryUsage("timeline.build", "public")} / ${buildTerminalEntryUsage("timeline.serve", "public")} / ${buildTerminalEntryUsage("timeline.dev", "public")} / ${buildTerminalActionExample("timeline.screenshot", { audience: "public", includeArgs: true })}`,
    ],
    bodyLabel: "补充：",
    body: [
      `  单条事件优先用 ${buildExample("timeline.event")}，避免手写 JSON`,
      "  如果必须用 timeline:write --stdin，传完整 JSON 对象 {\"events\":[...]}，不要传裸数组",
      `  timeline 查分类先用 ${buildTerminalEntryUsage("timeline.categories", "public")}；改已有日程前先用 ${buildTerminalEntryUsage("timeline.read", "public")} --date YYYY-MM-DD`,
      "  不带 offset 的本地时间按当前 timezone 解释；如果 timeline state 已声明非 legacy timezone，会优先沿用它",
      `  timeline 截图稳定入口是 ${buildTerminalActionExample("timeline.screenshot", { audience: "public", includeArgs: true })}，它会把任务交给当前微信桥执行`,
    ],
  }),
  project: () => ({
    usage: [buildExample("project.radar", true)],
    bodyLabel: "补充：",
    body: [
      "  默认从当前 workspace 的 .codex/code-projects.json 读取已跟踪代码项目",
      "  先用 --list 看 slug；讨论具体项目时再用 --project <slug> --json",
    ],
  }),
  note: () => ({
    usage: [
      buildExample("note.auto", true),
      buildExample("note.maybe", true),
      buildExample("note.sync", true),
    ],
    bodyLabel: "补充：",
    body: [
      "  默认先用 note:auto，让 schema 决定 file / section / style / slot",
      "  公开示例默认用 --scope companion；旧的 --scope assistant 仍兼容",
      "  note:maybe 只看路由，适合先确认 scope 或 kind 会落到哪里",
      "  默认写成 bullet；需要维护一个稳定状态块时传 --slot",
      "  note:sync 保留给自定义 section 或一次性低层回写",
    ],
  }),
  review: () => ({
    usage: [
      buildExample("review.nightly", true),
      buildExample("review.weekly", true),
      buildExample("review.monthly", true),
    ],
    bodyLabel: "补充：",
    body: [
      "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退 deterministic",
      "  nightly 负责睡前收口；周/月复盘在有 nightly 时会优先吸收它",
      "  传 --deterministic 可强制只走脚本；传 --model <id> 可覆盖语义提炼使用的模型",
      "  周复盘默认按周一到周日；月复盘默认按自然月",
    ],
  }),
} satisfies Record<PlannedTerminalTopic, CommandHelpBuilder>;

// Keep leaf-help ownership explicit. Commands that should fall back to topic
// help are marked topic_only in command-surface-definitions instead of silently
// reusing a generic leaf renderer.
const LEAF_HELP = {
  "channel.send_file": () => ({
    usage: [buildExample("channel.send_file", true)],
    bodyLabel: "说明：",
    body: ["  将本地文件作为附件发回当前微信聊天。"],
    examples: [`  ${buildExample("channel.send_file")}`],
    includeFlagBlock: true,
  }),
  "note.auto": () => ({
    usage: [buildExample("note.auto", true)],
    bodyLabel: "说明：",
    body: [
      "  按 workspace 级 durable note schema 自动决定 file / section / style / slot。",
      "  代码项目常用 --project；陪伴脉络、灵感等 durable note 用 --scope。",
      "  公开示例默认用 --scope companion；旧的 --scope assistant 仍兼容。",
    ],
    examples: [
      "  codeksei note auto --project <slug> --kind recent --text \"补了 note:auto / note:maybe 路由层\"",
      "  codeksei note auto --project <slug> --kind status --text \"当前已接上 durable note schema，下一步观察真实线程里的使用手感。\"",
      "  codeksei note auto --scope companion --kind preference --text \"默认先接住、记住和接上，不把承接做成工具菜单。\"",
      "  codeksei note auto --scope inspiration --kind idea --text \"做一个只在切换点发力的 transition mode，让主动提醒更像接线而不是催债。\"",
    ],
    includeFlagBlock: true,
  }),
  "note.maybe": () => ({
    usage: [buildExample("note.maybe", true)],
    bodyLabel: "说明：",
    body: [
      "  只看 durable note 路由，不落盘。",
      "  不传参数时列出当前 workspace 可用 scope、kinds 和 tracked projects。",
      "  companion 是公开默认 scope；assistant 仍作为兼容别名保留。",
    ],
    examples: [
      "  codeksei note maybe",
      "  codeksei note maybe --project <slug>",
      "  codeksei note maybe --scope companion --kind preference",
      "  codeksei note maybe --scope inspiration --json",
    ],
    includeFlagBlock: true,
  }),
  "note.sync": () => ({
    usage: [buildExample("note.sync", true)],
    bodyLabel: "说明：",
    body: [
      "  轻量把一条 durable 摘要写回指定 note 的指定 section。",
      "  默认 style 是 bullet；传 --slot 时会用受控 block 替换同一槽位的旧内容。",
      "  不传 --slot 时会做轻量追加，并对相同内容去重。",
    ],
    examples: [
      "  codeksei note sync --project <slug> --section \"最近动作\" --text \"把微信 prompt 收口为更温柔的 chief-of-staff 风格\" --max-items 6",
      "  codeksei note sync --project <slug> --section \"当前状态\" --slot current-status --style paragraph --text \"当前 shared bridge 正常运行，默认入口稳定。\"",
      "  codeksei note sync --path \"/absolute/path/to/note.md\" --section \"当前定位\" --text \"默认先接住，再定向，再推进。\"",
    ],
    includeFlagBlock: true,
  }),
  "project.radar": (context) => {
    const config = isRecord(context.config) ? context.config : {};
    return {
      usage: [buildExample("project.radar", true)],
      bodyLabel: "说明：",
      body: [
        "  默认从当前 workspace 的 .codex/code-projects.json 读取已跟踪代码项目。",
        `  当前配置文件: ${String(config.projectRadarConfigFile || "(auto)")}`,
      ],
      examples: [
        "  codeksei project radar --list",
        "  codeksei project radar --project <slug> --json",
        "  codeksei project radar --project engineering-issues --commits 8 --changes 30",
      ],
      includeFlagBlock: true,
    };
  },
  "review.nightly": (context) => buildReviewLeafHelpDocument("review.nightly", context),
  "review.weekly": (context) => buildReviewLeafHelpDocument("review.weekly", context),
  "review.monthly": (context) => buildReviewLeafHelpDocument("review.monthly", context),
  "system.send": () => ({
    usage: [buildExample("system.send", true)],
    examples: [
      "  codeksei system send --text \"提醒她今天早点睡\" --workspace \"$(pwd)\"",
    ],
    includeFlagBlock: true,
  }),
  "timeline.event": (context) => {
    const resolvedTimezone = normalizeText(context.timezone) || "Asia/Shanghai";
    return {
      usage: [buildExample("timeline.event", true)],
      bodyLabel: "用途：",
      body: [
        "  - 写单条时间轴事件，不必手写 raw JSON",
        "  - 适合把一个明确的时间块快速追加进当天 timeline",
        "  - 如果要一次写多条事件，或直接替换整批 events，继续用 timeline:write",
        `  - 不带 offset 的本地时间默认按 ${resolvedTimezone} 解释`,
      ],
      examples: [
        "  codeksei timeline event --date 2026-04-10 --start 09:30 --end 10:15 --title \"看 Codeksei 提交历史\" --subcategory work.dev --category work --note \"为了补日记和时间线先核对最近改动。\"",
        "  @'",
        "补充背景和为什么要记录这段。",
        "'@ | codeksei timeline event --date 2026-04-10 --start 10:20 --end 10:45 --title \"整理营养师笔记结构\" --subcategory study.reading --stdin",
      ],
      includeFlagBlock: true,
    };
  },
  "timeline.screenshot": () => ({
    usage: [buildExample("timeline.screenshot", true)],
    bodyLabel: "说明：",
    body: [
      "  这条命令只负责把截图任务排进本地队列，真正截图和发送由正在运行的微信 bridge 异步执行。",
      "  queued 不等于“已经发到微信”；只有 bridge 真正送达后，用户那边才会看到图片或文件。",
    ],
    examples: [
      "  codeksei timeline screenshot --send --selector timeline",
    ],
    includeFlagBlock: true,
  }),
} satisfies Record<CommandLeafHelpKey, CommandHelpBuilder>;

function buildTerminalTopicHelpText(topic: unknown, context: CommandHelpContext = {}): string {
  const normalizedTopic = normalizeTopic(topic);
  if (!normalizedTopic) {
    return "";
  }
  const builder = findTopicHelpBuilder(normalizedTopic);
  return builder ? renderHelpDocument(builder(context), "") : "";
}

function buildTerminalLeafHelpText(actionId: unknown, context: CommandHelpContext = {}): string {
  const action = findCommandAction(String(actionId || ""));
  if (!action || action.help.detail !== "leaf") {
    return "";
  }
  const builder = LEAF_HELP[action.help.leafKey as CommandLeafHelpKey];
  return builder ? renderHelpDocument(builder(context), action.argsSchemaKey) : "";
}

function hasTerminalTopicHelp(topic: unknown): boolean {
  const normalizedTopic = normalizeTopic(topic);
  return Boolean(findTopicHelpBuilder(normalizedTopic));
}

function listTerminalHelpTopics(): PlannedTerminalTopic[] {
  return Object.keys(TOPIC_HELP).sort() as PlannedTerminalTopic[];
}

function listTerminalLeafHelpKeys(): CommandLeafHelpKey[] {
  return Object.keys(LEAF_HELP).sort() as CommandLeafHelpKey[];
}

function findTopicHelpBuilder(topic: string): CommandHelpBuilder | null {
  return Object.prototype.hasOwnProperty.call(TOPIC_HELP, topic)
    ? TOPIC_HELP[topic as PlannedTerminalTopic]
    : null;
}

function buildReviewLeafHelpDocument(actionId: "review.nightly" | "review.weekly" | "review.monthly", context: CommandHelpContext = {}): CommandHelpDocument {
  const resolvedTimezone = normalizeText(context.timezone) || "Asia/Shanghai";
  const variant = {
    "review.nightly": {
      usage: buildTerminalActionExample("review.nightly", { audience: "public", includeArgs: true }),
      description: [
        "  从当前 diary 真相源生成一份 Codeksei 睡前收口。",
        `  默认按 ${resolvedTimezone} 的当前日期推断今天，并给周/月复盘提供更轻的日级原料。`,
        "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退。",
      ],
      examples: [
        "  codeksei review nightly",
        "  codeksei review nightly --date 2026-04-10",
      ],
    },
    "review.weekly": {
      usage: buildTerminalActionExample("review.weekly", { audience: "public", includeArgs: true }),
      description: [
        "  从当前 diary 真相源生成一份 Codeksei 生活助理周复盘。",
        `  默认按 ${resolvedTimezone} 的当前日期推断本周（周一到周日）。`,
        "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退。",
      ],
      examples: [
        "  codeksei review weekly",
        "  codeksei review weekly --week 2026-W15",
        "  codeksei review weekly --date 2026-04-11",
      ],
    },
    "review.monthly": {
      usage: buildTerminalActionExample("review.monthly", { audience: "public", includeArgs: true }),
      description: [
        "  从当前 diary 真相源生成一份 Codeksei 生活助理月复盘。",
        `  默认按 ${resolvedTimezone} 的当前日期推断本月。`,
        "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退。",
      ],
      examples: [
        "  codeksei review monthly",
        "  codeksei review monthly --month 2026-04",
        "  codeksei review monthly --date 2026-04-11",
      ],
    },
  }[actionId];

  return {
    usage: [variant.usage],
    bodyLabel: "说明：",
    body: variant.description,
    examples: variant.examples,
    includeFlagBlock: true,
  };
}

function renderHelpDocument(document: CommandHelpDocument, argsSchemaKey: string): string {
  const lines: string[] = [];
  const usageLines = Array.isArray(document.usage) ? document.usage.filter(Boolean) : [];
  if (usageLines.length) {
    lines.push(`用法: ${usageLines[0]}`);
    lines.push(...usageLines.slice(1));
  }

  const bodyLines = Array.isArray(document.body) ? document.body.filter(Boolean) : [];
  if (bodyLines.length) {
    if (lines.length) {
      lines.push("");
    }
    if (document.bodyLabel) {
      lines.push(document.bodyLabel);
    }
    lines.push(...bodyLines);
  }

  if (document.includeFlagBlock) {
    const flagBlock = renderFlagBlock(argsSchemaKey);
    if (flagBlock) {
      if (lines.length) {
        lines.push("");
      }
      lines.push(flagBlock);
    }
  }

  const examples = Array.isArray(document.examples) ? document.examples.filter(Boolean) : [];
  if (examples.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push("示例：");
    lines.push(...examples);
  }

  return lines.join("\n");
}

function renderFlagBlock(schemaKey: unknown): string {
  const flags = listCommandArgFlagsForHelp(String(schemaKey || "")).filter((flag) => flag.name !== "help");
  if (!flags.length) {
    return "";
  }
  const lines = ["参数："];
  for (const flag of flags) {
    const keys = Array.isArray(flag.keys) ? flag.keys.join(", ") : "";
    const suffixParts = [];
    if (flag.required) {
      suffixParts.push("必填");
    }
    if (flag.placeholder) {
      suffixParts.push(flag.placeholder);
    }
    const description = [suffixParts.join("；"), flag.description].filter(Boolean).join("；");
    lines.push(`  ${keys}${description ? `  ${description}` : ""}`);
  }
  return lines.join("\n");
}

function buildExample(actionId: CommandAction["action"], includeUsage: boolean = false): string {
  return buildTerminalActionExample(actionId, {
    audience: "public",
    includeArgs: includeUsage,
  });
}

function normalizeTopic(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export {
  buildTerminalLeafHelpText,
  buildTerminalTopicHelpText,
  hasTerminalTopicHelp,
  listTerminalHelpTopics,
  listTerminalLeafHelpKeys,
};
