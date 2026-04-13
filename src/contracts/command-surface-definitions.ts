// region Type definitions
export interface CommandGroupDefinition {
  id: string;
  label: string;
}

export interface CommandHelpDefinition {
  topic: string;
  leafKey: string;
  detail: "leaf" | "topic_only";
}

export interface CommandApprovalDefinition {
  autoApprove?: boolean;
}

export interface CommandActionDefinition {
  action: string;
  groupId: string;
  summary: string;
  terminal: readonly string[];
  weixin: readonly string[];
  status: string;
  entrypointType: "cli" | "script" | "weixin";
  scriptName?: string;
  command?: string;
  subcommand?: string;
  runner?: string;
  argsSchemaKey?: string;
  kind?: string;
  timelineSubcommand?: string;
  help?: CommandHelpDefinition;
  approval?: CommandApprovalDefinition;
}

export type CommandAudienceDefinition = "operator" | "public";
export type CommandAuthRequirementDefinition = "context_token" | "none" | "runtime_bootstrap" | "weixin_account";
export type CommandMutabilityDefinition = "bootstrap" | "long_running" | "read" | "write";
export type CommandSafetyTierDefinition = "open" | "operator" | "warned";
// endregion

// region Group definitions
export const COMMAND_GROUP_DEFINITIONS = [
  { id: "introspection", label: "发现与合同" },
  { id: "lifecycle", label: "启动与诊断" },
  { id: "workspace", label: "项目与线程" },
  { id: "approval", label: "授权与控制" },
  { id: "projects", label: "代码项目" },
  { id: "capabilities", label: "能力集成" },
] as const satisfies readonly CommandGroupDefinition[];
// endregion

// region Action definitions data table
export const COMMAND_ACTION_DEFINITIONS = [
  {
    action: "app.schema",
    groupId: "introspection",
    summary: "查看当前 public CLI contract schema",
    terminal: ["schema"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    command: "schema",
    runner: "schema",
    help: { topic: "", leafKey: "app.schema", detail: "topic_only" },
  },
  {
    action: "operator.help",
    groupId: "introspection",
    summary: "查看 operator / bootstrap command surface",
    terminal: ["operator help"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    command: "operator",
    subcommand: "help",
    runner: "operator.help",
    help: { topic: "", leafKey: "operator.help", detail: "topic_only" },
  },
  {
    action: "operator.schema",
    groupId: "introspection",
    summary: "查看 operator / bootstrap command schema",
    terminal: ["operator schema"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    command: "operator",
    subcommand: "schema",
    runner: "operator.schema",
    help: { topic: "", leafKey: "operator.schema", detail: "topic_only" },
  },
  {
    action: "app.login",
    groupId: "lifecycle",
    summary: "发起 Codeksei 自带微信桥的扫码登录并保存账号（bridge-only）",
    terminal: ["login"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "login",
    command: "login",
    runner: "login",
  },
  {
    action: "app.accounts",
    groupId: "lifecycle",
    summary: "查看 Codeksei 自带微信桥的本地已保存账号（bridge-only）",
    terminal: ["accounts"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "accounts",
    command: "accounts",
    runner: "accounts",
  },
  {
    action: "app.start",
    groupId: "lifecycle",
    summary: "启动当前 Codeksei bridge 主循环（bridge-only）",
    terminal: ["start"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "start",
    command: "start",
    runner: "start",
  },
  {
    action: "app.shared_start",
    groupId: "lifecycle",
    summary: "启动共享 app-server 与共享微信桥接（bridge-only）",
    terminal: ["shared:start"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "shared:start",
  },
  {
    action: "app.shared_open",
    groupId: "lifecycle",
    summary: "接入当前微信绑定的共享线程（bridge-only）",
    terminal: ["shared:open"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "shared:open",
  },
  {
    action: "app.shared_status",
    groupId: "lifecycle",
    summary: "查看共享桥接状态；Hermes hosted mode 下仅显示宿主管理提示",
    terminal: ["shared:status"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "shared:status",
  },
  {
    action: "app.shared_watchdog",
    groupId: "lifecycle",
    summary: "主动巡检并自恢复共享链路（bridge-only）",
    terminal: ["shared:watchdog"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "shared:watchdog",
  },
  {
    action: "background.install",
    groupId: "lifecycle",
    summary: "Windows 安装开机自启与周期巡检",
    terminal: ["background:install"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "background:install",
  },
  {
    action: "background.uninstall",
    groupId: "lifecycle",
    summary: "Windows 卸载开机自启与周期巡检",
    terminal: ["background:uninstall"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "background:uninstall",
  },
  {
    action: "app.doctor",
    groupId: "lifecycle",
    summary: "打印当前配置、边界和线程状态",
    terminal: ["doctor"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "doctor",
    command: "doctor",
    runner: "doctor",
    help: { topic: "system", leafKey: "app.doctor", detail: "leaf" },
  },
  {
    action: "system.send",
    groupId: "lifecycle",
    summary: "向内部系统队列写入一条不可见触发消息",
    terminal: ["system send"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "system:send",
    command: "system",
    subcommand: "send",
    runner: "system.send",
    argsSchemaKey: "systemSend",
    help: { topic: "system", leafKey: "system.send", detail: "leaf" },
  },
  {
    action: "system.checkin_config",
    groupId: "lifecycle",
    summary: "查看或修改主动 check-in 的随机区间",
    terminal: ["system checkin"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    command: "system",
    subcommand: "checkin",
    runner: "system.checkin-config",
    argsSchemaKey: "systemCheckinConfig",
    help: { topic: "system", leafKey: "system.checkin_config", detail: "leaf" },
  },
  {
    action: "system.checkin_poller",
    groupId: "lifecycle",
    summary: "按随机间隔写入主动 check-in 触发",
    terminal: ["system checkin-poller"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "system:checkin",
    command: "system",
    subcommand: "checkin-poller",
    runner: "system.checkin-poller",
    help: { topic: "system", leafKey: "system.checkin_poller", detail: "topic_only" },
  },
  {
    action: "workspace.bind",
    groupId: "workspace",
    summary: "绑定当前聊天使用的项目目录",
    terminal: [],
    weixin: ["/bind"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "workspace.status",
    groupId: "workspace",
    summary: "查看当前项目、线程、模型与上下文使用情况",
    terminal: [],
    weixin: ["/status"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "thread.new",
    groupId: "workspace",
    summary: "切到新线程草稿，并在下一条消息前重建当前 workspace 上下文",
    terminal: [],
    weixin: ["/new"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "thread.reread",
    groupId: "workspace",
    summary: "让当前线程重新读取最新 instructions 和当前 workspace 稳定入口",
    terminal: [],
    weixin: ["/reread"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "thread.switch",
    groupId: "workspace",
    summary: "切换到指定线程，并在下一条消息前按当前 workspace 检查是否要补读稳定入口",
    terminal: [],
    weixin: ["/switch <threadId>"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "thread.stop",
    groupId: "workspace",
    summary: "停止当前线程中的运行",
    terminal: [],
    weixin: ["/stop"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "approval.accept_once",
    groupId: "approval",
    summary: "允许当前待处理的授权请求一次",
    terminal: [],
    weixin: ["/yes"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "approval.accept_workspace",
    groupId: "approval",
    summary: "在当前项目内持续允许同前缀命令",
    terminal: [],
    weixin: ["/always"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "approval.reject_once",
    groupId: "approval",
    summary: "拒绝当前待处理的授权请求",
    terminal: [],
    weixin: ["/no"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "project.radar",
    groupId: "projects",
    summary: "读取已跟踪代码项目的稳定入口与轻量 git 近况",
    terminal: ["project radar"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "project:radar",
    command: "project",
    subcommand: "radar",
    runner: "project.radar",
    argsSchemaKey: "projectRadar",
    help: { topic: "project", leafKey: "project.radar", detail: "leaf" },
    approval: { autoApprove: true },
  },
  {
    action: "note.sync",
    groupId: "projects",
    summary: "把轻量 durable 摘要同步到指定 note 的指定 section",
    terminal: ["note sync"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "note:sync",
    command: "note",
    subcommand: "sync",
    runner: "note.sync",
    argsSchemaKey: "noteSync",
    help: { topic: "note", leafKey: "note.sync", detail: "leaf" },
    approval: { autoApprove: true },
  },
  {
    action: "note.auto",
    groupId: "projects",
    summary: "按 workspace durable note schema 自动选择 note 与 section 并落盘",
    terminal: ["note auto"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "note:auto",
    command: "note",
    subcommand: "auto",
    runner: "note.auto",
    argsSchemaKey: "noteAuto",
    help: { topic: "note", leafKey: "note.auto", detail: "leaf" },
    approval: { autoApprove: true },
  },
  {
    action: "note.maybe",
    groupId: "projects",
    summary: "预览 durable note 路由，不实际写入",
    terminal: ["note maybe"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "note:maybe",
    command: "note",
    subcommand: "maybe",
    runner: "note.maybe",
    argsSchemaKey: "noteAuto",
    help: { topic: "note", leafKey: "note.maybe", detail: "leaf" },
    approval: { autoApprove: true },
  },
  {
    action: "review.nightly",
    groupId: "projects",
    summary: "从日记真相源生成一份睡前收口",
    terminal: ["review nightly"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "review:nightly",
    command: "review",
    subcommand: "nightly",
    runner: "review.command",
    argsSchemaKey: "review",
    help: { topic: "review", leafKey: "review.nightly", detail: "leaf" },
    kind: "nightly",
    approval: { autoApprove: true },
  },
  {
    action: "review.weekly",
    groupId: "projects",
    summary: "从日记真相源生成一份周复盘",
    terminal: ["review weekly"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "review:weekly",
    command: "review",
    subcommand: "weekly",
    runner: "review.command",
    argsSchemaKey: "review",
    help: { topic: "review", leafKey: "review.weekly", detail: "leaf" },
    kind: "weekly",
    approval: { autoApprove: true },
  },
  {
    action: "review.monthly",
    groupId: "projects",
    summary: "从日记真相源生成一份月复盘",
    terminal: ["review monthly"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "review:monthly",
    command: "review",
    subcommand: "monthly",
    runner: "review.command",
    argsSchemaKey: "review",
    help: { topic: "review", leafKey: "review.monthly", detail: "leaf" },
    kind: "monthly",
    approval: { autoApprove: true },
  },
  {
    action: "model.inspect",
    groupId: "capabilities",
    summary: "查看当前模型与 effort",
    terminal: [],
    weixin: ["/model"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "model.select",
    groupId: "capabilities",
    summary: "切换到指定模型，可选同时设置 effort",
    terminal: [],
    weixin: ["/model <id> [effort]"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "effort.inspect",
    groupId: "capabilities",
    summary: "查看当前 effort",
    terminal: [],
    weixin: ["/effort"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "effort.select",
    groupId: "capabilities",
    summary: "只调整当前 effort",
    terminal: [],
    weixin: ["/effort <level>"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "checkin.inspect",
    groupId: "capabilities",
    summary: "查看当前 checkin 区间",
    terminal: [],
    weixin: ["/checkin"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "checkin.select",
    groupId: "capabilities",
    summary: "修改或重置 checkin 区间",
    terminal: [],
    weixin: ["/checkin <min>-<max>", "/checkin reset"],
    status: "active",
    entrypointType: "weixin",
  },
  {
    action: "channel.send_file",
    groupId: "capabilities",
    summary: "将文件作为附件发送回当前聊天",
    terminal: ["channel send-file"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "channel:send-file",
    command: "channel",
    subcommand: "send-file",
    runner: "channel.send-file",
    argsSchemaKey: "channelSendFile",
    help: { topic: "channel", leafKey: "channel.send_file", detail: "leaf" },
  },
  {
    action: "timeline.event",
    groupId: "capabilities",
    summary: "按单个时间块写入时间轴，不必手写 JSON",
    terminal: ["timeline event"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "timeline:event",
    command: "timeline",
    subcommand: "event",
    runner: "timeline.event",
    argsSchemaKey: "timelineEvent",
    help: { topic: "timeline", leafKey: "timeline.event", detail: "leaf" },
    approval: { autoApprove: true },
  },
  {
    action: "timeline.write",
    groupId: "capabilities",
    summary: "按批量或原始 JSON 写入时间轴事件（低层入口）",
    terminal: ["timeline write"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "timeline:write",
    command: "timeline",
    subcommand: "write",
    runner: "timeline.subcommand",
    argsSchemaKey: "timelineWrite",
    help: { topic: "timeline", leafKey: "timeline.write", detail: "leaf" },
    timelineSubcommand: "write",
    approval: { autoApprove: true },
  },
  {
    action: "timeline.read",
    groupId: "capabilities",
    summary: "读取某一天的时间轴草稿或已发布内容",
    terminal: ["timeline read"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "timeline:read",
    command: "timeline",
    subcommand: "read",
    runner: "timeline.subcommand",
    argsSchemaKey: "timelineRead",
    help: { topic: "timeline", leafKey: "timeline.read", detail: "leaf" },
    timelineSubcommand: "read",
    approval: { autoApprove: true },
  },
  {
    action: "timeline.categories",
    groupId: "capabilities",
    summary: "查看可用分类、子类和 event node",
    terminal: ["timeline categories"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "timeline:categories",
    command: "timeline",
    subcommand: "categories",
    runner: "timeline.subcommand",
    argsSchemaKey: "timelineCategories",
    help: { topic: "timeline", leafKey: "timeline.categories", detail: "leaf" },
    timelineSubcommand: "categories",
    approval: { autoApprove: true },
  },
  {
    action: "timeline.proposals",
    groupId: "capabilities",
    summary: "根据自然语言生成候选时间轴事件",
    terminal: ["timeline proposals"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "timeline:proposals",
    command: "timeline",
    subcommand: "proposals",
    runner: "timeline.subcommand",
    argsSchemaKey: "timelineProposals",
    help: { topic: "timeline", leafKey: "timeline.proposals", detail: "leaf" },
    timelineSubcommand: "proposals",
    approval: { autoApprove: true },
  },
  {
    action: "timeline.build",
    groupId: "capabilities",
    summary: "构建时间轴静态页面",
    terminal: ["timeline build"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "timeline:build",
    command: "timeline",
    subcommand: "build",
    runner: "timeline.subcommand",
    argsSchemaKey: "timelineBuild",
    help: { topic: "timeline", leafKey: "timeline.build", detail: "leaf" },
    timelineSubcommand: "build",
    approval: { autoApprove: true },
  },
  {
    action: "timeline.serve",
    groupId: "capabilities",
    summary: "启动时间轴静态页面服务",
    terminal: ["timeline serve"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "timeline:serve",
    command: "timeline",
    subcommand: "serve",
    runner: "timeline.subcommand",
    argsSchemaKey: "timelineServe",
    help: { topic: "timeline", leafKey: "timeline.serve", detail: "leaf" },
    timelineSubcommand: "serve",
    approval: { autoApprove: true },
  },
  {
    action: "timeline.dev",
    groupId: "capabilities",
    summary: "启动时间轴热更新开发服务",
    terminal: ["timeline dev"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "timeline:dev",
    command: "timeline",
    subcommand: "dev",
    runner: "timeline.subcommand",
    argsSchemaKey: "timelineDev",
    help: { topic: "timeline", leafKey: "timeline.dev", detail: "leaf" },
    timelineSubcommand: "dev",
    approval: { autoApprove: true },
  },
  {
    action: "timeline.screenshot",
    groupId: "capabilities",
    summary: "截图时间轴页面",
    terminal: ["timeline screenshot"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "timeline:screenshot",
    command: "timeline",
    subcommand: "screenshot",
    runner: "timeline.screenshot",
    argsSchemaKey: "timelineScreenshot",
    help: { topic: "timeline", leafKey: "timeline.screenshot", detail: "leaf" },
    approval: { autoApprove: true },
  },
  {
    action: "reminder.create",
    groupId: "capabilities",
    summary: "创建提醒并交给调度层处理",
    terminal: ["reminder write"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "reminder:write",
    command: "reminder",
    subcommand: "write",
    runner: "reminder.write",
    argsSchemaKey: "reminderWrite",
    help: { topic: "reminder", leafKey: "reminder.create", detail: "leaf" },
    approval: { autoApprove: true },
  },
  {
    action: "diary.append",
    groupId: "capabilities",
    summary: "追加一条日记记录",
    terminal: ["diary write"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "diary:write",
    command: "diary",
    subcommand: "write",
    runner: "diary.write",
    argsSchemaKey: "diaryWrite",
    help: { topic: "diary", leafKey: "diary.append", detail: "leaf" },
    approval: { autoApprove: true },
  },
  {
    action: "app.help",
    groupId: "capabilities",
    summary: "查看当前通道可用命令",
    terminal: ["help"],
    weixin: ["/help"],
    status: "active",
    entrypointType: "cli",
    scriptName: "help",
    command: "help",
    runner: "help",
    help: { topic: "", leafKey: "app.help", detail: "topic_only" },
  },
] as const satisfies readonly CommandActionDefinition[];
// endregion

// region Derived type unions
type CommandActionDefinitionRecord = typeof COMMAND_ACTION_DEFINITIONS[number];
type ActionWithHelp = Extract<CommandActionDefinitionRecord, { help: CommandHelpDefinition }>;
type CliTerminalActionDefinition = Extract<CommandActionDefinitionRecord, {
  entrypointType: "cli";
  command: string;
}>;
type CliTerminalActionWithHelp = Extract<CliTerminalActionDefinition, { help: CommandHelpDefinition }>;
type ExtractStringField<T, K extends PropertyKey> = T extends Record<K, infer V> ? Extract<V, string> : never;
type ExtractHelpStringField<T, K extends keyof CommandHelpDefinition> = T extends { help: infer H }
  ? H extends Record<K, infer V>
    ? Extract<V, string>
    : never
  : never;

export type CommandActionId = CommandActionDefinitionRecord["action"];
export type CommandAudience = CommandAudienceDefinition;
export type CommandArgsSchemaKey = ExtractStringField<CommandActionDefinitionRecord, "argsSchemaKey">;
export type CommandAuthRequirement = CommandAuthRequirementDefinition;
export type CommandEntrypointType = CommandActionDefinitionRecord["entrypointType"];
export type CommandGroupId = typeof COMMAND_GROUP_DEFINITIONS[number]["id"];
export type CommandHelpDetail = CommandHelpDefinition["detail"];
export type CommandHelpLeafKey = ExtractHelpStringField<ActionWithHelp, "leafKey">;
export type CommandHelpTopic = ExtractHelpStringField<ActionWithHelp, "topic">;
export type CommandKind = ExtractStringField<CommandActionDefinitionRecord, "kind">;
export type CommandMutability = CommandMutabilityDefinition;
export type CommandRunnerId = ExtractStringField<CommandActionDefinitionRecord, "runner">;
export type CommandSafetyTier = CommandSafetyTierDefinition;
export type CommandScriptName = ExtractStringField<CommandActionDefinitionRecord, "scriptName">;
export type CommandStatus = ExtractStringField<CommandActionDefinitionRecord, "status">;
export type CommandTimelineSubcommand = ExtractStringField<CommandActionDefinitionRecord, "timelineSubcommand">;
export type PlannedTerminalTopic = Exclude<ExtractHelpStringField<CliTerminalActionWithHelp, "topic">, "">;
export type CommandLeafHelpKey = Extract<ActionWithHelp, {
  help: { detail: "leaf"; leafKey: string };
}>["help"]["leafKey"];
export type CommandTopicOnlyLeafKey = Extract<ActionWithHelp, {
  help: { detail: "topic_only"; leafKey: string };
}>["help"]["leafKey"];
// endregion

// region Classification tables
export const COMMAND_AUDIENCE_OVERRIDES: Readonly<Partial<Record<CommandActionId, CommandAudienceDefinition>>> = Object.freeze({
  "app.accounts": "operator",
  "app.login": "operator",
  "app.shared_open": "operator",
  "app.shared_start": "operator",
  "app.shared_status": "operator",
  "app.shared_watchdog": "operator",
  "app.start": "operator",
  "background.install": "operator",
  "background.uninstall": "operator",
  "operator.help": "operator",
  "operator.schema": "operator",
  "system.checkin_poller": "operator",
});

export const COMMAND_SAFETY_OVERRIDES: Readonly<Partial<Record<CommandActionId, CommandSafetyTierDefinition>>> = Object.freeze({
  "app.accounts": "operator",
  "app.doctor": "open",
  "app.help": "open",
  "app.login": "operator",
  "app.schema": "open",
  "app.shared_open": "operator",
  "app.shared_start": "operator",
  "app.shared_status": "operator",
  "app.shared_watchdog": "operator",
  "app.start": "operator",
  "background.install": "operator",
  "background.uninstall": "operator",
  "channel.send_file": "warned",
  "diary.append": "warned",
  "note.auto": "warned",
  "note.maybe": "open",
  "note.sync": "warned",
  "operator.help": "operator",
  "operator.schema": "operator",
  "project.radar": "open",
  "reminder.create": "warned",
  "review.monthly": "warned",
  "review.nightly": "warned",
  "review.weekly": "warned",
  "system.checkin_config": "warned",
  "system.checkin_poller": "operator",
  "system.send": "warned",
  "timeline.build": "open",
  "timeline.categories": "open",
  "timeline.dev": "open",
  "timeline.event": "warned",
  "timeline.proposals": "open",
  "timeline.read": "open",
  "timeline.screenshot": "warned",
  "timeline.serve": "open",
  "timeline.write": "warned",
});

export const COMMAND_MUTABILITY_OVERRIDES: Readonly<Partial<Record<CommandActionId, CommandMutabilityDefinition>>> = Object.freeze({
  "app.accounts": "bootstrap",
  "app.doctor": "read",
  "app.help": "read",
  "app.login": "bootstrap",
  "app.schema": "read",
  "app.shared_open": "bootstrap",
  "app.shared_start": "long_running",
  "app.shared_status": "read",
  "app.shared_watchdog": "long_running",
  "app.start": "long_running",
  "background.install": "bootstrap",
  "background.uninstall": "bootstrap",
  "channel.send_file": "write",
  "diary.append": "write",
  "note.auto": "write",
  "note.maybe": "read",
  "note.sync": "write",
  "operator.help": "read",
  "operator.schema": "read",
  "project.radar": "read",
  "reminder.create": "write",
  "review.monthly": "write",
  "review.nightly": "write",
  "review.weekly": "write",
  "system.checkin_config": "write",
  "system.checkin_poller": "long_running",
  "system.send": "write",
  "timeline.build": "read",
  "timeline.categories": "read",
  "timeline.dev": "long_running",
  "timeline.event": "write",
  "timeline.proposals": "read",
  "timeline.read": "read",
  "timeline.screenshot": "write",
  "timeline.serve": "long_running",
  "timeline.write": "write",
});

export const COMMAND_AUTH_OVERRIDES: Readonly<Partial<Record<CommandActionId, CommandAuthRequirementDefinition>>> = Object.freeze({
  "app.accounts": "weixin_account",
  "app.login": "none",
  "app.shared_open": "runtime_bootstrap",
  "app.shared_start": "runtime_bootstrap",
  "app.shared_status": "runtime_bootstrap",
  "app.shared_watchdog": "runtime_bootstrap",
  "app.start": "runtime_bootstrap",
  "channel.send_file": "runtime_bootstrap",
  "reminder.create": "context_token",
  "system.send": "context_token",
  "timeline.screenshot": "context_token",
});
// endregion

// region Resolution helpers
export function resolveCommandAudienceDefinition(
  actionId: CommandActionId,
  entrypointType: CommandActionDefinition["entrypointType"],
): CommandAudienceDefinition {
  if (COMMAND_AUDIENCE_OVERRIDES[actionId]) {
    return COMMAND_AUDIENCE_OVERRIDES[actionId] || "public";
  }
  return entrypointType === "script" ? "operator" : "public";
}

export function resolveCommandAuthRequirementDefinition(actionId: CommandActionId): CommandAuthRequirementDefinition {
  return COMMAND_AUTH_OVERRIDES[actionId] || "none";
}

export function resolveCommandMutabilityDefinition(actionId: CommandActionId): CommandMutabilityDefinition {
  return COMMAND_MUTABILITY_OVERRIDES[actionId] || "read";
}

export function resolveCommandSafetyTierDefinition(actionId: CommandActionId): CommandSafetyTierDefinition {
  return COMMAND_SAFETY_OVERRIDES[actionId] || "open";
}
// endregion
