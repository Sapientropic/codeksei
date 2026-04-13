type FlagType = "boolean" | "string" | "string[]";
type FlagDefaultValue = boolean | string | string[];

export interface CommandArgFlag {
  name: string;
  keys: string[];
  type: FlagType;
  defaultValue: FlagDefaultValue;
  description?: string;
  placeholder?: string;
  required?: boolean;
  helpOrder?: number;
}

interface CommandArgPassthrough {
  key: string;
  ignoreKeys: string[];
}

export interface CommandArgSchema {
  flags: readonly Readonly<CommandArgFlag>[];
  passthrough: Readonly<CommandArgPassthrough> | null;
}

function createCommandArgSchema({
  flags,
  passthrough = null,
}: {
  flags: CommandArgFlag[];
  passthrough?: CommandArgPassthrough | null;
}): CommandArgSchema {
  return Object.freeze({
    flags: Object.freeze(flags.map((flag: CommandArgFlag, index: number) => Object.freeze({
      description: "",
      placeholder: "",
      required: false,
      helpOrder: index,
      ...flag,
    }))),
    passthrough: passthrough ? Object.freeze({ ...passthrough }) : null,
  });
}

const COMMON_HELP_FLAG: CommandArgFlag = {
  name: "help",
  keys: ["--help", "-h"],
  type: "boolean",
  defaultValue: false,
  description: "显示当前命令帮助",
};

export const COMMAND_ARG_SCHEMAS: Readonly<Record<string, CommandArgSchema>> = Object.freeze({
  channelSendFile: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "path", keys: ["--path"], type: "string", defaultValue: "", required: true, placeholder: "/绝对路径", description: "要发回当前微信聊天的本地文件" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", placeholder: "<wechatUserId>", description: "可选；覆盖默认接收用户" },
    ],
  }),
  diaryWrite: createCommandArgSchema({
    flags: [
      { name: "text", keys: ["--text"], type: "string", defaultValue: "", description: "要写入的正文内容" },
      { name: "title", keys: ["--title"], type: "string", defaultValue: "", description: "补充记录标题" },
      { name: "date", keys: ["--date"], type: "string", defaultValue: "", placeholder: "YYYY-MM-DD", description: "目标日记日期" },
      { name: "time", keys: ["--time"], type: "string", defaultValue: "", placeholder: "HH:mm", description: "显式覆盖条目时间" },
      { name: "section", keys: ["--section"], type: "string", defaultValue: "supplement", description: "写入 todo|timeline|fragment|supplement|summary" },
      { name: "state", keys: ["--state"], type: "string", defaultValue: "", description: "todo 条目状态 open|done" },
      { name: "timelineText", keys: ["--timeline-text"], type: "string", defaultValue: "", description: "todo done 时同步写入时间线事实" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false, description: "从标准输入读取正文" },
    ],
  }),
  noteAuto: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "json", keys: ["--json"], type: "boolean", defaultValue: false, description: "输出 JSON 而不是文本" },
      { name: "project", keys: ["--project"], type: "string", defaultValue: "", description: "tracked project slug" },
      { name: "scope", keys: ["--scope"], type: "string", defaultValue: "", description: "durable note scope" },
      { name: "kind", keys: ["--kind"], type: "string", defaultValue: "", description: "schema 中声明的 kind" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "", description: "要写入的内容" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false, description: "从标准输入读取正文" },
    ],
  }),
  noteSync: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "project", keys: ["--project"], type: "string", defaultValue: "", description: "tracked project slug" },
      { name: "path", keys: ["--path"], type: "string", defaultValue: "", description: "绝对路径或相对 workspace 的 note 文件" },
      { name: "section", keys: ["--section"], type: "string", defaultValue: "", required: true, description: "目标 section 标题" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "", description: "要写入的内容" },
      { name: "style", keys: ["--style"], type: "string", defaultValue: "bullet", description: "bullet|paragraph" },
      { name: "slot", keys: ["--slot"], type: "string", defaultValue: "", description: "稳定 managed block 槽位 id" },
      { name: "maxItems", keys: ["--max-items"], type: "string", defaultValue: "", description: "bullet 模式下保留的最大条数" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false, description: "从标准输入读取正文" },
    ],
  }),
  projectRadar: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "list", keys: ["--list"], type: "boolean", defaultValue: false, description: "仅列出 tracked projects" },
      { name: "json", keys: ["--json"], type: "boolean", defaultValue: false, description: "输出 JSON 而不是文本" },
      { name: "project", keys: ["--project"], type: "string", defaultValue: "", description: "目标 project slug" },
      { name: "commits", keys: ["--commits"], type: "string", defaultValue: "5", description: "最近 commit 数量" },
      { name: "changes", keys: ["--changes"], type: "string", defaultValue: "20", description: "展示的状态变更数量" },
    ],
  }),
  reminderWrite: createCommandArgSchema({
    flags: [
      { name: "delay", keys: ["--delay"], type: "string", defaultValue: "", description: "相对延迟，如 30m / 2h / 1d" },
      { name: "at", keys: ["--at"], type: "string", defaultValue: "", description: "绝对时间，按当前 timezone 解释本地时间" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "", description: "提醒正文" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false, description: "从标准输入读取正文" },
    ],
  }),
  review: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "stdout", keys: ["--stdout"], type: "boolean", defaultValue: false, description: "仅预览摘要，不写文件" },
      { name: "deterministic", keys: ["--deterministic"], type: "boolean", defaultValue: false, description: "禁用语义提炼，仅走 deterministic 草稿" },
      { name: "date", keys: ["--date"], type: "string", defaultValue: "", description: "参考日期" },
      { name: "week", keys: ["--week"], type: "string", defaultValue: "", placeholder: "YYYY-Www", description: "显式周标签" },
      { name: "month", keys: ["--month"], type: "string", defaultValue: "", placeholder: "YYYY-MM", description: "显式月标签" },
      { name: "model", keys: ["--model"], type: "string", defaultValue: "", description: "覆盖 hybrid 语义提炼模型" },
    ],
  }),
  systemSend: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "", required: true, description: "系统触发消息正文" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", required: true, description: "绝对 workspace 路径" },
    ],
  }),
  systemCheckinConfig: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "show", keys: ["--show"], type: "boolean", defaultValue: false, description: "显示当前 checkin 区间" },
      { name: "range", keys: ["--range"], type: "string", defaultValue: "", placeholder: "3-60", description: "设置新的 min-max 分钟区间" },
      { name: "reset", keys: ["--reset"], type: "boolean", defaultValue: false, description: "清除持久化配置并回退到 env/default" },
    ],
  }),
  timelineEvent: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false, description: "从标准输入读取 note" },
      { name: "finalize", keys: ["--finalize"], type: "boolean", defaultValue: false, description: "写入后把目标日期标记为 final" },
      { name: "date", keys: ["--date"], type: "string", defaultValue: "", required: true, placeholder: "YYYY-MM-DD", description: "目标日期" },
      { name: "start", keys: ["--start"], type: "string", defaultValue: "", required: true, description: "开始时间 HH:mm 或完整时间戳" },
      { name: "end", keys: ["--end"], type: "string", defaultValue: "", required: true, description: "结束时间 HH:mm 或完整时间戳" },
      { name: "title", keys: ["--title"], type: "string", defaultValue: "", required: true, description: "事件标题" },
      { name: "note", keys: ["--note"], type: "string", defaultValue: "", description: "附加说明" },
      { name: "categoryId", keys: ["--category"], type: "string", defaultValue: "", description: "category id" },
      { name: "subcategoryId", keys: ["--subcategory"], type: "string", defaultValue: "", description: "subcategory id" },
      { name: "eventNodeId", keys: ["--event-node"], type: "string", defaultValue: "", description: "event node id" },
      { name: "mode", keys: ["--mode"], type: "string", defaultValue: "merge", description: "merge|replace" },
      { name: "eventId", keys: ["--id"], type: "string", defaultValue: "", description: "显式 event id" },
      { name: "tags", keys: ["--tag"], type: "string[]", defaultValue: [], description: "可重复传递的标签" },
    ],
  }),
  timelineScreenshot: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "outputFile", keys: ["--output"], type: "string", defaultValue: "", description: "截图输出绝对路径" },
    ],
    passthrough: {
      key: "forwardArgs",
      ignoreKeys: ["--send", "--demo"],
    },
  }),
});

export function getCommandArgsSchema(name: string): CommandArgSchema | null {
  return COMMAND_ARG_SCHEMAS[name] || null;
}

export function listCommandArgFlagsForHelp(name: string): CommandArgFlag[] {
  const schema = getCommandArgsSchema(name);
  if (!schema) {
    return [];
  }
  return schema.flags
    .slice()
    .sort((left: CommandArgFlag, right: CommandArgFlag) => (left.helpOrder || 0) - (right.helpOrder || 0))
    .map((flag: CommandArgFlag) => ({ ...flag, keys: Array.isArray(flag.keys) ? flag.keys.slice() : [] }));
}
