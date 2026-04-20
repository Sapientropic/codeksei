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
import {
  CHECKIN_COMPLETION_CONTEXT_GUIDANCE,
  CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER,
} from "../checkin/completion-guidance";

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
  companion: () => ({
    usage: [buildExample("companion.remember", true)],
    bodyLabel: "补充：",
    body: [
      "  这是 ongoing companion memory 的统一写入口，不是另一套 profile store。",
      "  它只把高价值、会影响未来陪伴判断的事实写进 companion note，再由 context board 投影给宿主消费。",
      "  安全 over-call 是允许的：如果这一轮没有足够稳定的新事实，命令会返回 noop 或 deferred，而不是强行落盘。",
    ],
  }),
  context: () => ({
    usage: [buildExample("context.briefing", true)],
    bodyLabel: "补充：",
    body: [
      "  这条命令会先刷新本地 context board，再输出一份 prompt-ready handoff。",
      "  board 默认落在 CODEKSEI_STATE_DIR/context/boards/ 下，按 sender + workspace 分目标维护。",
      "  proactive 更偏主动判断；review 更偏复盘 framing 与重入提示。",
    ],
  }),
  proactive: () => ({
    usage: [
      buildExample("proactive.observe", true),
      buildExample("proactive.eval", true),
    ],
    bodyLabel: "补充：",
    body: [
      "  observation layer 只做本地语义观察，不接管 schedule truth，也不自动写 companion memory。",
      "  observe 默认会写入 latest observation 并刷新 context board；--show 只读当前 latest 状态，不触发模型调用。",
      "  eval 只读 fixture，用来比较小模型观察与 deterministic decision 的行为差异。",
    ],
  }),
  onboarding: () => ({
    usage: [
      buildExample("onboarding.start", true),
      buildExample("onboarding.step", true),
      buildExample("onboarding.status", true),
      buildExample("onboarding.reset", true),
    ],
    bodyLabel: "补充：",
    body: [
      "  这是面向激活即访谈的本地流程入口，不是问卷生成器。",
      "  start 负责开场；step 吸收一轮用户回复并回写 companion note；status 看覆盖；reset 只清流程状态。",
      "  用户真正的长期画像继续留在 companion note，由 context board 投影给宿主消费。",
    ],
  }),
  reminder: () => ({
    usage: [buildExample("reminder.create", true)],
    bodyLabel: "补充：",
    body: [
      `  先用 ${buildTerminalEntryUsage("app.accounts", "public")} 看可用 sender id；不要填昵称或自己猜的微信号`,
      "  当前选中的 sender id 必须已经有可用的 context_token；否则命令会直接失败",
      "  这条命令只负责创建提醒，不再兼做 proactive 调度入口。",
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
      `${buildTerminalActionExample("system.checkin_config", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("system.checkin_trigger", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("system.checkin_tick", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("system.checkin_complete", { audience: "public", includeArgs: true })}`,
    ],
  }),
  host: () => ({
    usage: [
      `${buildTerminalEntryUsage("host.manifest", "public")} / ${buildTerminalActionExample("host.bootstrap", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("host.doctor", { audience: "public", includeArgs: true })}`,
      `${buildTerminalActionExample("host.smoke", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("host.seed_proactive", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("host.claim_checkin", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("host.settle_checkin", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("host.finalize_checkin", { audience: "public", includeArgs: true })} / ${buildTerminalActionExample("host.render", { audience: "public", includeArgs: true })}`,
    ],
    bodyLabel: "补充：",
    body: [
      "  host 是面向外部宿主的机器入口，不是仓内 TypeScript seam。",
      "  host manifest 输出默认 Hosted Mode / Hermes 机器合同；当前环境与当前 canonical config 的真实状态统一看 host doctor。",
      "  daemon-first / host-attachable 仍是 runtime invariant；public host 命令默认走 Hermes recipe，generic-shell 继续支持但需要显式指定。",
      "  对 Hermes 这类宿主，优先用 host seed/claim/settle；hosted proactive 不再通过 reminder flag 或 operator glue 侧门收口。",
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
      `  timeline 截图只生成本地文件；需要回传当前聊天时，再配合 ${buildTerminalActionExample("channel.send_file", { audience: "public", includeArgs: true })}`,
    ],
  }),
  frame: () => ({
    usage: [
      `${buildTerminalEntryUsage("frame.build", "public")} / ${buildTerminalEntryUsage("frame.serve", "public")} / ${buildTerminalEntryUsage("frame.dev", "public")}`,
    ],
    bodyLabel: "补充：",
    body: [
      "  Frame 是平板常驻的本地 Web 前台，默认读取 /frame/state，并把输入写回 Codeksei。",
      "  mock 样张只在页面 URL 显式带 ?mode=mock 时启用；默认运行态不使用假数据。",
      "  V0 先用轮询和薄 HTTP API，不引入第二套长期状态。",
    ],
  }),
  project: () => ({
    usage: [buildExample("project.radar", true)],
    bodyLabel: "补充：",
    body: [
      "  默认优先从当前 workspace 的 .codeksei/code-projects.json 读取；旧的 .codex/code-projects.json 仍保留兼容回退",
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
  "host.manifest": () => ({
    usage: [buildTerminalActionExample("host.manifest", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  输出默认 Hosted Mode / Hermes 的 host attachment manifest / hostkit 机器入口。",
      "  这条命令描述推荐给新宿主的默认 attach contract、recipes、entrypoints 与安装方式，不再负责表达当前机器的 live 环境真相。",
      "  若要看当前 workspace / 当前 config 实际解析到了什么 provider/profile，统一改用 host doctor。",
    ],
    includeFlagBlock: true,
  }),
  "host.bootstrap": () => ({
    usage: [buildTerminalActionExample("host.bootstrap", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  写入 canonical codeksei.config.json，并按 provider 走最小 bootstrap。",
      "  public host bootstrap 默认 provider=hermes；只有显式传 --provider generic-shell，或已有 canonical config 已锁定 provider 时，才会走 generic-shell。",
      "  Hermes provider 当前会通过兼容路径同步 companion skill；daemon-first readiness 已是 bootstrap 的默认语义，不再通过额外 flag 分叉。",
    ],
    includeFlagBlock: true,
  }),
  "host.doctor": () => ({
    usage: [buildTerminalActionExample("host.doctor", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  统一查看当前环境 / 当前 canonical config 下的 daemon、attachment 与 provider recipe readiness。",
      "  这条命令才是 host 当前环境真相层；provider=hermes 时会收口 repo-local、skill、semantic review 与 smoke readiness，而不是只给一个 provider-specific 侧视图。",
    ],
    includeFlagBlock: true,
  }),
  "host.smoke": () => ({
    usage: [buildTerminalActionExample("host.smoke", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  执行 provider recipe 的最小 attach smoke。",
      "  当前重点 recipe 是 Hermes；generic-shell 暂时只返回无需额外 smoke 的薄壳结果。",
    ],
    includeFlagBlock: true,
  }),
  "host.seed_proactive": () => ({
    usage: [buildTerminalActionExample("host.seed_proactive", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  安装后为 delegated proactive checkin 种下或修复第一条 future wake。",
      "  public host 命令默认 provider=hermes；只有显式传 --provider generic-shell，或已有 canonical config 已锁定 provider 时，才会改走 generic-shell。",
      "  这条命令不会改写 scheduler 真相，只会在当前 truth 上补第一条可执行 wake/recovery/guard attach。",
    ],
    includeFlagBlock: true,
  }),
  "host.claim_checkin": () => ({
    usage: [buildTerminalActionExample("host.claim_checkin", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  原子完成 tick + claim + ack + recovery re-arm。",
      "  public host 命令默认 provider=hermes；generic-shell 只保留给显式 opt-in 的 attach 方案。",
      "  status=claimed 时返回 lease + payload；status=idle / in_progress 时不会伪造新 lease。",
    ],
    includeFlagBlock: true,
  }),
  "host.settle_checkin": () => ({
    usage: [buildTerminalActionExample("host.settle_checkin", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  回写 delegated proactive checkin 的完成结果；传 --create-handoff 时只记录子 agent 观察结果，不直接 finalize。",
      "  public host 命令默认 provider=hermes；generic-shell 只保留给显式 opt-in 的 attach 方案。",
      "  result=failed 只会返回 partial 并保留 daemon recovery；不会偷偷扩写内部 completion enum。",
    ],
    includeFlagBlock: true,
  }),
  "host.finalize_checkin": () => ({
    usage: [buildTerminalActionExample("host.finalize_checkin", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  由主会话消费 pending proactive handoff，并写回最终 completion 与下一次唤醒。",
      "  若省略 --result，会沿用 handoff 自带的 sent_message|silent|backstage_only。",
      "  public host 命令默认 provider=hermes；generic-shell 只保留给显式 opt-in 的 attach 方案。",
    ],
    includeFlagBlock: true,
  }),
  "host.render": () => ({
    usage: [buildTerminalActionExample("host.render", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  从 command truth 渲染 provider-facing host asset。",
      "  当前第一条 renderer 固定是 Hermes companion skill；--validate 会在渲染内容与仓内模板不一致时返回 partial。",
    ],
    includeFlagBlock: true,
  }),
  "proactive.observe": () => ({
    usage: [buildTerminalActionExample("proactive.observe", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  生成或查看本地小模型 proactive observation。",
      "  --dry-run 会调用观察层但不写 observation store；--show 只显示 latest observation、sourceHash、expired 与 usable 状态。",
      "  命令输出格式继续走全局 --format json|text，不提供局部 --json。",
    ],
    includeFlagBlock: true,
  }),
  "proactive.eval": () => ({
    usage: [buildTerminalActionExample("proactive.eval", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  只读评测 proactive observation fixture，不写本地 state。",
      "  如果本地 endpoint 不兼容或模型失败，case 会记录 fallback reason，而不会影响主链路。",
    ],
    includeFlagBlock: true,
  }),
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
      "  查看 Hermes 命令、repo-local sibling checkout、Weixin 账号、skill 同步状态、skills catalog 和 hosted semantic review 可用性。",
      "  若能解析当前唯一 target，还会附带当前 target 的托管 checkin wake/recovery/guard one-shot job 摘要。",
      "  这是只读检查，不会修改本机 Hermes 状态。",
    ],
    examples: [
      "  codeksei operator hermes status",
      "  codeksei operator hermes status --user wxid_xxx --workspace /absolute/workspace",
    ],
    includeFlagBlock: true,
  }),
  "operator.hermes.smoke": () => ({
    usage: [buildTerminalEntryUsage("operator.hermes.smoke", "public")],
    bodyLabel: "说明：",
    body: [
      "  做 hosted 前置检查与 skill parity / repo-local 检查，不伪造 live Weixin 成功。",
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
      "  Hermes hosted mode 下会额外检查 hermes 命令、repo-local sibling checkout / shim、仓内 skill 资产是否已同步、本机 Hermes Weixin 配置痕迹，以及 hosted semantic review 可用性。",
      "  非 TTY 下默认走 JSON envelope；TTY 下默认走文本。",
    ],
  }),
  "channel.send_file": () => ({
    usage: [buildExample("channel.send_file", true)],
    bodyLabel: "说明：",
    body: [
      "  将本地文件作为附件发回当前微信聊天。",
      "  Codex Mode 下默认会解析当前唯一稳定 sender；若目标不唯一，会直接返回 target_resolution_required。",
      "  Hosted Mode 下会通过 repo-local shim + 当前 Hermes session 把文件发回 origin chat，不再依赖 Codeksei 自己的 first-party channel adapter。",
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
  "context.briefing": () => ({
    usage: [buildExample("context.briefing", true)],
    bodyLabel: "说明：",
    body: [
      "  读取并刷新当前 sender/workspace 对应的 context board，再输出一份 prompt-ready handoff。",
      "  board 只读受控输入集：today diary、companion note、checkin state、project radar、workspace bootstrap 入口。",
      "  若看到 [⚠️ 需确认]，表示这块上下文偏薄或偏旧，不应被当作确定事实。",
    ],
    examples: [
      "  codeksei context briefing --user <wechatUserId> --workspace /absolute/workspace",
      "  codeksei context briefing --user <wechatUserId> --workspace /absolute/workspace --mode review",
    ],
    includeFlagBlock: true,
  }),
  "onboarding.start": () => ({
    usage: [buildExample("onboarding.start", true)],
    bodyLabel: "说明：",
    body: [
      "  开始一轮聊天式激活访谈，返回第一句适合直接对用户说的话。",
      "  它不会吐出问卷模板；真正的长期画像会落到 companion note，再由 context board 投影给宿主。",
      "  如果当前已经有进行中的 onboarding，会返回续聊提示而不是静默重开一轮。",
    ],
    examples: [
      "  codeksei onboarding start --user <wechatUserId>",
    ],
    includeFlagBlock: true,
  }),
  "onboarding.step": () => ({
    usage: [buildExample("onboarding.step", true)],
    bodyLabel: "说明：",
    body: [
      "  吸收用户最新一轮回复，提取最小画像事实，回写 companion note，并返回下一句适合直接说的话。",
      "  这条命令偏自然聊天，不会输出 slot 名或问卷编号给用户看。",
      "  长期真相继续只写 companion note；流程状态只写 onboarding state。step 也可用于后续轻量纠正。 ",
    ],
    examples: [
      "  @'\n我下午两点以后比较能动，晚上别来追我太紧。\n'@ | codeksei onboarding step --user <wechatUserId> --session <sessionId> --stdin",
    ],
    includeFlagBlock: true,
  }),
  "onboarding.status": () => ({
    usage: [buildExample("onboarding.status", true)],
    bodyLabel: "说明：",
    body: [
      "  查看当前 onboarding 的流程状态、sessionId、缺口和轮次。",
      "  这条命令只读，不会改长期 companion note。",
    ],
    examples: [
      "  codeksei onboarding status --user <wechatUserId>",
    ],
    includeFlagBlock: true,
  }),
  "onboarding.reset": () => ({
    usage: [buildExample("onboarding.reset", true)],
    bodyLabel: "说明：",
    body: [
      "  只重置 onboarding 流程状态，不清空已经形成的 companion note。",
      "  更适合内测和调试，不是默认用户路径。",
    ],
    examples: [
      "  codeksei onboarding reset --user <wechatUserId>",
    ],
    includeFlagBlock: true,
  }),
  "companion.remember": () => ({
    usage: [buildExample("companion.remember", true)],
    bodyLabel: "说明：",
    body: [
      "  把会影响未来支持方式、边界、节奏、当前定位或近期重入点的新事实提炼进 companion memory。",
      "  这条命令不负责生成对用户的回复，只负责 backstage 提炼、写回 companion note，并在需要时刷新 context board。",
      "  宿主可以安全 over-call：普通寒暄或低信号输入会得到 noop / deferred，而不是强行写成长期真相。",
    ],
    examples: [
      "  @'\n我下午两点后更能动，晚上别催太紧。\n'@ | codeksei companion remember --user <wechatUserId> --workspace /absolute/workspace --source host_user_turn --stdin",
      "  codeksei companion remember --user <wechatUserId> --workspace /absolute/workspace --source review_summary --text \"这周反复卡在切换成本太高，下一步先把重入入口做得更轻。\"",
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
        "  默认优先从当前 workspace 的 .codeksei/code-projects.json 读取；旧的 .codex/code-projects.json 仍保留兼容回退。",
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
      "  Codex Mode 下会创建提醒并放入本地 reminder queue。",
      "  Codex Mode 仍会解析唯一稳定 sender，并检查对应 context_token；缺失时直接报 auth_required。",
      "  Hosted Mode 下会改走 repo-local Hermes cron，并把 deliver 绑定到当前 origin chat。",
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
  "system.checkin_config": () => ({
    usage: [buildTerminalActionExample("system.checkin_config", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  查看或修改 check-in fallback window；它只在 agent 没写回下一次唤醒、状态损坏或 guardrail recovery 时生效。",
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
      "  适合给 Hermes one-shot wake job 消费；它不是本地 bridge-only 入口。",
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
      "  传 --ack <triggerId> 只表示“宿主已经消费并启动这轮 proactive pass”；真正的下一次唤醒要靠 checkin-complete 回写。",
    ],
    examples: [
      "  codeksei system checkin-tick --user wxid_xxx --workspace /absolute/workspace",
      "  codeksei system checkin-tick --user wxid_xxx --workspace /absolute/workspace --ack <triggerId>",
    ],
    includeFlagBlock: true,
  }),
  "system.checkin_complete": () => ({
    usage: [buildTerminalActionExample("system.checkin_complete", { audience: "public", includeArgs: true })],
    bodyLabel: "说明：",
    body: [
      "  记录这轮 proactive check-in 的完成结果，并由 agent 显式写回下一次唤醒时间。",
      "  --trigger / --result 必填；--next-wake-at 与 --sleep-for 二选一。",
      `  ${CHECKIN_COMPLETION_CONTEXT_GUIDANCE}`,
      "  agent 给出过长时间会被 clamp 到 24h guardrail；缺失或无效时间会回退 fallback window。",
      "  Hosted Mode 下，写回 state 后还会自动把下一组 wake/recovery/guard jobs 重新 arm 给 Hermes，并清理多余的未来 job。",
    ],
    examples: [
      `  codeksei system checkin-complete --user wxid_xxx --workspace /absolute/workspace --trigger <triggerId> --result silent --sleep-for ${CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER}`,
      "  codeksei system checkin-complete --user wxid_xxx --workspace /absolute/workspace --trigger <triggerId> --result sent_message --next-wake-at 2026-04-15T09:00:00+08:00",
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
  "frame.build": () => buildFrameLeafHelpDocument("frame.build"),
  "frame.serve": () => buildFrameLeafHelpDocument("frame.serve"),
  "frame.dev": () => buildFrameLeafHelpDocument("frame.dev"),
  "timeline.screenshot": () => ({
    usage: [buildExample("timeline.screenshot", true)],
    bodyLabel: "说明：",
    body: [
      "  主语义是本地截图：先构建 dashboard，再把图片保存到本机输出路径。",
      `  需要回传当前聊天时，先运行这条命令生成图片，再配合 ${buildTerminalActionExample("channel.send_file", { audience: "public", includeArgs: true })}。`,
      "  泛泛地说“截个图”时，默认就是整页；只有明确说时间轴/分析区/事件列表这类局部区域时，才额外传 --selector。",
    ],
    examples: [
      "  codeksei timeline screenshot",
      "  codeksei timeline screenshot --selector timeline",
    ],
    includeFlagBlock: true,
  }),
} satisfies Record<CommandLeafHelpKey, CommandHelpBuilder>;

function buildHermesOperatorResourceHelpText(): string {
  return renderHelpDocument({
    usage: ["codeksei operator hermes <install-skill|status|smoke>"],
    bodyLabel: "说明：",
    body: [
      "  这是 Hosted Mode / Hermes recipe 的 operator resource。",
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

function buildFrameLeafHelpDocument(
  actionId: "frame.build" | "frame.serve" | "frame.dev",
): CommandHelpDocument {
  const variant = {
    "frame.build": {
      usage: buildTerminalActionExample("frame.build", { audience: "public", includeArgs: true }),
      body: [
        "  把当前 Frame 静态前台复制到本地 stateDir/frame/site，并同步人物等静态资产。",
        "  这条命令不启动服务，也不写入 diary / reminder / check-in 状态。",
      ],
      examples: [
        "  codeksei frame build",
      ],
    },
    "frame.serve": {
      usage: buildTerminalActionExample("frame.serve", { audience: "public", includeArgs: true }),
      body: [
        "  构建并启动 Frame 本地 HTTP 服务；页面入口是 /frame，状态投影是 /frame/state。",
        "  写入动作通过 /frame/input 与 /frame/diary/quick 回到 Codeksei，失败时页面不会清空输入。",
      ],
      examples: [
        "  codeksei frame serve",
        "  codeksei frame serve --port 4327",
      ],
    },
    "frame.dev": {
      usage: buildTerminalActionExample("frame.dev", { audience: "public", includeArgs: true }),
      body: [
        "  启动 Frame 开发服务。V0 与 serve 使用同一条薄服务链路，后续可再加 hot reload。",
        "  页面 URL 带 ?mode=mock 时会显示设计样张；默认读取真实 /frame/state。",
      ],
      examples: [
        "  codeksei frame dev",
        "  codeksei frame dev --port 4327",
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
