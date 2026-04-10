const COMMAND_GROUPS = [
  {
    id: "lifecycle",
    label: "启动与诊断",
    actions: [
      {
        action: "app.login",
        summary: "发起微信扫码登录并保存账号",
        terminal: ["login"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.accounts",
        summary: "查看本地已保存账号",
        terminal: ["accounts"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.start",
        summary: "启动当前 channel/runtime 主循环",
        terminal: ["start"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.shared_start",
        summary: "启动共享 app-server 与共享微信桥接",
        terminal: ["shared start"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.shared_open",
        summary: "接入当前微信绑定的共享线程",
        terminal: ["shared open"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.shared_status",
        summary: "查看共享 app-server 与共享桥接状态",
        terminal: ["shared status"],
        weixin: [],
        status: "active",
      },
      {
        action: "app.doctor",
        summary: "打印当前配置、边界和线程状态",
        terminal: ["doctor"],
        weixin: [],
        status: "active",
      },
      {
        action: "system.send",
        summary: "向内部系统队列写入一条不可见触发消息",
        terminal: ["system send"],
        terminalGroup: "system",
        weixin: [],
        status: "active",
      },
      {
        action: "system.checkin_poller",
        summary: "按随机间隔写入主动 check-in 触发",
        terminal: ["system checkin-poller"],
        terminalGroup: "system",
        weixin: [],
        status: "active",
      },
    ],
  },
  {
    id: "workspace",
    label: "项目与线程",
    actions: [
      {
        action: "workspace.bind",
        summary: "绑定当前聊天使用的项目目录",
        terminal: [],
        weixin: ["/bind"],
        status: "active",
      },
      {
        action: "workspace.status",
        summary: "查看当前项目、线程、模型与上下文使用情况",
        terminal: [],
        weixin: ["/status"],
        status: "active",
      },
      {
        action: "thread.new",
        summary: "切到新线程草稿，并在下一条消息前重建当前 workspace 上下文",
        terminal: [],
        weixin: ["/new"],
        status: "active",
      },
      {
        action: "thread.reread",
        summary: "让当前线程重新读取最新 instructions 和当前 workspace 稳定入口",
        terminal: [],
        weixin: ["/reread"],
        status: "active",
      },
      {
        action: "thread.switch",
        summary: "切换到指定线程，并在下一条消息前按当前 workspace 检查是否要补读稳定入口",
        terminal: [],
        weixin: ["/switch <threadId>"],
        status: "active",
      },
      {
        action: "thread.stop",
        summary: "停止当前线程中的运行",
        terminal: [],
        weixin: ["/stop"],
        status: "active",
      },
    ],
  },
  {
    id: "approval",
    label: "授权与控制",
    actions: [
      {
        action: "approval.accept_once",
        summary: "允许当前待处理的授权请求一次",
        terminal: [],
        weixin: ["/yes"],
        status: "active",
      },
      {
        action: "approval.accept_workspace",
        summary: "在当前项目内持续允许同前缀命令",
        terminal: [],
        weixin: ["/always"],
        status: "active",
      },
      {
        action: "approval.reject_once",
        summary: "拒绝当前待处理的授权请求",
        terminal: [],
        weixin: ["/no"],
        status: "active",
      },
    ],
  },
  {
    id: "projects",
    label: "代码项目",
    actions: [
      {
        action: "project.radar",
        summary: "读取已跟踪代码项目的稳定入口与轻量 git 近况",
        terminal: ["project radar"],
        terminalGroup: "project",
        weixin: [],
        status: "active",
      },
      {
        action: "note.sync",
        summary: "把轻量 durable 摘要同步到指定 note 的指定 section",
        terminal: ["note sync"],
        terminalGroup: "note",
        weixin: [],
        status: "active",
      },
      {
        action: "note.auto",
        summary: "按 workspace durable note schema 自动选择 note 与 section 并落盘",
        terminal: ["note auto"],
        terminalGroup: "note",
        weixin: [],
        status: "active",
      },
      {
        action: "note.maybe",
        summary: "预览 durable note 路由，不实际写入",
        terminal: ["note maybe"],
        terminalGroup: "note",
        weixin: [],
        status: "active",
      },
      {
        action: "review.nightly",
        summary: "从日记真相源生成一份睡前收口",
        terminal: ["review nightly"],
        terminalGroup: "review",
        weixin: [],
        status: "active",
      },
      {
        action: "review.weekly",
        summary: "从日记真相源生成一份周复盘",
        terminal: ["review weekly"],
        terminalGroup: "review",
        weixin: [],
        status: "active",
      },
      {
        action: "review.monthly",
        summary: "从日记真相源生成一份月复盘",
        terminal: ["review monthly"],
        terminalGroup: "review",
        weixin: [],
        status: "active",
      },
    ],
  },
  {
    id: "capabilities",
    label: "能力集成",
    actions: [
      {
        action: "model.inspect",
        summary: "查看当前模型",
        terminal: [],
        weixin: ["/model"],
        status: "active",
      },
      {
        action: "model.select",
        summary: "切换到指定模型",
        terminal: [],
        weixin: ["/model <id>"],
        status: "active",
      },
      {
        action: "channel.send_file",
        summary: "将文件作为附件发送回当前聊天",
        terminal: ["channel send-file"],
        terminalGroup: "channel",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.event",
        summary: "按单个时间块写入时间轴，不必手写 JSON",
        terminal: ["timeline event"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.write",
        summary: "将当前上下文写入时间轴",
        terminal: ["timeline write"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.read",
        summary: "读取某一天的时间轴草稿或已发布内容",
        terminal: ["timeline read"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.categories",
        summary: "查看可用分类、子类和 event node",
        terminal: ["timeline categories"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.proposals",
        summary: "根据自然语言生成候选时间轴事件",
        terminal: ["timeline proposals"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.build",
        summary: "构建时间轴静态页面",
        terminal: ["timeline build"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.serve",
        summary: "启动时间轴静态页面服务",
        terminal: ["timeline serve"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.dev",
        summary: "启动时间轴热更新开发服务",
        terminal: ["timeline dev"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "timeline.screenshot",
        summary: "截图时间轴页面",
        terminal: ["timeline screenshot"],
        terminalGroup: "timeline",
        weixin: [],
        status: "active",
      },
      {
        action: "reminder.create",
        summary: "创建提醒并交给调度层处理",
        terminal: ["reminder write"],
        terminalGroup: "reminder",
        weixin: [],
        status: "active",
      },
      {
        action: "diary.append",
        summary: "追加一条日记记录",
        terminal: ["diary write"],
        terminalGroup: "diary",
        weixin: [],
        status: "active",
      },
      {
        action: "app.help",
        summary: "查看当前通道可用命令",
        terminal: ["help"],
        weixin: ["/help"],
        status: "active",
      },
    ],
  },
];

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
        "  --at 2026-04-07T21:30+08:00 | 2026-04-07 21:30",
        "  --text \"提醒内容\"",
        "  --user <wechatUserId>  可选",
      ].join("\n");
    case "diary":
      return [
        "npm run diary:write -- <args>",
        "",
        "参数：",
        "  --text \"内容\"",
        "  --section todo|timeline|fragment|supplement|summary",
        "  --state open|done     只和 --section todo 一起用",
        "  --title \"标题\"        默认主要给 supplement 用；其他 section 会和正文合成单行内容",
        "  --date YYYY-MM-DD     决定写入哪个日记文件",
        "  --time HH:mm          可选，覆盖条目时间",
        "",
        "示例：",
        "  npm run diary:write -- --section todo --state open --text \"把药单发给 Alex\"",
        "  npm run diary:write -- --section timeline --text \"17:30-17:58 把药单发出去了\"",
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
      return "npm run note:maybe -- --scope assistant --kind preference";
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
