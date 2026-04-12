// @ts-check

const COMMAND_GROUPS = [
  {
    id: "lifecycle",
    label: "启动与诊断",
    actions: [
      { action: "app.login", summary: "发起微信扫码登录并保存账号", terminal: ["login"], weixin: [], status: "active" },
      { action: "app.accounts", summary: "查看本地已保存账号", terminal: ["accounts"], weixin: [], status: "active" },
      { action: "app.start", summary: "启动当前 channel/runtime 主循环", terminal: ["start"], weixin: [], status: "active" },
      { action: "app.shared_start", summary: "启动共享 app-server 与共享微信桥接", terminal: ["shared start"], weixin: [], status: "active" },
      { action: "app.shared_open", summary: "接入当前微信绑定的共享线程", terminal: ["shared open"], weixin: [], status: "active" },
      { action: "app.shared_status", summary: "查看共享 app-server 与共享桥接状态", terminal: ["shared status"], weixin: [], status: "active" },
      { action: "app.doctor", summary: "打印当前配置、边界和线程状态", terminal: ["doctor"], weixin: [], status: "active" },
      { action: "system.send", summary: "向内部系统队列写入一条不可见触发消息", terminal: ["system send"], terminalGroup: "system", weixin: [], status: "active" },
      { action: "system.checkin_poller", summary: "按随机间隔写入主动 check-in 触发", terminal: ["system checkin-poller"], terminalGroup: "system", weixin: [], status: "active" },
    ],
  },
  {
    id: "workspace",
    label: "项目与线程",
    actions: [
      { action: "workspace.bind", summary: "绑定当前聊天使用的项目目录", terminal: [], weixin: ["/bind"], status: "active" },
      { action: "workspace.status", summary: "查看当前项目、线程、模型与上下文使用情况", terminal: [], weixin: ["/status"], status: "active" },
      { action: "thread.new", summary: "切到新线程草稿，并在下一条消息前重建当前 workspace 上下文", terminal: [], weixin: ["/new"], status: "active" },
      { action: "thread.reread", summary: "让当前线程重新读取最新 instructions 和当前 workspace 稳定入口", terminal: [], weixin: ["/reread"], status: "active" },
      { action: "thread.switch", summary: "切换到指定线程，并在下一条消息前按当前 workspace 检查是否要补读稳定入口", terminal: [], weixin: ["/switch <threadId>"], status: "active" },
      { action: "thread.stop", summary: "停止当前线程中的运行", terminal: [], weixin: ["/stop"], status: "active" },
    ],
  },
  {
    id: "approval",
    label: "授权与控制",
    actions: [
      { action: "approval.accept_once", summary: "允许当前待处理的授权请求一次", terminal: [], weixin: ["/yes"], status: "active" },
      { action: "approval.accept_workspace", summary: "在当前项目内持续允许同前缀命令", terminal: [], weixin: ["/always"], status: "active" },
      { action: "approval.reject_once", summary: "拒绝当前待处理的授权请求", terminal: [], weixin: ["/no"], status: "active" },
    ],
  },
  {
    id: "projects",
    label: "代码项目",
    actions: [
      { action: "project.radar", summary: "读取已跟踪代码项目的稳定入口与轻量 git 近况", terminal: ["project radar"], terminalGroup: "project", weixin: [], status: "active" },
      { action: "note.sync", summary: "把轻量 durable 摘要同步到指定 note 的指定 section", terminal: ["note sync"], terminalGroup: "note", weixin: [], status: "active" },
      { action: "note.auto", summary: "按 workspace durable note schema 自动选择 note 与 section 并落盘", terminal: ["note auto"], terminalGroup: "note", weixin: [], status: "active" },
      { action: "note.maybe", summary: "预览 durable note 路由，不实际写入", terminal: ["note maybe"], terminalGroup: "note", weixin: [], status: "active" },
      { action: "review.nightly", summary: "从日记真相源生成一份睡前收口", terminal: ["review nightly"], terminalGroup: "review", weixin: [], status: "active" },
      { action: "review.weekly", summary: "从日记真相源生成一份周复盘", terminal: ["review weekly"], terminalGroup: "review", weixin: [], status: "active" },
      { action: "review.monthly", summary: "从日记真相源生成一份月复盘", terminal: ["review monthly"], terminalGroup: "review", weixin: [], status: "active" },
    ],
  },
  {
    id: "capabilities",
    label: "能力集成",
    actions: [
      { action: "model.inspect", summary: "查看当前模型", terminal: [], weixin: ["/model"], status: "active" },
      { action: "model.select", summary: "切换到指定模型", terminal: [], weixin: ["/model <id>"], status: "active" },
      { action: "channel.send_file", summary: "将文件作为附件发送回当前聊天", terminal: ["channel send-file"], terminalGroup: "channel", weixin: [], status: "active" },
      { action: "timeline.event", summary: "按单个时间块写入时间轴，不必手写 JSON", terminal: ["timeline event"], terminalGroup: "timeline", weixin: [], status: "active" },
      { action: "timeline.write", summary: "按批量或原始 JSON 写入时间轴事件（低层入口）", terminal: ["timeline write"], terminalGroup: "timeline", weixin: [], status: "active" },
      { action: "timeline.read", summary: "读取某一天的时间轴草稿或已发布内容", terminal: ["timeline read"], terminalGroup: "timeline", weixin: [], status: "active" },
      { action: "timeline.categories", summary: "查看可用分类、子类和 event node", terminal: ["timeline categories"], terminalGroup: "timeline", weixin: [], status: "active" },
      { action: "timeline.proposals", summary: "根据自然语言生成候选时间轴事件", terminal: ["timeline proposals"], terminalGroup: "timeline", weixin: [], status: "active" },
      { action: "timeline.build", summary: "构建时间轴静态页面", terminal: ["timeline build"], terminalGroup: "timeline", weixin: [], status: "active" },
      { action: "timeline.serve", summary: "启动时间轴静态页面服务", terminal: ["timeline serve"], terminalGroup: "timeline", weixin: [], status: "active" },
      { action: "timeline.dev", summary: "启动时间轴热更新开发服务", terminal: ["timeline dev"], terminalGroup: "timeline", weixin: [], status: "active" },
      { action: "timeline.screenshot", summary: "截图时间轴页面", terminal: ["timeline screenshot"], terminalGroup: "timeline", weixin: [], status: "active" },
      { action: "reminder.create", summary: "创建提醒并交给调度层处理", terminal: ["reminder write"], terminalGroup: "reminder", weixin: [], status: "active" },
      { action: "diary.append", summary: "追加一条日记记录", terminal: ["diary write"], terminalGroup: "diary", weixin: [], status: "active" },
      { action: "app.help", summary: "查看当前通道可用命令", terminal: ["help"], weixin: ["/help"], status: "active" },
    ],
  },
];

const TERMINAL_COMMAND_MANIFEST = Object.freeze([
  { key: "help", command: "help", subcommand: "", action: "app.help", runner: "help", argsSchemaKey: "", helpTopic: "" },
  { key: "login", command: "login", subcommand: "", action: "app.login", runner: "login", argsSchemaKey: "", helpTopic: "" },
  { key: "accounts", command: "accounts", subcommand: "", action: "app.accounts", runner: "accounts", argsSchemaKey: "", helpTopic: "" },
  { key: "start", command: "start", subcommand: "", action: "app.start", runner: "start", argsSchemaKey: "", helpTopic: "" },
  { key: "doctor", command: "doctor", subcommand: "", action: "app.doctor", runner: "doctor", argsSchemaKey: "", helpTopic: "" },
  { key: "channel send-file", command: "channel", subcommand: "send-file", action: "channel.send_file", runner: "channel.send-file", argsSchemaKey: "channelSendFile", helpTopic: "channel" },
  { key: "note sync", command: "note", subcommand: "sync", action: "note.sync", runner: "note.sync", argsSchemaKey: "noteSync", helpTopic: "note" },
  { key: "note auto", command: "note", subcommand: "auto", action: "note.auto", runner: "note.auto", argsSchemaKey: "noteAuto", helpTopic: "note" },
  { key: "note maybe", command: "note", subcommand: "maybe", action: "note.maybe", runner: "note.maybe", argsSchemaKey: "noteAuto", helpTopic: "note" },
  { key: "project radar", command: "project", subcommand: "radar", action: "project.radar", runner: "project.radar", argsSchemaKey: "projectRadar", helpTopic: "project" },
  { key: "review nightly", command: "review", subcommand: "nightly", action: "review.nightly", runner: "review.command", argsSchemaKey: "review", helpTopic: "review", kind: "nightly" },
  { key: "review weekly", command: "review", subcommand: "weekly", action: "review.weekly", runner: "review.command", argsSchemaKey: "review", helpTopic: "review", kind: "weekly" },
  { key: "review monthly", command: "review", subcommand: "monthly", action: "review.monthly", runner: "review.command", argsSchemaKey: "review", helpTopic: "review", kind: "monthly" },
  { key: "reminder write", command: "reminder", subcommand: "write", action: "reminder.create", runner: "reminder.write", argsSchemaKey: "reminderWrite", helpTopic: "reminder" },
  { key: "diary write", command: "diary", subcommand: "write", action: "diary.append", runner: "diary.write", argsSchemaKey: "diaryWrite", helpTopic: "diary" },
  { key: "system send", command: "system", subcommand: "send", action: "system.send", runner: "system.send", argsSchemaKey: "systemSend", helpTopic: "system" },
  { key: "system checkin-poller", command: "system", subcommand: "checkin-poller", action: "system.checkin_poller", runner: "system.checkin-poller", argsSchemaKey: "", helpTopic: "system" },
  { key: "timeline event", command: "timeline", subcommand: "event", action: "timeline.event", runner: "timeline.event", argsSchemaKey: "timelineEvent", helpTopic: "timeline" },
  { key: "timeline write", command: "timeline", subcommand: "write", action: "timeline.write", runner: "timeline.subcommand", argsSchemaKey: "", helpTopic: "timeline", timelineSubcommand: "write" },
  { key: "timeline read", command: "timeline", subcommand: "read", action: "timeline.read", runner: "timeline.subcommand", argsSchemaKey: "", helpTopic: "timeline", timelineSubcommand: "read" },
  { key: "timeline categories", command: "timeline", subcommand: "categories", action: "timeline.categories", runner: "timeline.subcommand", argsSchemaKey: "", helpTopic: "timeline", timelineSubcommand: "categories" },
  { key: "timeline proposals", command: "timeline", subcommand: "proposals", action: "timeline.proposals", runner: "timeline.subcommand", argsSchemaKey: "", helpTopic: "timeline", timelineSubcommand: "proposals" },
  { key: "timeline build", command: "timeline", subcommand: "build", action: "timeline.build", runner: "timeline.subcommand", argsSchemaKey: "", helpTopic: "timeline", timelineSubcommand: "build" },
  { key: "timeline serve", command: "timeline", subcommand: "serve", action: "timeline.serve", runner: "timeline.subcommand", argsSchemaKey: "", helpTopic: "timeline", timelineSubcommand: "serve" },
  { key: "timeline dev", command: "timeline", subcommand: "dev", action: "timeline.dev", runner: "timeline.subcommand", argsSchemaKey: "", helpTopic: "timeline", timelineSubcommand: "dev" },
  { key: "timeline screenshot", command: "timeline", subcommand: "screenshot", action: "timeline.screenshot", runner: "timeline.screenshot", argsSchemaKey: "timelineScreenshot", helpTopic: "timeline", timelineSubcommand: "screenshot" },
]);

const TERMINAL_COMMAND_MANIFEST_BY_KEY = new Map(
  TERMINAL_COMMAND_MANIFEST.map((entry) => [entry.key, entry])
);

function listCommandGroups() {
  return COMMAND_GROUPS.map((group) => ({
    ...group,
    actions: group.actions.map((action) => ({ ...action })),
  }));
}

function listTerminalCommandManifest() {
  return TERMINAL_COMMAND_MANIFEST.map((entry) => ({ ...entry }));
}

function findTerminalCommandManifest(command, subcommand = "") {
  const key = [normalizeText(command), normalizeText(subcommand)].filter(Boolean).join(" ");
  const entry = TERMINAL_COMMAND_MANIFEST_BY_KEY.get(key);
  return entry ? { ...entry } : null;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

module.exports = {
  findTerminalCommandManifest,
  listCommandGroups,
  listTerminalCommandManifest,
};
