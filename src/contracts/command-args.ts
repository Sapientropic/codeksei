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

const COMMON_DRY_RUN_FLAG: CommandArgFlag = {
  name: "dryRun",
  keys: ["--dry-run"],
  type: "boolean",
  defaultValue: false,
  description: "只预览解析后的目标与副作用，不执行真实写入/发送",
};

const COMMON_IDEMPOTENCY_FLAG: CommandArgFlag = {
  name: "idempotencyKey",
  keys: ["--idempotency-key"],
  type: "string",
  defaultValue: "",
  description: "为可重试的副作用命令提供稳定幂等键",
};

export const COMMAND_ARG_SCHEMAS: Readonly<Record<string, CommandArgSchema>> = Object.freeze({
  appAccounts: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  appDoctor: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  appHelp: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  appLogin: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  appSchema: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  appStart: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  operatorHelp: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  operatorSchema: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  channelSendFile: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
      { name: "path", keys: ["--path"], type: "string", defaultValue: "", required: true, placeholder: "/绝对路径", description: "要发回当前微信聊天的本地文件" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", placeholder: "<wechatUserId>", description: "可选；覆盖默认接收用户" },
    ],
  }),
  contextBriefing: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
      { name: "mode", keys: ["--mode"], type: "string", defaultValue: "proactive", description: "proactive|review" },
    ],
  }),
  contextInspect: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
      { name: "mode", keys: ["--mode"], type: "string", defaultValue: "proactive", description: "proactive|review" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "", description: "用于 context packs 触发评估的本轮文本" },
    ],
  }),
  capabilitiesStatus: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "provider", keys: ["--provider"], type: "string", defaultValue: "", description: "显式 provider 视角：codex|hermes|generic-shell" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id，用于判断 target-scoped 能力" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式 workspace 路径，用于判断 target-scoped 能力" },
    ],
  }),
  pulseToday: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式 workspace 路径" },
      { name: "date", keys: ["--date"], type: "string", defaultValue: "", placeholder: "YYYY-MM-DD", description: "目标日期" },
      { name: "focus", keys: ["--focus"], type: "string", defaultValue: "", description: "今日显式关注焦点" },
    ],
  }),
  pulseGenerate: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式 workspace 路径" },
      { name: "date", keys: ["--date"], type: "string", defaultValue: "", placeholder: "YYYY-MM-DD", description: "目标日期" },
      { name: "focus", keys: ["--focus"], type: "string", defaultValue: "", description: "今日显式关注焦点" },
    ],
  }),
  pulseFeedback: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "card", keys: ["--card"], type: "string", defaultValue: "", required: true, description: "Pulse card id" },
      { name: "kind", keys: ["--kind"], type: "string", defaultValue: "like", description: "like|dislike|hide|save|task" },
      { name: "topic", keys: ["--topic"], type: "string", defaultValue: "", description: "反馈主题，用于后续排序" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "", description: "反馈正文或任务描述" },
    ],
  }),
  proactiveObserve: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
      { name: "show", keys: ["--show"], type: "boolean", defaultValue: false, description: "只显示当前 latest observation 状态，不触发模型调用" },
    ],
  }),
  proactiveEval: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "fixture", keys: ["--fixture"], type: "string", defaultValue: "", description: "proactive observation eval fixture JSON 路径" },
      { name: "model", keys: ["--model"], type: "string", defaultValue: "", description: "覆盖 proactive observation 模型 id" },
      { name: "endpoint", keys: ["--endpoint"], type: "string", defaultValue: "", description: "覆盖 OpenAI-compatible endpoint" },
    ],
  }),
  companionRemember: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "稳定 user id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
      { name: "source", keys: ["--source"], type: "string", defaultValue: "host_user_turn", description: "host_user_turn|onboarding_turn|checkin_followup|review_summary|diary_supplement|reminder_proactive" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "", description: "要提炼的最新用户内容或 summary" },
      { name: "contextFile", keys: ["--context-file"], type: "string", defaultValue: "", description: "可选 JSON 文件，补最小结构化上下文" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false, description: "从标准输入读取正文" },
    ],
  }),
  onboardingStart: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "稳定 user id" },
    ],
  }),
  onboardingStep: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "稳定 user id" },
      { name: "session", keys: ["--session"], type: "string", defaultValue: "", description: "当前 onboarding session id" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "", description: "用户最新一轮回复" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false, description: "从标准输入读取用户回复" },
    ],
  }),
  onboardingStatus: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "稳定 user id" },
    ],
  }),
  onboardingReset: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "稳定 user id" },
    ],
  }),
  diaryWrite: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
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
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
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
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
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
  hermesInstallSkill: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
    ],
  }),
  hermesStatus: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "可选；显式 sender id，用于补充当前 target 的托管摘要" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "可选；显式 workspace 路径，用于补充当前 target 的托管摘要" },
    ],
  }),
  hermesSmoke: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  hostManifest: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "provider", keys: ["--provider"], type: "string", defaultValue: "", description: "显式 provider 视角：codex|hermes|generic-shell" },
      { name: "config", keys: ["--config"], type: "string", defaultValue: "", description: "显式 canonical config 文件路径" },
    ],
  }),
  hostBootstrap: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
      { name: "provider", keys: ["--provider"], type: "string", defaultValue: "hermes", description: "目标 recipe provider，如 codex|hermes；generic-shell 需显式指定" },
      { name: "config", keys: ["--config"], type: "string", defaultValue: "", description: "显式 canonical config 文件路径" },
      { name: "modeClass", keys: ["--mode-class"], type: "string", defaultValue: "", description: "codex-managed|hosted-proactive|hosted-skill-only|cli-only（兼容 legacy: bridge-full）" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "canonical config 里的 workspaceRoot" },
      { name: "stateDir", keys: ["--state-dir"], type: "string", defaultValue: "", description: "canonical config 里的 stateDir" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "canonical config 里的 user.id" },
      { name: "name", keys: ["--name"], type: "string", defaultValue: "", description: "canonical config 里的 user.name" },
      { name: "timezone", keys: ["--timezone"], type: "string", defaultValue: "", description: "canonical config 里的 user.timezone" },
      { name: "channel", keys: ["--channel"], type: "string", defaultValue: "", description: "canonical config 里的 host.channel" },
    ],
  }),
  hostDoctor: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "provider", keys: ["--provider"], type: "string", defaultValue: "hermes", description: "显式 provider，如 hermes；generic-shell 需显式指定" },
      { name: "config", keys: ["--config"], type: "string", defaultValue: "", description: "显式 canonical config 文件路径" },
    ],
  }),
  hostSmoke: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "provider", keys: ["--provider"], type: "string", defaultValue: "hermes", description: "显式 provider，如 hermes" },
      { name: "config", keys: ["--config"], type: "string", defaultValue: "", description: "显式 canonical config 文件路径" },
    ],
  }),
  hostSeedProactive: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "provider", keys: ["--provider"], type: "string", defaultValue: "hermes", description: "显式 provider，如 hermes" },
      { name: "config", keys: ["--config"], type: "string", defaultValue: "", description: "显式 canonical config 文件路径" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
      { name: "nextWakeAt", keys: ["--next-wake-at"], type: "string", defaultValue: "", description: "显式第一次 future wake 时间（ISO 8601）" },
      { name: "sleepFor", keys: ["--sleep-for"], type: "string", defaultValue: "", description: "相对延迟，如 30m / 2h / 8h" },
    ],
  }),
  hostClaimCheckin: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "provider", keys: ["--provider"], type: "string", defaultValue: "hermes", description: "显式 provider，如 hermes" },
      { name: "config", keys: ["--config"], type: "string", defaultValue: "", description: "显式 canonical config 文件路径" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
    ],
  }),
  hostSettleCheckin: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "provider", keys: ["--provider"], type: "string", defaultValue: "hermes", description: "显式 provider，如 hermes" },
      { name: "config", keys: ["--config"], type: "string", defaultValue: "", description: "显式 canonical config 文件路径" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
      { name: "lease", keys: ["--lease"], type: "string", defaultValue: "", required: true, description: "host claim-checkin 返回的 lease id" },
      { name: "result", keys: ["--result"], type: "string", defaultValue: "", required: true, description: "sent_message|silent|backstage_only|failed" },
      { name: "nextWakeAt", keys: ["--next-wake-at"], type: "string", defaultValue: "", description: "显式下次唤醒时间（ISO 8601）" },
      { name: "sleepFor", keys: ["--sleep-for"], type: "string", defaultValue: "", description: "相对延迟，如 90m / 4h / 1d" },
      { name: "createHandoff", keys: ["--create-handoff"], type: "boolean", defaultValue: false, description: "只记录子 agent handoff，不直接 finalize" },
      { name: "message", keys: ["--message"], type: "string", defaultValue: "", description: "create-handoff + sent_message 时必填；silent/backstage_only 时不要传" },
      { name: "observedState", keys: ["--observed-state"], type: "string", defaultValue: "", description: "子 agent 观察到的当前状态摘要" },
      { name: "followupContext", keys: ["--followup-context"], type: "string", defaultValue: "", description: "传给主会话的内部 follow-up 摘要" },
      { name: "bookkeepingActions", keys: ["--bookkeeping-action"], type: "string[]", defaultValue: [], description: "可重复；格式 kind|done|summary 或 kind|suggested|summary" },
      { name: "decisionId", keys: ["--decision-id"], type: "string", defaultValue: "", description: "可选；关联 host claim-checkin 返回的 proactiveDecision.decisionId" },
      { name: "responseOutcome", keys: ["--response-outcome"], type: "string", defaultValue: "", description: "可选；engaged|ignored|dismissed|annoyed|corrected|continued" },
      { name: "feedbackText", keys: ["--feedback-text"], type: "string", defaultValue: "", description: "可选；用户或宿主对这次主动判断的反馈摘要" },
    ],
  }),
  hostFinalizeCheckin: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "provider", keys: ["--provider"], type: "string", defaultValue: "hermes", description: "显式 provider，如 hermes" },
      { name: "config", keys: ["--config"], type: "string", defaultValue: "", description: "显式 canonical config 文件路径" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
      { name: "lease", keys: ["--lease"], type: "string", defaultValue: "", required: true, description: "待 finalize 的 lease / trigger id" },
      { name: "result", keys: ["--result"], type: "string", defaultValue: "", description: "可选；覆盖 handoff 自带的 sent_message|silent|backstage_only" },
      { name: "nextWakeAt", keys: ["--next-wake-at"], type: "string", defaultValue: "", description: "显式下次唤醒时间（ISO 8601）" },
      { name: "sleepFor", keys: ["--sleep-for"], type: "string", defaultValue: "", description: "相对延迟，如 90m / 4h / 1d" },
      { name: "decisionId", keys: ["--decision-id"], type: "string", defaultValue: "", description: "可选；关联 host claim-checkin 返回的 proactiveDecision.decisionId" },
      { name: "responseOutcome", keys: ["--response-outcome"], type: "string", defaultValue: "", description: "可选；engaged|ignored|dismissed|annoyed|corrected|continued" },
      { name: "feedbackText", keys: ["--feedback-text"], type: "string", defaultValue: "", description: "可选；用户或宿主对这次主动判断的反馈摘要" },
    ],
  }),
  hostRender: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "provider", keys: ["--provider"], type: "string", defaultValue: "hermes", description: "显式 provider，如 hermes" },
      { name: "target", keys: ["--target"], type: "string", defaultValue: "skill", description: "当前只支持 skill" },
      { name: "validate", keys: ["--validate"], type: "boolean", defaultValue: false, description: "若与仓内模板不一致，返回 partial" },
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
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
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
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
      { name: "stdout", keys: ["--stdout"], type: "boolean", defaultValue: false, description: "仅预览摘要，不写文件" },
      { name: "deterministic", keys: ["--deterministic"], type: "boolean", defaultValue: false, description: "禁用语义提炼，仅走 deterministic 草稿" },
      { name: "date", keys: ["--date"], type: "string", defaultValue: "", description: "参考日期" },
      { name: "week", keys: ["--week"], type: "string", defaultValue: "", placeholder: "YYYY-Www", description: "显式周标签" },
      { name: "month", keys: ["--month"], type: "string", defaultValue: "", placeholder: "YYYY-MM", description: "显式月标签" },
      { name: "model", keys: ["--model"], type: "string", defaultValue: "", description: "覆盖 hybrid 语义提炼模型" },
    ],
  }),
  systemCheckinConfig: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
      { name: "show", keys: ["--show"], type: "boolean", defaultValue: false, description: "显示当前 checkin 区间" },
      { name: "range", keys: ["--range"], type: "string", defaultValue: "", placeholder: "3-60", description: "设置新的 min-max 分钟区间" },
      { name: "reset", keys: ["--reset"], type: "boolean", defaultValue: false, description: "清除持久化配置并回退到 env/default" },
    ],
  }),
  systemCheckinTick: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
      { name: "ack", keys: ["--ack"], type: "string", defaultValue: "", description: "确认当前 pending trigger id 并推进下一次调度" },
    ],
  }),
  systemCheckinComplete: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
      { name: "trigger", keys: ["--trigger"], type: "string", defaultValue: "", required: true, description: "当前 active wake 的 trigger id" },
      { name: "result", keys: ["--result"], type: "string", defaultValue: "", required: true, description: "sent_message|silent|backstage_only" },
      { name: "nextWakeAt", keys: ["--next-wake-at"], type: "string", defaultValue: "", description: "显式下次唤醒时间（ISO 8601）" },
      { name: "sleepFor", keys: ["--sleep-for"], type: "string", defaultValue: "", description: "相对延迟，如 90m / 4h / 1d4h" },
    ],
  }),
  systemCheckinTrigger: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "", description: "显式 sender id" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "", description: "显式绝对 workspace 路径" },
    ],
  }),
  timelineEvent: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
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
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
      { name: "outputFile", keys: ["--output"], type: "string", defaultValue: "", description: "截图输出绝对路径" },
    ],
    passthrough: {
      key: "forwardArgs",
      ignoreKeys: ["--demo"],
    },
  }),
  timelineRead: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "date", keys: ["--date"], type: "string", defaultValue: "", required: true, placeholder: "YYYY-MM-DD", description: "要读取的目标日期" },
    ],
  }),
  timelineCategories: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  timelineProposals: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "date", keys: ["--date"], type: "string", defaultValue: "", placeholder: "YYYY-MM-DD", description: "可选；只看某一天的 proposals" },
    ],
  }),
  timelineWrite: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      COMMON_DRY_RUN_FLAG,
      COMMON_IDEMPOTENCY_FLAG,
      { name: "date", keys: ["--date"], type: "string", defaultValue: "", placeholder: "YYYY-MM-DD", description: "目标日期；也可在 JSON 里提供" },
      { name: "json", keys: ["--json"], type: "string", defaultValue: "", description: "完整 JSON 对象载荷" },
      { name: "mode", keys: ["--mode"], type: "string", defaultValue: "", description: "merge|replace" },
      { name: "finalize", keys: ["--finalize"], type: "boolean", defaultValue: false, description: "写入后把目标日期标记为 final" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false, description: "从标准输入读取完整 JSON" },
    ],
  }),
  timelineBuild: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  timelineServe: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "port", keys: ["--port"], type: "string", defaultValue: "", description: "显式指定本地服务端口" },
    ],
  }),
  timelineDev: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "port", keys: ["--port"], type: "string", defaultValue: "", description: "显式指定本地开发服务端口" },
    ],
  }),
  frameBuild: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
    ],
  }),
  frameServe: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "port", keys: ["--port"], type: "string", defaultValue: "", description: "显式指定本地服务端口" },
    ],
  }),
  frameDev: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "port", keys: ["--port"], type: "string", defaultValue: "", description: "显式指定本地开发服务端口" },
    ],
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
