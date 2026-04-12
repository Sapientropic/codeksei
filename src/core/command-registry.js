const { listCommandGroups: listCommandGroupsFromSurface } = require("../contracts/command-surface");

const COMMAND_GROUPS = listCommandGroupsFromSurface();

function listCommandGroups() {
  return COMMAND_GROUPS.map((group) => ({
    ...group,
    actions: group.actions.map((action) => ({ ...action })),
  }));
}

function buildTerminalHelpText() {
  const lines = [
    "用法: npm run <script>",
    "",
    "当前终端命令：",
    "  npm run shared:start      默认修复/拉起后台共享 app-server 与共享微信桥接",
    "  npm run shared:open       默认接入当前微信绑定的共享线程",
    "  npm run shared:watchdog   主动巡检并自恢复共享链路",
    "  npm run background:install    Windows 安装开机自启和周期巡检",
    "  npm run background:uninstall  Windows 卸载开机自启和周期巡检",
  ];

  for (const group of COMMAND_GROUPS) {
    const activeActions = group.actions.filter((action) => action.status === "active" && action.terminal.length);
    if (!activeActions.length) {
      continue;
    }
    lines.push(`- ${group.label}`);
    for (const action of activeActions) {
      lines.push(`  ${formatTerminalExamples(action)}  ${action.summary}`);
    }
  }

  const plannedGroups = collectPlannedTerminalGroups();
  if (plannedGroups.length) {
    lines.push("");
    lines.push("规划中的终端子命令：");
    for (const group of plannedGroups) {
      lines.push(`- ${group.name}`);
      for (const action of group.actions) {
        lines.push(`  ${action.terminal.join(", ")}  ${action.summary}`);
      }
    }
  }

  lines.push("");
  lines.push("微信命令映射与后续能力动作请看 README / docs。");
  return lines.join("\n");
}

function buildWeixinHelpText() {
  const lines = ["当前可用命令："];
  for (const group of COMMAND_GROUPS) {
    const activeActions = group.actions.filter((action) => action.status === "active" && action.weixin.length);
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

function buildTerminalTopicHelp(topic) {
  const normalizedTopic = normalizeTopic(topic);
  const actions = COMMAND_GROUPS
    .flatMap((group) => group.actions)
    .filter((action) => normalizeTopic(action.terminalGroup) === normalizedTopic && action.terminal.length);

  if (!actions.length) {
    return "";
  }

  const hasPlannedOnly = actions.every((action) => action.status === "planned");
  const lines = [
    `用法: ${buildTopicUsage(normalizedTopic)}`,
    "",
    hasPlannedOnly
      ? `当前 ${normalizedTopic} 命令仍在接入中，计划中的子命令：`
      : `当前 ${normalizedTopic} 命令：`,
  ];
  for (const action of actions) {
    lines.push(`- ${formatTerminalExamples(action)}  ${action.summary}`);
  }
  return lines.join("\n");
}

function isPlannedTerminalTopic(topic) {
  const normalizedTopic = normalizeTopic(topic);
  return COMMAND_GROUPS
    .flatMap((group) => group.actions)
    .some((action) => normalizeTopic(action.terminalGroup) === normalizedTopic && action.terminal.length);
}

function collectPlannedTerminalGroups() {
  const grouped = new Map();
  for (const action of COMMAND_GROUPS.flatMap((group) => group.actions)) {
    if (!action.terminal.length || !action.terminalGroup || action.status !== "planned") {
      continue;
    }
    const key = action.terminalGroup;
    if (!grouped.has(key)) {
      grouped.set(key, { name: key, actions: [] });
    }
    grouped.get(key).actions.push(action);
  }
  return Array.from(grouped.values());
}

function normalizeTopic(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

module.exports = {
  buildTerminalHelpText,
  buildTerminalTopicHelp,
  buildWeixinHelpText,
  isPlannedTerminalTopic,
  listCommandGroups,
};

function formatTerminalExamples(action) {
  const terminal = Array.isArray(action?.terminal) ? action.terminal : [];
  if (!terminal.length) {
    return "";
  }
  return terminal.map((commandText) => toNpmRunExample(commandText)).join(", ");
}

function buildTopicUsage(topic) {
  switch (topic) {
    case "reminder":
      return [
        "npm run reminder:write -- <args>",
        "",
        "参数：",
        "  --delay 30s|10m|1h30m|2d4h",
        "  --at 2026-04-07T21:30-04:00 | 2026-04-07 21:30",
        "  --text \"提醒内容\"",
        "  --user <senderId>  可选；必须是桥实际观测到的 sender id",
        "",
        "补充：",
        "  先用 npm run accounts 看可用 sender id；不要填昵称或自己猜的微信号",
        "  当前选中的 sender id 必须已经有可用的 context_token；否则命令会直接失败",
        "  不带 offset 的本地时间按当前 runtime timezone 解释；显式偏移时间戳按原值保留",
      ].join("\n");
    case "diary":
      return [
        "npm run diary:write -- <args>",
        "",
        "参数：",
        "  --text \"内容\"",
        "  --section todo|timeline|fragment|supplement|summary",
        "  --state open|done     只和 --section todo 一起用",
        "  --timeline-text \"...\"  只和 --section todo --state done 一起用；同一切换点会同步写入“时间线事实”",
        "  --title \"标题\"        默认主要给 supplement 用；其他 section 会和正文合成单行内容",
        "  --date YYYY-MM-DD     决定写入哪个日记文件",
        "  --time HH:mm          可选，覆盖条目时间；todo open 时也会把它记成这条 live block 的开始时间",
        "",
        "示例：",
        "  npm run diary:write -- --section todo --state open --text \"把药单发给 Alex\"",
        "  npm run diary:write -- --section todo --state done --text \"收住 Codeksei 微信回复问题\" --timeline-text \"22:39-23:04 连续压测 Codeksei 微信回复链路；这条问题今晚可以先收尾。\"",
        "  npm run diary:write -- --section timeline --text \"17:30-17:58 把药单发出去了\"",
        "",
        "说明：",
        "  open loop / 明确待跟进 -> todo；事后完成块 -> timeline；灵感碎片 -> fragment；解释判断 -> supplement；收口带走 -> summary",
        "  如果 todo done 省略 --timeline-text，会优先复用同一 Todo 已捕获的开始时间来补 HH:mm-HH:mm 硬事实；只有找不到开始时间时才退回成单点时间。",
        "  如果只是补记一条已经完成的事实，直接写 timeline 会更顺手。",
      ].join("\n");
    case "channel":
      return [
        "npm run channel:send-file -- --path /绝对路径 [--user <wechatUserId>]",
        "",
        "参数：",
        "  --path /绝对路径         要发回当前微信聊天的本地文件",
        "  --user <wechatUserId>   可选，覆盖默认接收用户",
      ].join("\n");
    case "system":
      return "npm run system:send -- <args> / npm run system:checkin";
    case "timeline":
      return [
        "npm run timeline:event -- <args> / npm run timeline:write -- <args> / npm run timeline:read -- <args> / npm run timeline:categories / npm run timeline:proposals -- <args> / npm run timeline:build / npm run timeline:serve / npm run timeline:dev / npm run timeline:screenshot -- --send",
        "",
        "补充：",
        "  单条事件优先用 npm run timeline:event -- --date YYYY-MM-DD --start HH:mm --end HH:mm --title \"...\" ...，避免手写 JSON",
        "  如果必须用 timeline:write --stdin，传完整 JSON 对象 {\"events\":[...]}，不要传裸数组",
        "  不带 offset 的本地时间按当前 timezone 解释；如果 timeline state 已声明非 legacy timezone，会优先沿用它",
        "  timeline 查分类先用 npm run timeline:categories；改已有日程前先用 npm run timeline:read -- --date YYYY-MM-DD",
        "  timeline 截图稳定入口是 npm run timeline:screenshot -- --send，它会把任务交给当前微信桥执行",
      ].join("\n");
    case "project":
      return [
        "npm run project:radar -- [--list] [--project <slug>] [--json] [--commits 5] [--changes 20]",
        "",
        "补充：",
        "  默认从当前 workspace 的 .codex/code-projects.json 读取已跟踪代码项目",
        "  先用 --list 看 slug；讨论具体项目时再用 --project <slug> --json",
      ].join("\n");
    case "note":
      return [
        "npm run note:auto -- (--project <slug> | --scope <name>) --kind <kind> [--text \"内容\" | --stdin]",
        "npm run note:maybe -- [--project <slug> | --scope <name>] [--kind <kind>] [--json]",
        "npm run note:sync -- (--project <slug> | --path <path>) --section <标题> [--text \"内容\" | --stdin] [--style bullet|paragraph] [--slot <id>] [--max-items N]",
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
        "npm run review:nightly -- [--date YYYY-MM-DD] [--deterministic] [--model <id>]",
        "npm run review:weekly -- [--week YYYY-Www] [--date YYYY-MM-DD] [--deterministic] [--model <id>]",
        "npm run review:monthly -- [--month YYYY-MM] [--date YYYY-MM-DD] [--deterministic] [--model <id>]",
        "",
        "补充：",
        "  默认走 hybrid：脚本保骨架，Codex 负责结构化语义提炼；失败时自动回退 deterministic",
        "  nightly 负责睡前收口；周/月复盘在有 nightly 时会优先吸收它",
        "  传 --deterministic 可强制只走脚本；传 --model <id> 可覆盖语义提炼使用的模型",
        "  周复盘默认按周一到周日；月复盘默认按自然月",
      ].join("\n");
    default:
      return "npm run <script>";
  }
}

function toNpmRunExample(commandText) {
  const normalized = typeof commandText === "string" ? commandText.trim() : "";
  switch (normalized) {
    case "login":
    case "accounts":
    case "start":
    case "shared start":
    case "shared open":
    case "shared status":
    case "doctor":
    case "help":
      return `npm run ${normalized.replace(" ", ":")}`;
    case "start --checkin":
      return "npm run start:checkin";
    case "reminder write":
      return "npm run reminder:write -- <args>";
    case "diary write":
      return "npm run diary:write -- <args>";
    case "channel send-file":
      return "npm run channel:send-file -- --path /绝对路径";
    case "system send":
      return "npm run system:send -- <args>";
    case "system checkin-poller":
      return "npm run system:checkin";
    case "timeline write":
      return "npm run timeline:write -- <args>";
    case "timeline event":
      return "npm run timeline:event -- <args>";
    case "timeline read":
      return "npm run timeline:read -- <args>";
    case "timeline categories":
      return "npm run timeline:categories";
    case "timeline proposals":
      return "npm run timeline:proposals -- <args>";
    case "timeline build":
      return "npm run timeline:build";
    case "timeline serve":
      return "npm run timeline:serve";
    case "timeline dev":
      return "npm run timeline:dev";
    case "timeline screenshot":
      return "npm run timeline:screenshot -- --send";
    case "project radar":
      return "npm run project:radar -- --project <slug> --json";
    case "note sync":
      return "npm run note:sync -- --project <slug> --section <标题> --text \"...\"";
    case "note auto":
      return "npm run note:auto -- --project <slug> --kind recent --text \"...\"";
    case "note maybe":
      return "npm run note:maybe -- --scope companion --kind preference";
    case "review weekly":
      return "npm run review:weekly";
    case "review nightly":
      return "npm run review:nightly";
    case "review monthly":
      return "npm run review:monthly";
    default:
      return normalized;
  }
}
