import { normalizeText } from "./text-normalization";
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
import { listGlobalCliFlags } from "../core/cli-contract";

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
    usage: [
      `${buildExample("system.send", true)} / ${buildTerminalActionExample("system.checkin_config", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("system.checkin_trigger", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("system.checkin_tick", { audience: "public", includeArgs: true })} / ${buildTerminalEntryUsage("system.checkin_poller", "public")}`,
    ],
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
      "  本地 git 仍是第一真相；只有 git unavailable 时才回退到 GitHub activity continuity signal",
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
      "  默认走 hybrid：脚本保骨架，runtime 语义生成器负责结构化提炼；失败时自动回退 deterministic",
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
  "operator.hermes.install_skill": () => ({
    usage: [buildTerminalActionExample("operator.hermes.install_skill", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  把仓内 codeksei-companion skill 同步到当前 Hermes home 的 ~/.hermes/skills/ 目录。",
      "  支持 --dry-run 预览目标路径、是否覆盖、是否会生成备份，而不实际写文件。",
      "  当已安装 skill 内容与仓内 asset 不一致时，会先写一份带时间戳的 backup 再覆盖。",
    ],
    examples: [
      "  codeksei operator hermes install-skill --dry-run",
      "  codeksei operator hermes install-skill",
    ],
    includeFlagBlock: true,
  }),
  "operator.hermes.status": () => ({
    usage: [buildTerminalEntryUsage("operator.hermes.status", "public")],
    bodyLabel: "说明：",
    body: [
      "  查看 Hermes 命令、Weixin 账号、skill 同步状态、skills catalog 和 hosted semantic review 可用性。",
      "  这是只读检查，不会修改本机 Hermes 状态。",
    ],
    examples: [
      "  codeksei operator hermes status",
    ],
    includeFlagBlock: true,
  }),
  "operator.hermes.smoke": () => ({
    usage: [buildTerminalEntryUsage("operator.hermes.smoke", "public")],
    bodyLabel: "说明：",
    body: [
      "  做 hosted 前置检查与 skill parity 检查，不伪造 live Weixin 成功。",
      "  这是 assisted smoke：只验证本地准备度与宿主边界，不接管 Hermes gateway 的真实消息流。",
    ],
    examples: [
      "  codeksei operator hermes smoke",
    ],
    includeFlagBlock: true,
  }),
  "app.doctor": () => ({
    usage: [buildTerminalActionExample("app.doctor", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  输出当前 public CLI 相关的运行时快照，包括 host mode、runtime/channel provider、timeline 描述与 thread state 摘要。",
      "  Hermes hosted mode 下会额外检查 hermes 命令、仓内 skill 资产是否已同步、本机 Hermes Weixin 配置痕迹，以及 hosted semantic review 可用性。",
      "  非 TTY 下默认走 JSON envelope；TTY 下默认走文本。",
    ],
  }),
  "channel.send_file": () => ({
    usage: [buildExample("channel.send_file", true)],
    bodyLabel: "说明：",
    body: [
      "  将本地文件作为附件发回当前微信聊天。",
      "  默认会解析当前唯一稳定 sender；若目标不唯一，会直接返回 target_resolution_required。",
    ],
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
        "  本地 git 正常时仍以 branch / dirty / recent commits 为主；GitHub activity 只在 git unavailable 时作为 fallback。",
        "  GitHub fallback 不伪装成本地 working tree 真相。",
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
  "reminder.create": () => ({
    usage: [buildExample("reminder.create", true)],
    bodyLabel: "说明：",
    body: [
      "  创建提醒并放入本地 reminder queue。",
      "  默认会解析唯一稳定 sender，并检查对应 context_token；缺失时直接报 auth_required。",
    ],
    examples: [
      "  codeksei reminder write --delay 30m --text \"起身喝水\"",
      "  codeksei reminder write --at 2026-04-07 21:30 --text \"收今晚的日记\"",
    ],
    includeFlagBlock: true,
  }),
  "diary.append": () => ({
    usage: [buildExample("diary.append", true)],
    bodyLabel: "说明：",
    body: [
      "  追加一条日记记录。",
      "  todo done 若省略 --timeline-text，会优先复用同一 Todo 捕获的开始时间补出时间块；只有找不到开始时间时才退回单点事实。",
    ],
    examples: [
      "  codeksei diary write --section todo --state open --text \"继续收口 codeksei CLI plan\"",
      "  codeksei diary write --section supplement --title \"CLI contract\" --text \"统一 stdout/stderr/exit code 约束。\"",
    ],
    includeFlagBlock: true,
  }),
  "system.send": () => ({
    usage: [buildExample("system.send", true)],
    bodyLabel: "说明：",
    body: [
      "  向内部 system queue 写一条不可见触发消息。",
      "  --workspace 和 --user 可以显式传；没传时只会接受唯一稳定默认值，否则直接报 target_resolution_required。",
    ],
    examples: [
      "  codeksei system send --text \"提醒她今天早点睡\" --workspace \"$(pwd)\"",
    ],
    includeFlagBlock: true,
  }),
  "system.checkin_config": () => ({
    usage: [buildTerminalActionExample("system.checkin_config", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  查看或修改主动 check-in 的随机分钟区间。",
      "  持久化配置优先于 CODEKSEI_CHECKIN_MIN_INTERVAL_MS / MAX_INTERVAL_MS；--reset 会清除本地覆盖。",
    ],
    examples: [
      "  codeksei system checkin --show",
      "  codeksei system checkin --range 3-60",
      "  codeksei system checkin --reset",
    ],
    includeFlagBlock: true,
  }),
  "system.checkin_trigger": () => ({
    usage: [buildTerminalActionExample("system.checkin_trigger", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  只生成一条 host-neutral check-in trigger payload，不写本地 system queue。",
      "  适合给 Hermes heartbeat / automation 这类宿主消费；它不是本地 bridge-only 入口。",
      "  默认优先用显式 --user / --workspace；其次才吃唯一稳定默认值与可用 session hints。",
    ],
    examples: [
      "  codeksei system checkin-trigger --user wxid_xxx --workspace /absolute/workspace",
    ],
    includeFlagBlock: true,
  }),
  "system.checkin_tick": () => ({
    usage: [buildTerminalActionExample("system.checkin_tick", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  轮询 host-neutral check-in 调度状态；到点时返回稳定 trigger id 与 payload。",
      "  pending trigger 未 ack 前，重复 poll 会返回同一个 trigger。",
      "  传 --ack <triggerId> 只确认当前 pending trigger，并推进下一次随机调度。",
    ],
    examples: [
      "  codeksei system checkin-tick --user wxid_xxx --workspace /absolute/workspace",
      "  codeksei system checkin-tick --user wxid_xxx --workspace /absolute/workspace --ack <triggerId>",
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
  "timeline.write": () => ({
    usage: [buildTerminalActionExample("timeline.write", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  按批量或原始 JSON 写入 timeline day payload。",
      "  建议先用 timeline read / categories 确认目标日期与分类，再决定 merge 或 replace。",
      "  --json 与 --stdin 都要求传完整 JSON 对象，不接受裸数组。",
    ],
    examples: [
      "  codeksei timeline write --date 2026-04-05 --json '{\"events\":[...]}'",
      "  cat payload.json | codeksei timeline write --date 2026-04-05 --stdin",
    ],
    includeFlagBlock: true,
  }),
  "timeline.read": () => ({
    usage: [buildTerminalActionExample("timeline.read", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  读取某一天当前已有的时间轴事件。",
      "  只返回受控的 day payload 摘要，不回传完整原始 state。修改前先 read 是默认建议路径。",
    ],
    examples: [
      "  codeksei timeline read --date 2026-04-05",
    ],
    includeFlagBlock: true,
  }),
  "timeline.categories": () => ({
    usage: [buildTerminalEntryUsage("timeline.categories", "public")],
    bodyLabel: "说明：",
    body: [
      "  读取当前可用的 category / subcategory / eventNode 摘要。",
      "  不确定该复用哪个分类时，先看 categories，再决定 event 或 write 的 payload。",
    ],
    includeFlagBlock: true,
  }),
  "timeline.proposals": () => ({
    usage: [buildTerminalActionExample("timeline.proposals", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  查看 timeline 写入过程中累计出来的 eventNode proposals。",
      "  可用 --date 缩到单日，方便排查某天新增了哪些候选节点。",
    ],
    examples: [
      "  codeksei timeline proposals",
      "  codeksei timeline proposals --date 2026-04-05",
    ],
    includeFlagBlock: true,
  }),
  "timeline.build": () => buildTimelineLeafHelpDocument("timeline.build"),
  "timeline.serve": () => buildTimelineLeafHelpDocument("timeline.serve"),
  "timeline.dev": () => buildTimelineLeafHelpDocument("timeline.dev"),
  "timeline.screenshot": () => ({
    usage: [buildExample("timeline.screenshot", true)],
    bodyLabel: "说明：",
    body: [
      "  这条命令只负责把截图任务排进本地队列，真正截图和发送由正在运行的微信 bridge 异步执行。",
      "  queued 不等于“已经发到微信”；只有 bridge 真正送达后，用户那边才会看到图片或文件。",
      "  泛泛地说“截个图”时，默认就是整页；只有明确说时间轴/分析区/事件列表这类局部区域时，才额外传 --selector。",
    ],
    examples: [
      "  codeksei timeline screenshot --send",
      "  codeksei timeline screenshot --send --selector timeline",
    ],
    includeFlagBlock: true,
  }),
} satisfies Record<CommandLeafHelpKey, CommandHelpBuilder>;

function buildHermesOperatorResourceHelpText(): string {
  return renderHelpDocument({
    usage: ["codeksei operator hermes <install-skill|status|smoke>"],
    bodyLabel: "说明：",
    body: [
      "  这是 Hermes Hosted Mode 的 operator resource。",
      "  install-skill：同步仓内 companion skill；支持 --dry-run 预览。",
      "  status：只读查看 Hermes hosted 集成状态。",
      "  smoke：只读执行 hosted parity 前置检查。",
    ],
    examples: [
      "  codeksei operator hermes install-skill --dry-run",
      "  codeksei operator hermes status",
      "  codeksei operator hermes smoke",
    ],
  }, "");
}

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
        "  默认走 hybrid：脚本保骨架，runtime 语义生成器负责结构化提炼；失败时自动回退。",
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
        "  默认走 hybrid：脚本保骨架，runtime 语义生成器负责结构化提炼；失败时自动回退。",
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
        "  默认走 hybrid：脚本保骨架，runtime 语义生成器负责结构化提炼；失败时自动回退。",
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

function buildTimelineLeafHelpDocument(
  actionId: "timeline.build" | "timeline.serve" | "timeline.dev",
): CommandHelpDocument {
  const variant = {
    "timeline.build": {
      usage: buildTerminalActionExample("timeline.build", { audience: "public", includeArgs: true }),
      body: [
        "  把当前 timeline 数据构建成静态 dashboard 产物，适合写入数据后刷新页面或在发布前先验一次构建链路。",
        "  这条命令本身不要求 Chromium/Chrome/Edge；浏览器可执行文件只在 screenshot 链路里才需要。",
        "  `CODEKSEI_TIMELINE_LOCALE=en|zh-CN` 可切换 dashboard 文案、日期格式和 demo data 语言。",
        "  运行前提仍是 Node.js >= 22，以及当前 timeline 状态目录可写。",
      ],
      examples: [
        "  codeksei timeline build",
      ],
    },
    "timeline.serve": {
      usage: buildTerminalActionExample("timeline.serve", { audience: "public", includeArgs: true }),
      body: [
        "  启动已经构建好的 timeline 静态页面服务，适合稳定查看，不做源码或数据监听。",
        "  `--port` 可显式指定本地端口；没传时默认沿用当前 timeline runtime 端口。",
        "  `CODEKSEI_TIMELINE_LOCALE=en|zh-CN` 可切换 dashboard 文案、日期格式和 demo data 语言。",
        "  这条命令不要求 Chromium/Chrome/Edge，可在 Windows / macOS / Linux 上直接起本地 URL 给浏览器打开。",
      ],
      examples: [
        "  codeksei timeline serve",
        "  codeksei timeline serve --port 4317",
      ],
    },
    "timeline.dev": {
      usage: buildTerminalActionExample("timeline.dev", { audience: "public", includeArgs: true }),
      body: [
        "  启动带自动重建和热刷新能力的 timeline 开发服务，适合调 dashboard、改数据后立刻看效果。",
        "  `--port` 可显式指定本地端口；native watch 命中配额或平台不支持递归 watch 时，会自动退到 polling。",
        "  `CODEKSEI_TIMELINE_LOCALE=en|zh-CN` 可切换 dashboard 文案、日期格式和 demo data 语言。",
        "  运行前提仍是 Node.js >= 22；浏览器可执行文件只在 screenshot 命令里才需要。",
      ],
      examples: [
        "  codeksei timeline dev",
        "  codeksei timeline dev --port 4317",
      ],
    },
  }[actionId];

  return {
    usage: [variant.usage],
    bodyLabel: "说明：",
    body: variant.body,
    examples: variant.examples,
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
  const globalFlags = listGlobalCliFlags();
  if (!flags.length && !globalFlags.length) {
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
  for (const flag of globalFlags) {
    const keys = Array.isArray(flag.keys) ? flag.keys.join(", ") : "";
    const suffix = flag.placeholder ? `  ${flag.placeholder}；${flag.description}` : `  ${flag.description}`;
    lines.push(`  ${keys}${suffix}`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export {
  buildHermesOperatorResourceHelpText,
  buildTerminalLeafHelpText,
  buildTerminalTopicHelpText,
  hasTerminalTopicHelp,
  listTerminalHelpTopics,
  listTerminalLeafHelpKeys,
};
