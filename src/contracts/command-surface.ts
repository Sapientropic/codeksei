export type CommandEntrypointType = "cli" | "script" | "weixin";

interface CommandGroupMeta {
  id: string;
  label: string;
}

interface CommandHelp {
  topic: string;
  leafKey: string;
}

export interface CommandApproval {
  autoApprove: boolean;
}

export interface CommandAction {
  action: string;
  groupId: string;
  summary: string;
  terminal: string[];
  weixin: string[];
  status: string;
  entrypointType: string;
  scriptName: string;
  command: string;
  subcommand: string;
  runner: string;
  argsSchemaKey: string;
  kind: string;
  timelineSubcommand: string;
  help: Readonly<CommandHelp>;
  approval: Readonly<CommandApproval>;
}

interface CommandActionInput {
  action?: unknown;
  groupId?: unknown;
  summary?: unknown;
  terminal?: unknown;
  weixin?: unknown;
  status?: unknown;
  entrypointType?: CommandEntrypointType | unknown;
  scriptName?: unknown;
  command?: unknown;
  subcommand?: unknown;
  runner?: unknown;
  argsSchemaKey?: unknown;
  kind?: unknown;
  timelineSubcommand?: unknown;
  help?: {
    topic?: unknown;
    leafKey?: unknown;
  };
  approval?: {
    autoApprove?: unknown;
  };
}

export interface TerminalCommandManifestEntry {
  key: string;
  command: string;
  subcommand: string;
  action: string;
  runner: string;
  argsSchemaKey: string;
  helpTopic: string;
  kind: string;
  timelineSubcommand: string;
  scriptName: string;
  approval: CommandApproval;
  entrypointType: string;
}

export interface CommandGroup {
  id: string;
  label: string;
  actions: CommandAction[];
}

const COMMAND_GROUP_METADATA = Object.freeze<readonly CommandGroupMeta[]>([
  { id: "lifecycle", label: "启动与诊断" },
  { id: "workspace", label: "项目与线程" },
  { id: "approval", label: "授权与控制" },
  { id: "projects", label: "代码项目" },
  { id: "capabilities", label: "能力集成" },
]);

const COMMAND_ACTIONS = Object.freeze<readonly CommandAction[]>([
  defineAction({
    action: "app.login",
    groupId: "lifecycle",
    summary: "发起微信扫码登录并保存账号",
    terminal: ["login"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "login",
    command: "login",
    runner: "login",
  }),
  defineAction({
    action: "app.accounts",
    groupId: "lifecycle",
    summary: "查看本地已保存账号",
    terminal: ["accounts"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "accounts",
    command: "accounts",
    runner: "accounts",
  }),
  defineAction({
    action: "app.start",
    groupId: "lifecycle",
    summary: "启动当前 channel/runtime 主循环",
    terminal: ["start"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    scriptName: "start",
    command: "start",
    runner: "start",
  }),
  defineAction({
    action: "app.shared_start",
    groupId: "lifecycle",
    summary: "启动共享 app-server 与共享微信桥接",
    terminal: ["shared:start"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "shared:start",
  }),
  defineAction({
    action: "app.shared_open",
    groupId: "lifecycle",
    summary: "接入当前微信绑定的共享线程",
    terminal: ["shared:open"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "shared:open",
  }),
  defineAction({
    action: "app.shared_status",
    groupId: "lifecycle",
    summary: "查看共享 app-server 与共享桥接状态",
    terminal: ["shared:status"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "shared:status",
  }),
  defineAction({
    action: "app.shared_watchdog",
    groupId: "lifecycle",
    summary: "主动巡检并自恢复共享链路",
    terminal: ["shared:watchdog"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "shared:watchdog",
  }),
  defineAction({
    action: "background.install",
    groupId: "lifecycle",
    summary: "Windows 安装开机自启与周期巡检",
    terminal: ["background:install"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "background:install",
  }),
  defineAction({
    action: "background.uninstall",
    groupId: "lifecycle",
    summary: "Windows 卸载开机自启与周期巡检",
    terminal: ["background:uninstall"],
    weixin: [],
    status: "active",
    entrypointType: "script",
    scriptName: "background:uninstall",
  }),
  defineAction({
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
  }),
  defineAction({
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
    help: { topic: "system", leafKey: "system.send" },
  }),
  defineAction({
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
    help: { topic: "system" },
  }),
  defineAction({
    action: "workspace.bind",
    groupId: "workspace",
    summary: "绑定当前聊天使用的项目目录",
    terminal: [],
    weixin: ["/bind"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
    action: "workspace.status",
    groupId: "workspace",
    summary: "查看当前项目、线程、模型与上下文使用情况",
    terminal: [],
    weixin: ["/status"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
    action: "thread.new",
    groupId: "workspace",
    summary: "切到新线程草稿，并在下一条消息前重建当前 workspace 上下文",
    terminal: [],
    weixin: ["/new"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
    action: "thread.reread",
    groupId: "workspace",
    summary: "让当前线程重新读取最新 instructions 和当前 workspace 稳定入口",
    terminal: [],
    weixin: ["/reread"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
    action: "thread.switch",
    groupId: "workspace",
    summary: "切换到指定线程，并在下一条消息前按当前 workspace 检查是否要补读稳定入口",
    terminal: [],
    weixin: ["/switch <threadId>"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
    action: "thread.stop",
    groupId: "workspace",
    summary: "停止当前线程中的运行",
    terminal: [],
    weixin: ["/stop"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
    action: "approval.accept_once",
    groupId: "approval",
    summary: "允许当前待处理的授权请求一次",
    terminal: [],
    weixin: ["/yes"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
    action: "approval.accept_workspace",
    groupId: "approval",
    summary: "在当前项目内持续允许同前缀命令",
    terminal: [],
    weixin: ["/always"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
    action: "approval.reject_once",
    groupId: "approval",
    summary: "拒绝当前待处理的授权请求",
    terminal: [],
    weixin: ["/no"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
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
    help: { topic: "project", leafKey: "project.radar" },
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "note", leafKey: "note.sync" },
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "note", leafKey: "note.auto" },
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "note", leafKey: "note.maybe" },
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "review", leafKey: "review.nightly" },
    kind: "nightly",
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "review", leafKey: "review.weekly" },
    kind: "weekly",
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "review", leafKey: "review.monthly" },
    kind: "monthly",
    approval: { autoApprove: true },
  }),
  defineAction({
    action: "model.inspect",
    groupId: "capabilities",
    summary: "查看当前模型",
    terminal: [],
    weixin: ["/model"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
    action: "model.select",
    groupId: "capabilities",
    summary: "切换到指定模型",
    terminal: [],
    weixin: ["/model <id>"],
    status: "active",
    entrypointType: "weixin",
  }),
  defineAction({
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
    help: { topic: "channel", leafKey: "channel.send_file" },
  }),
  defineAction({
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
    help: { topic: "timeline", leafKey: "timeline.event" },
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "timeline" },
    timelineSubcommand: "write",
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "timeline" },
    timelineSubcommand: "read",
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "timeline" },
    timelineSubcommand: "categories",
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "timeline" },
    timelineSubcommand: "proposals",
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "timeline" },
    timelineSubcommand: "build",
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "timeline" },
    timelineSubcommand: "serve",
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "timeline" },
    timelineSubcommand: "dev",
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "timeline", leafKey: "timeline.screenshot" },
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "reminder" },
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "diary" },
    approval: { autoApprove: true },
  }),
  defineAction({
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
    help: { topic: "", leafKey: "app.help" },
  }),
]);

const COMMAND_ACTIONS_BY_ID = new Map<string, CommandAction>(
  COMMAND_ACTIONS.map((entry): [string, CommandAction] => [entry.action, entry])
);
const TERMINAL_COMMAND_MANIFEST = Object.freeze<readonly TerminalCommandManifestEntry[]>(
  COMMAND_ACTIONS
    .filter((entry) => entry.entrypointType === "cli" && entry.command)
    .map((entry): TerminalCommandManifestEntry => ({
      key: [entry.command, entry.subcommand].filter(Boolean).join(" "),
      command: entry.command,
      subcommand: entry.subcommand,
      action: entry.action,
      runner: entry.runner,
      argsSchemaKey: entry.argsSchemaKey,
      helpTopic: entry.help.topic,
      kind: entry.kind,
      timelineSubcommand: entry.timelineSubcommand,
      scriptName: entry.scriptName,
      approval: { ...entry.approval },
      entrypointType: entry.entrypointType,
    }))
);
const TERMINAL_COMMAND_MANIFEST_BY_KEY = new Map(
  TERMINAL_COMMAND_MANIFEST.map((entry): [string, TerminalCommandManifestEntry] => [entry.key, entry])
);
const TERMINAL_COMMAND_MANIFEST_BY_SCRIPT_NAME = new Map(
  TERMINAL_COMMAND_MANIFEST
    .filter((entry) => entry.scriptName)
    .map((entry): [string, TerminalCommandManifestEntry] => [normalizeCommandLookupKey(entry.scriptName), entry])
);

function defineAction(entry: CommandActionInput): CommandAction {
  const normalized = {
    action: normalizeCommandLookupKey(entry.action),
    groupId: normalizeCommandLookupKey(entry.groupId),
    summary: String(entry.summary || "").trim(),
    terminal: normalizeStringList(entry.terminal),
    weixin: normalizeStringList(entry.weixin),
    status: normalizeCommandLookupKey(entry.status) || "active",
    entrypointType: normalizeCommandLookupKey(entry.entrypointType),
    scriptName: String(entry.scriptName || "").trim(),
    command: normalizeCommandLookupKey(entry.command),
    subcommand: normalizeCommandLookupKey(entry.subcommand),
    runner: String(entry.runner || "").trim(),
    argsSchemaKey: String(entry.argsSchemaKey || "").trim(),
    kind: String(entry.kind || "").trim(),
    timelineSubcommand: String(entry.timelineSubcommand || "").trim(),
    help: Object.freeze({
      topic: normalizeCommandLookupKey(entry.help?.topic),
      leafKey: normalizeCommandLookupKey(entry.help?.leafKey) || normalizeCommandLookupKey(entry.action),
    }),
    approval: Object.freeze({
      autoApprove: Boolean(entry.approval?.autoApprove),
    }),
  };
  return Object.freeze(normalized);
}

function normalizeStringList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function listCommandActions(): CommandAction[] {
  return COMMAND_ACTIONS.map(cloneAction);
}

function findCommandAction(action: unknown): CommandAction | null {
  const entry = COMMAND_ACTIONS_BY_ID.get(normalizeCommandLookupKey(action));
  return entry ? cloneAction(entry) : null;
}

function listCommandGroups(): CommandGroup[] {
  return COMMAND_GROUP_METADATA.map((group) => ({
    ...group,
    actions: COMMAND_ACTIONS
      .filter((entry) => entry.groupId === group.id)
      .map(cloneAction),
  }));
}

function listTerminalCommandManifest(): TerminalCommandManifestEntry[] {
  return TERMINAL_COMMAND_MANIFEST.map((entry) => ({
    ...entry,
    approval: { ...entry.approval },
  }));
}

function findTerminalCommandManifest(command: unknown, subcommand: string = ""): TerminalCommandManifestEntry | null {
  const key = [normalizeCommandLookupKey(command), normalizeCommandLookupKey(subcommand)].filter(Boolean).join(" ");
  const entry = TERMINAL_COMMAND_MANIFEST_BY_KEY.get(key);
  return entry ? { ...entry, approval: { ...entry.approval } } : null;
}

function findTerminalManifestByScriptName(scriptName: unknown): TerminalCommandManifestEntry | null {
  const entry = TERMINAL_COMMAND_MANIFEST_BY_SCRIPT_NAME.get(normalizeCommandLookupKey(scriptName));
  return entry ? { ...entry, approval: { ...entry.approval } } : null;
}

function cloneAction(entry: CommandAction): CommandAction {
  return {
    ...entry,
    terminal: [...entry.terminal],
    weixin: [...entry.weixin],
    help: { ...entry.help },
    approval: { ...entry.approval },
  };
}

function normalizeCommandLookupKey(value: unknown): string {
  // Only internal command/manifest identifiers should fold case here.
  // User-visible text stays trim-only in owner-local helpers elsewhere.
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export {
  findCommandAction,
  findTerminalCommandManifest,
  findTerminalManifestByScriptName,
  listCommandActions,
  listCommandGroups,
  listTerminalCommandManifest,
};
