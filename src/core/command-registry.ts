// @ts-check

const {
  findCommandAction,
  listCommandActions,
  listCommandGroups: listCommandGroupsFromSurface,
} = require("../contracts/command-surface");
const { listCommandArgFlagsForHelp } = require("../contracts/command-args");

function listCommandGroups() {
  return listCommandGroupsFromSurface();
}

function buildTerminalHelpText() {
  const lines = [
    "用法: npm run <script>",
    "",
    "当前终端命令：",
  ];

  for (const group of listCommandGroups()) {
    const activeActions = group.actions.filter((action: any) => action.status === "active" && action.terminal.length);
    if (!activeActions.length) {
      continue;
    }
    lines.push(`- ${group.label}`);
    for (const action of activeActions) {
      lines.push(`  ${formatTerminalExamples(action)}  ${action.summary}`);
    }
  }

  lines.push("");
  lines.push("微信命令映射与后续能力动作请看 README / docs。");
  return lines.join("\n");
}

function buildWeixinHelpText() {
  const lines = ["当前可用命令："];
  for (const group of listCommandGroups()) {
    const activeActions = group.actions.filter((action: any) => action.status === "active" && action.weixin.length);
    if (!activeActions.length) {
      continue;
    }
    lines.push("");
    lines.push(`${group.label}：`);
    for (const action of activeActions) {
      lines.push(`- ${action.weixin.join(", ")}  ${action.summary}`);
    }
  }
  return lines.join("\n");
}

function buildTerminalTopicHelp(topic: any, context: any = {}) {
  const normalizedTopic = normalizeTopic(topic);
  if (!normalizedTopic) {
    return "";
  }

  switch (normalizedTopic) {
    case "reminder":
      return [
        `用法: ${buildExample("reminder.create", true)}`,
        "",
        "补充：",
        "  先用 npm run accounts 看可用 sender id；不要填昵称或自己猜的微信号",
        "  当前选中的 sender id 必须已经有可用的 context_token；否则命令会直接失败",
        "  不带 offset 的本地时间按当前 runtime timezone 解释；显式偏移时间戳按原值保留",
      ].join("\n");
    case "diary":
      return [
        `用法: ${buildExample("diary.append", true)}`,
        "",
        "补充：",
        "  open loop / 明确待跟进 -> todo；事后完成块 -> timeline；灵感碎片 -> fragment；解释判断 -> supplement；收口带走 -> summary",
        "  todo open 时也会把它记成这条 live block 的开始时间",
        "  如果 todo done 省略 --timeline-text，会优先复用同一 Todo 已捕获的开始时间来补 HH:mm-HH:mm 硬事实；只有找不到开始时间时才退回成单点时间。",
        "  如果只是补记一条已经完成的事实，直接写 timeline 会更顺手。",
      ].join("\n");
    case "channel":
      return [
        `用法: ${buildExample("channel.send_file", true)}`,
      ].join("\n");
    case "system":
      return [
        `用法: ${buildExample("system.send", true)} / npm run system:checkin`,
      ].join("\n");
    case "timeline":
      return [
        `用法: ${buildExample("timeline.event", true)} / npm run timeline:write -- <args> / npm run timeline:read -- <args> / npm run timeline:categories / npm run timeline:proposals -- <args> / npm run timeline:build / npm run timeline:serve / npm run timeline:dev / npm run timeline:screenshot -- --send`,
        "",
        "补充：",
        `  单条事件优先用 ${buildExample("timeline.event")}，避免手写 JSON`,
        "  如果必须用 timeline:write --stdin，传完整 JSON 对象 {\"events\":[...]}，不要传裸数组",
        "  timeline 查分类先用 npm run timeline:categories；改已有日程前先用 npm run timeline:read -- --date YYYY-MM-DD",
        "  不带 offset 的本地时间按当前 timezone 解释；如果 timeline state 已声明非 legacy timezone，会优先沿用它",
        "  timeline 截图稳定入口是 npm run timeline:screenshot -- --send，它会把任务交给当前微信桥执行",
      ].join("\n");
    case "project":
      return [
        `用法: ${buildExample("project.radar", true)}`,
        "",
        "补充：",
        "  默认从当前 workspace 的 .codex/code-projects.json 读取已跟踪代码项目",
        "  先用 --list 看 slug；讨论具体项目时再用 --project <slug> --json",
      ].join("\n");
    case "note":
      return [
        `用法: ${buildExample("note.auto", true)}`,
        `${buildExample("note.maybe", true)}`,
        `${buildExample("note.sync", true)}`,
        "",
        "补充：",
        "  默认先用 note:auto，让 schema 决定 file / section / style / slot",
        "  公开示例默认用 --scope companion；旧的 --scope assistant 仍兼容",
        "  note:maybe 只看路由，适合先确认 scope 或 kind 会落到哪里",
        "  默认写成 bullet；需要维护一个稳定状态块时传 --slot",
        "  note:sync 保留给自定义 section 或一次性低层回写",
      ].join("\n");
    case "review":
      return [
        `用法: ${buildExample("review.nightly", true)}`,
        `${buildExample("review.weekly", true)}`,
        `${buildExample("review.monthly", true)}`,
        "",
        "补充：",
        "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退 deterministic",
        "  nightly 负责睡前收口；周/月复盘在有 nightly 时会优先吸收它",
        "  传 --deterministic 可强制只走脚本；传 --model <id> 可覆盖语义提炼使用的模型",
        "  周复盘默认按周一到周日；月复盘默认按自然月",
      ].join("\n");
    default:
      return "";
  }
}

function buildTerminalLeafHelp(actionId: any, context: any = {}) {
  const action = findCommandAction(actionId);
  if (!action) {
    return "";
  }

  switch (action.action) {
    case "channel.send_file":
      return [
        `用法: ${buildExample(action.action, true)}`,
        "",
        "说明：",
        "  将本地文件作为附件发回当前微信聊天。",
        "",
        renderFlagBlock(action.argsSchemaKey),
        "",
        "示例：",
        `  ${buildExample(action.action)}`,
      ].join("\n");
    case "note.auto":
      return [
        `用法: ${buildExample(action.action, true)}`,
        "",
        "说明：",
        "  按 workspace 级 durable note schema 自动决定 file / section / style / slot。",
        "  代码项目常用 --project；陪伴脉络、灵感等 durable note 用 --scope。",
        "  公开示例默认用 --scope companion；旧的 --scope assistant 仍兼容。",
        "",
        renderFlagBlock(action.argsSchemaKey),
        "",
        "示例：",
        "  npm run note:auto -- --project <slug> --kind recent --text \"补了 note:auto / note:maybe 路由层\"",
        "  npm run note:auto -- --project <slug> --kind status --text \"当前已接上 durable note schema，下一步观察真实线程里的使用手感。\"",
        "  npm run note:auto -- --scope companion --kind preference --text \"默认先接住、记住和接上，不把承接做成工具菜单。\"",
        "  npm run note:auto -- --scope inspiration --kind idea --text \"做一个只在切换点发力的 transition mode，让主动提醒更像接线而不是催债。\"",
      ].join("\n");
    case "note.maybe":
      return [
        `用法: ${buildExample(action.action, true)}`,
        "",
        "说明：",
        "  只看 durable note 路由，不落盘。",
        "  不传参数时列出当前 workspace 可用 scope、kinds 和 tracked projects。",
        "  companion 是公开默认 scope；assistant 仍作为兼容别名保留。",
        "",
        renderFlagBlock(action.argsSchemaKey),
        "",
        "示例：",
        "  npm run note:maybe",
        "  npm run note:maybe -- --project <slug>",
        "  npm run note:maybe -- --scope companion --kind preference",
        "  npm run note:maybe -- --scope inspiration --json",
      ].join("\n");
    case "note.sync":
      return [
        `用法: ${buildExample(action.action, true)}`,
        "",
        "说明：",
        "  轻量把一条 durable 摘要写回指定 note 的指定 section。",
        "  默认 style 是 bullet；传 --slot 时会用受控 block 替换同一槽位的旧内容。",
        "  不传 --slot 时会做轻量追加，并对相同内容去重。",
        "",
        renderFlagBlock(action.argsSchemaKey),
        "",
        "示例：",
        "  npm run note:sync -- --project <slug> --section \"最近动作\" --text \"把微信 prompt 收口为更温柔的 chief-of-staff 风格\" --max-items 6",
        "  npm run note:sync -- --project <slug> --section \"当前状态\" --slot current-status --style paragraph --text \"当前 shared bridge 正常运行，默认入口稳定。\"",
        "  npm run note:sync -- --path \"/absolute/path/to/note.md\" --section \"当前定位\" --text \"默认先接住，再定向，再推进。\"",
      ].join("\n");
    case "project.radar":
      return [
        `用法: ${buildExample(action.action, true)}`,
        "",
        "说明：",
        "  默认从当前 workspace 的 .codex/code-projects.json 读取已跟踪代码项目。",
        `  当前配置文件: ${context.config?.projectRadarConfigFile || "(auto)"}`,
        "",
        renderFlagBlock(action.argsSchemaKey),
        "",
        "示例：",
        "  npm run project:radar -- --list",
        "  npm run project:radar -- --project <slug> --json",
        "  npm run project:radar -- --project engineering-issues --commits 8 --changes 30",
      ].join("\n");
    case "review.nightly":
    case "review.weekly":
    case "review.monthly":
      return buildReviewLeafHelp(action.action, context);
    case "system.send":
      return [
        `用法: ${buildExample(action.action, true)}`,
        "",
        "示例：",
        "  npm run system:send -- --text \"提醒她今天早点睡\" --workspace \"$(pwd)\"",
        "",
        renderFlagBlock(action.argsSchemaKey),
      ].join("\n");
    case "timeline.event": {
      const resolvedTimezone = normalizeText(context.timezone) || "Asia/Shanghai";
      return [
        `用法: ${buildExample(action.action, true)}`,
        "",
        "用途：",
        "  - 写单条时间轴事件，不必手写 raw JSON",
        "  - 适合把一个明确的时间块快速追加进当天 timeline",
        "  - 如果要一次写多条事件，或直接替换整批 events，继续用 timeline:write",
        `  - 不带 offset 的本地时间默认按 ${resolvedTimezone} 解释`,
        "",
        renderFlagBlock(action.argsSchemaKey),
        "",
        "示例：",
        "  npm run timeline:event -- --date 2026-04-10 --start 09:30 --end 10:15 --title \"看 Codeksei 提交历史\" --subcategory work.dev --category work --note \"为了补日记和时间线先核对最近改动。\"",
        "  @'",
        "补充背景和为什么要记录这段。",
        "'@ | npm run timeline:event -- --date 2026-04-10 --start 10:20 --end 10:45 --title \"整理营养师笔记结构\" --subcategory study.reading --stdin",
      ].join("\n");
    }
    case "timeline.screenshot":
      return [
        `用法: ${buildExample(action.action, true)}`,
        "",
        "说明：",
        "  这条命令只负责把截图任务排进本地队列，真正截图和发送由正在运行的微信 bridge 异步执行。",
        "  queued 不等于“已经发到微信”；只有 bridge 真正送达后，用户那边才会看到图片或文件。",
        "",
        renderFlagBlock(action.argsSchemaKey),
        "",
        "示例：",
        "  npm run timeline:screenshot -- --send --selector timeline",
      ].join("\n");
    default:
      return buildGenericLeafHelp(action);
  }
}

function buildReviewLeafHelp(actionId: any, context: any = {}) {
  const action = findCommandAction(actionId);
  const resolvedTimezone = normalizeText(context.timezone) || "Asia/Shanghai";
  if (!action) {
    return "";
  }

  const variant = {
    "review.nightly": {
      usage: "npm run review:nightly -- [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
      description: [
        "  从当前 diary 真相源生成一份 Codeksei 睡前收口。",
        `  默认按 ${resolvedTimezone} 的当前日期推断今天，并给周/月复盘提供更轻的日级原料。`,
        "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退。",
      ],
      examples: [
        "  npm run review:nightly",
        "  npm run review:nightly -- --date 2026-04-10",
      ],
    },
    "review.weekly": {
      usage: "npm run review:weekly -- [--week YYYY-Www] [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
      description: [
        "  从当前 diary 真相源生成一份 Codeksei 生活助理周复盘。",
        `  默认按 ${resolvedTimezone} 的当前日期推断本周（周一到周日）。`,
        "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退。",
      ],
      examples: [
        "  npm run review:weekly",
        "  npm run review:weekly -- --week 2026-W15",
        "  npm run review:weekly -- --date 2026-04-11",
      ],
    },
    "review.monthly": {
      usage: "npm run review:monthly -- [--month YYYY-MM] [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
      description: [
        "  从当前 diary 真相源生成一份 Codeksei 生活助理月复盘。",
        `  默认按 ${resolvedTimezone} 的当前日期推断本月。`,
        "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退。",
      ],
      examples: [
        "  npm run review:monthly",
        "  npm run review:monthly -- --month 2026-04",
        "  npm run review:monthly -- --date 2026-04-11",
      ],
    },
  }[action.action as keyof {
    "review.nightly": { usage: string; description: string[]; examples: string[]; };
    "review.weekly": { usage: string; description: string[]; examples: string[]; };
    "review.monthly": { usage: string; description: string[]; examples: string[]; };
  }];

  return [
    `用法: ${variant.usage}`,
    "",
    "说明：",
    ...variant.description,
    "",
    renderFlagBlock(action.argsSchemaKey),
    "",
    "示例：",
    ...variant.examples,
  ].join("\n");
}

function buildGenericLeafHelp(action: any) {
  const lines = [
    `用法: ${buildExample(action.action, true)}`,
  ];
  const flagBlock = renderFlagBlock(action.argsSchemaKey);
  if (flagBlock) {
    lines.push("");
    lines.push(flagBlock);
  }
  return lines.join("\n");
}

function renderFlagBlock(schemaKey: any) {
  const flags = listCommandArgFlagsForHelp(schemaKey).filter((flag: any) => flag.name !== "help");
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

function isPlannedTerminalTopic(topic: any) {
  const normalizedTopic = normalizeTopic(topic);
  return listCommandActions().some(
    (action: any) => action.help.topic === normalizedTopic && action.terminal.length
  );
}

function buildExample(actionId: any, includeUsage: boolean = false) {
  const action = findCommandAction(actionId);
  if (!action?.scriptName) {
    return "npm run <script>";
  }
  const examples = {
    "channel.send_file": "npm run channel:send-file -- --path /绝对路径",
    "note.auto": "npm run note:auto -- (--project <slug> | --scope <name>) --kind <kind> [--text \"内容\" | --stdin]",
    "note.maybe": "npm run note:maybe -- [--project <slug> | --scope <name>] [--kind <kind>] [--json]",
    "note.sync": "npm run note:sync -- (--project <slug> | --path <path>) --section <标题> [--text \"内容\" | --stdin] [--style bullet|paragraph] [--slot <id>] [--max-items N]",
    "project.radar": "npm run project:radar -- [--list] [--project <slug>] [--json] [--commits 5] [--changes 20]",
    "review.nightly": "npm run review:nightly -- [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
    "review.weekly": "npm run review:weekly -- [--week YYYY-Www] [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
    "review.monthly": "npm run review:monthly -- [--month YYYY-MM] [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
    "system.send": "npm run system:send -- --text \"<message>\" [--user <wechat_user_id>] [--workspace /绝对路径]",
    "timeline.event": "npm run timeline:event -- --date YYYY-MM-DD --start HH:mm --end HH:mm --title \"标题\" (--event-node <id> | --subcategory <id>) [其他参数]",
    "timeline.screenshot": "npm run timeline:screenshot -- --send [--user <wechatUserId>] [--output /绝对路径] [其他 timeline screenshot 参数]",
  };
  const actionKey = action.action as keyof typeof examples;
  if (includeUsage && examples[actionKey]) {
    return examples[actionKey];
  }
  return `npm run ${action.scriptName}`;
}

function formatTerminalExamples(action: any) {
  if (!action?.scriptName) {
    return "";
  }
  return `npm run ${action.scriptName}`;
}

function normalizeTopic(value: any) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  buildTerminalHelpText,
  buildTerminalLeafHelp,
  buildTerminalTopicHelp,
  buildWeixinHelpText,
  isPlannedTerminalTopic,
  listCommandGroups,
};

export {};
