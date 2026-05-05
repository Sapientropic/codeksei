# Commands

这页汇总 `Codeksei` 当前对外可用的主要命令入口。

可把它当作一张入口地图：记录日常、补提醒、做复盘、重新进入项目时，都可以先从这里找到对应入口。

`Codeksei` 先定义稳定动作，再分别映射到终端和微信，让不同入口共享同一套行为语义。
这页只负责对外说明；真实 active command surface 以当前共享 help / manifest 为准，不再单独发明第二套命令语义。

## Host Modes

当前有三条官方路径：

- `Codex Mode`
  `provider=codex`：`runtime=codex` + `channelProvider=codeksei` + `channel=weixin`
- `Claude Code Mode`
  `provider=claudecode`：`runtime=claudecode` + `channelProvider=codeksei` + `channel=weixin`
- `Hosted Mode`
  `provider=hermes`：`runtime=hermes` + `channelProvider=hermes` + `channel=weixin`

边界：

- `Codex Mode` / `Claude Code Mode` 下，Codeksei 自己托管 bridge / shared 线程；`host bootstrap/doctor/smoke --provider codex|claudecode` 是一等公民路径
- `Hosted Mode` 下，宿主控制命令交给 Hermes；Codeksei 主要暴露 timeline / diary / reminder / review / note / project radar / doctor / schema，并提供 Hermes operator 入口做 skill/status/smoke
- `channel send-file`、`reminder write` 已接上 Hermes repo-local 路径；bridge-only backstage queue 仍是内部 owner，不再暴露 `system send` public CLI
- `Hosted Mode` 下，Hermes 只执行受控 wake/recovery/guard job set；Codeksei 继续持有 `tick -> ack -> complete` 的调度真相，对外默认通过 `host seed-proactive / claim-checkin / settle-checkin / finalize-checkin` 接入
- 外部宿主优先通过 `host attachment contract` 接入：`host manifest --provider codex|claudecode|hermes|generic-shell`、`host bootstrap`、`host doctor`、`host smoke`、`host seed-proactive`、`host claim-checkin`、`host settle-checkin`、`host finalize-checkin`

## 命名

对外统一只用新名字。

当前主入口：

- 包名：`codeksei`
- CLI：`codeksei`
- env 前缀：`CODEKSEI_*`

README、帮助文本和公开示例默认都按 `codeksei` 书写。

表层文案约定：

- 用户可见的 CLI / help / error / template / diary / review / context 文案默认中文，可用 `CODEKSEI_LOCALE=zh-CN|en` 或全局 `--locale zh-CN|en` 切换；非 TTY JSON envelope 字段名不本地化
- operator / maintainer diagnostics、shared status line 默认英文

## 终端主入口

首次使用时，先记住这一组主入口即可。

public CLI：

- `codeksei doctor`
- `codeksei help`
- `codeksei schema`
- `codeksei companion remember`
- `codeksei onboarding start`
- `codeksei onboarding status`
- `codeksei context briefing`
- `codeksei context inspect`
- `codeksei whereabouts serve`
- `codeksei whereabouts snapshot`
- `codeksei whereabouts recent-stays`
- `codeksei whereabouts recent-moves`
- `codeksei whereabouts summary`
- `codeksei capabilities status`
- `codeksei pulse today`
- `codeksei pulse generate`
- `codeksei pulse feedback`
- `codeksei host manifest`
- `codeksei host bootstrap`
- `codeksei host doctor`
- `codeksei host smoke`
- `codeksei host seed-proactive`
- `codeksei host claim-checkin`
- `codeksei host settle-checkin`
- `codeksei host finalize-checkin`
- `codeksei host render`
- `codeksei tool mcp-bootstrap`

operator / bootstrap：

- `codeksei operator help`
- `codeksei operator schema`
- `codeksei operator hermes install-skill`
- `codeksei operator hermes status`
- `codeksei operator hermes smoke`
- `codeksei login` `first-party bridge modes only`
  默认协议版本对齐腾讯官方包 `@tencent-weixin/openclaw-weixin@2.1.8`；海外 / 国际版 WeChat 扫码仍可能受官方地域灰度限制
- `codeksei accounts` `first-party bridge modes only`
- `codeksei start` `first-party bridge modes only`
- `codeksei tool mcp-server` `MCP stdio endpoint; normally launched by Claude Code`
- `codeksei system checkin-trigger`
- `codeksei system checkin-tick`
- `codeksei system checkin-complete`

仓库脚本 / shared 模式：

- `npm run shared:start` `first-party bridge modes only`
- `npm run shared:open` `Codex Mode only`
- `npm run shared:status`
- `npm run shared:watchdog` `first-party bridge modes only`
- `npm run background:install`
- `npm run background:uninstall`

主动 check-in 控制：

- `codeksei host seed-proactive --provider hermes --user <senderId> --workspace /absolute/workspace`
- `codeksei host claim-checkin --provider hermes --user <senderId> --workspace /absolute/workspace`
- `codeksei host settle-checkin --provider hermes --user <senderId> --workspace /absolute/workspace --lease <leaseId> --result silent --create-handoff --observed-state "..." --followup-context "..."`
- `codeksei host finalize-checkin --provider hermes --user <senderId> --workspace /absolute/workspace --lease <leaseId> --sleep-for <duration>`
- `codeksei system checkin --show`
- `codeksei system checkin --range 3-60`
- `codeksei system checkin --reset`
- `codeksei system checkin-trigger --user <senderId> --workspace /absolute/workspace`
- `codeksei system checkin-tick --user <senderId> --workspace /absolute/workspace`
- `codeksei system checkin-tick --user <senderId> --workspace /absolute/workspace --ack <triggerId>`
- `codeksei system checkin-complete --user <senderId> --workspace /absolute/workspace --trigger <triggerId> --result silent --sleep-for <duration>`
- `codeksei context briefing --user <senderId> --workspace /absolute/workspace --mode proactive`
- `codeksei context briefing --user <senderId> --workspace /absolute/workspace --mode review`
- `codeksei context inspect --user <senderId> --workspace /absolute/workspace --mode proactive`
- `codeksei whereabouts snapshot`
- `codeksei whereabouts summary`
- `codeksei pulse today --user <senderId> --workspace /absolute/workspace`

说明：

- `codeksei help` / `codeksei schema` 默认只暴露 public finite command surface
- `codeksei operator help` / `codeksei operator schema` 才会显示 bootstrap、shared、background、maintainer 入口
- `codeksei operator hermes --help` / `codeksei operator schema operator hermes` 会列出 Hosted Mode / Hermes recipe 的 3 个 leaf action
- `codeksei operator hermes install-skill` 是唯一会改本机 Hermes skill 状态的 leaf action；支持 `--dry-run`
- `Codeksei` 当前 hosted check-in 主链不再要求 Hermes upstream 先支持 cron `env`；若想把 Hermes 原生 cron `env` 能力也补上，可选补丁统一看 [`docs/hermes-cron-env-patch.md`](./hermes-cron-env-patch.md)
- 非 TTY 默认返回 JSON envelope；TTY 默认返回 text
- `stdout` 留给结果数据，`stderr` 留给诊断与 debug 信息
- 全局参数统一支持：`--format json|text`、`--locale zh-CN|en`、`--verbose`、`--workspace-root /absolute/path`
- 日常使用默认走共享模式，让微信入口和终端执行落在同一条线上
- `codeksei start` / `npm run start:checkin` 更适合 operator 调试，不再视作默认 public discovery 面
- 如果当前配置是 `Hosted Mode`，`codeksei start` 与 `shared:start` 会明确提示“改由 Hermes gateway 托管”，不会隐式回退到 Codex app-server
- `checkin-complete` 在 Hosted Mode 下会在写回 state 后自动 re-arm 下一组 wake/recovery/guard jobs，并清理多余的未来 job
- hosted wake/recovery/guard job 的 origin context 会持久化在 Hermes cron job 上；真正 cron 投递时直接读取 `job.origin`，不会再按 target 反查 live session
- hosted wake/recovery/guard job 会同时写入 Hermes cron `script`；每次 wake 前先由脚本执行 `host claim-checkin` 并读取最新 context board，再让 Hermes 子 agent 用这份 handoff context 执行一次观察式 proactive pass
- hosted wake/recovery/guard sync 现在会先确保目标 job 已成功存在，再 best-effort 清理旧 job；中途失败时不会先把最后一条 recovery/guard backstop 删掉
- `system checkin --range` 现在是 fallback window，不再代表 agent 的真实唤醒节奏

## Claude Code Tools MCP

这组入口只服务 Claude Code Mode 的显式 MCP 工具接入，不是运行 Claude Code Mode 的前置条件。

- `codeksei tool mcp-bootstrap --scope local --workspace-root /absolute/workspace`
  默认只打印 `claude mcp add` 命令和等价 JSON 配置，不修改 Claude 或 workspace 配置。
- `codeksei tool mcp-bootstrap --scope local --toolset companion --install --workspace-root /absolute/workspace`
  显式执行 `claude mcp add`，让 Claude Code 能调用 Codeksei context、timeline、diary、note、reminder 等工具。
- `codeksei tool mcp-bootstrap --scope project --install --allow-project-config --workspace-root /absolute/workspace`
  显式允许 project scope；这会写项目级 `.mcp.json`，因此必须多传 `--allow-project-config`。
- `codeksei tool mcp-server`
  MCP stdio server 入口，只由 Claude Code 或 MCP client 启动；stdout 只写 MCP 协议，诊断只写 stderr。

说明：

- 默认 toolset 是 `read`，只暴露 capabilities、context、project radar 和 timeline 只读工具。
- `--toolset companion` 会额外暴露 diary、note、reminder、timeline 写入工具。
- `--toolset delivery` 会额外暴露 timeline screenshot 和 channel send-file。
- Codeksei 不会自动生成或修改 workspace `.mcp.json`；project scope 必须显式 opt-in。
- Claude Code CLI 的 `claude mcp serve` 是把 Claude Code 暴露给其他 MCP client，不是 Codeksei Tools MCP server。

## Context Board

这一组入口把 Codeksei 的“主动性判断上下文层”暴露成稳定 CLI，而不是要求宿主或 agent 去盲扫原始 vault / repo。

- `codeksei context briefing --user <senderId> --workspace /absolute/workspace`
- `codeksei context briefing --user <senderId> --workspace /absolute/workspace --mode proactive`
- `codeksei context briefing --user <senderId> --workspace /absolute/workspace --mode review`
- `codeksei context inspect --user <senderId> --workspace /absolute/workspace --mode proactive`
- `codeksei context inspect --user <senderId> --workspace /absolute/workspace --text "本轮用户消息"`

说明：

- 默认输出当前 target 的 prompt-ready briefing；`--mode proactive|review` 用来调整 framing
- `context inspect` 在 briefing 之上解释本轮装配：layers、excluded、staleReasons、pendingHandoff、stateCard、redaction 与 contextPacks
- 文本输出默认脱敏本地路径和敏感 token；机器消费时用全局 `--format json`
- board 落在 `CODEKSEI_STATE_DIR/context/boards/<targetKey>.md`
- 来源固定为受控输入集：checkin state、当日日记、最近 companion note、proactive follow-up context、project radar、workspace continuity 入口
- 缺源时显式标 `[⚠️ 需确认]`，不会编造
- Hosted Mode 下的 proactive wake 会在 cron 运行前现读这份 board；原始 `AGENTS.md / Home.md / diary` 是输入源，不再是 cron prompt 的直接 surface
- context board 不会默认触发模型调用；小模型 observation 只能由 `proactive observe` 或 host claim-checkin 的 observation pass 显式生成

## Whereabouts

这一组入口负责本地位置语义层：手机或本机上报端把事件写进 `CODEKSEI_STATE_DIR/whereabouts/`，后续由 `context inspect`、Pulse 和主动判断层只消费粗粒度摘要。

- `codeksei whereabouts serve`
- `codeksei whereabouts serve --host 127.0.0.1 --port 4318`
- `codeksei whereabouts snapshot`
- `codeksei whereabouts recent-stays`
- `codeksei whereabouts recent-moves`
- `codeksei whereabouts summary`

说明：

- `whereabouts serve` 是 V1 唯一 ingestion runtime；默认只监听 `127.0.0.1`，并要求 `CODEKSEI_WHEREABOUTS_TOKEN`
- ingest 只接受 `application/json`；请求体默认上限 `64 KiB`，超限或错误 content-type 会在进入 JSON 解析前直接拒绝
- 事件默认落盘到 `CODEKSEI_STATE_DIR/whereabouts/events.jsonl`；materialized 摘要写到同目录下的 `snapshot.json`、`summary.json`、`stays.json`、`moves.json`
- 命名地点默认读取 `CODEKSEI_STATE_DIR/whereabouts/places.json`；支持 `home|work|custom`
- `snapshot / summary / recent-stays / recent-moves` 只输出 coarse facts，不把裸经纬度带进用户可见文本
- `context inspect` 会显示独立 `whereabouts` layer；Pulse 与 proactive 只读取 `whereabouts summary`，不会把它当作 schedule truth

常用环境变量：

- `CODEKSEI_WHEREABOUTS_HOST=127.0.0.1`
- `CODEKSEI_WHEREABOUTS_PORT=4318`
- `CODEKSEI_WHEREABOUTS_TOKEN=<local bearer token>`
- `CODEKSEI_WHEREABOUTS_RETENTION_DAYS=30`
- `CODEKSEI_WHEREABOUTS_PLACES_FILE=/absolute/path/to/places.json`

## Capability Governance

这一组入口回答“能力是否真的可用”，避免把“配置里有”误读成“当前会话可执行”。

- `codeksei capabilities status`
- `codeksei capabilities status --provider hermes --user <senderId> --workspace /absolute/workspace`

说明：

- JSON 每项包含 `id`、`label`、`configured`、`availableNow`、`status`、`reasons`、`entrypoints`、`mutability`、`sideEffect`、`safetyTier`、`hostSupportTier`、`hostProfiles`
- 文本输出会按 available / degraded / blocked / unknown 汇总，并列出当前不可用原因
- 这条命令只读，不会 bootstrap、安装 Hermes skill 或改写 canonical config
- 判断依据来自当前 command surface、host profile、host dependencies 与 target/workspace 解析，不从字段名猜语义
- 未显式验证的 host readiness 依赖会保守标为 `degraded`；`host doctor/smoke` 这类诊断入口仍保持可调用，用来进一步确认真实状态

## Codeksei Pulse

Pulse 是用户可见的每日策展层：最多给出 3 张今天值得继续推进的卡片，不是自动打扰层。

- `codeksei pulse today --user <senderId> --workspace /absolute/workspace`
- `codeksei pulse generate --user <senderId> --workspace /absolute/workspace --focus "今天想继续哪条线"`
- `codeksei pulse feedback --kind like|dislike|hide|save|task --card <pulseCardId> --topic "主题" --text "反馈"`

说明：

- V1 deterministic-first，不强依赖模型；候选来自 diary、context board、project radar、pending check-in handoff、capability status 与历史反馈
- capability status 只代表“当前可调用/不可调用”，不代表已经拿到实时外部结果；Pulse 不会凭空编外部事实
- 本地状态写入 `CODEKSEI_STATE_DIR/pulse/` 下的 `runs`、`feedback`、`tasks`
- 排序规则固定：focus、未完成任务、项目重入、pending handoff、今天事实充足、like/save 正反馈会加分；最近重复、dislike/hide 负反馈、上下文偏薄会降权
- `pulse today` 会读取当天已有 run；没有 run 时才生成
- `pulse feedback --kind task` 会把卡片主题转成跨天 open task；`like` / `save` / `dislike` / `hide` 只影响本地排序，不训练远端模型

## Scoped Context Packs

Context packs 是可解释、可限预算的定向规则包，不是角色扮演 Worldbook。

- 配置文件：workspace 下 `.codex/context-packs.json`
- 最小字段：`id`、`enabled`、`scope`、`triggers.include`、`triggers.exclude`、`modes`、`budgetChars`、`cooldownHours`、`content`
- V1 只接入 `context inspect` 和 Pulse 的解释/候选层；不会直接污染 runtime prompt
- `exclude` 优先级高于 `include`，适合挡住“文档提到 Hermes 但不应触发本机 Hermes 运维包”这类 false positive
- `context inspect` 本身只读，不会刷新 cooldown；Pulse 生成命中的 pack 会把运行态写到 `CODEKSEI_STATE_DIR/context-packs/`，后续命中会显示 `cooldown active until ...`

## Proactive Observation

这一组入口负责本地小模型观察层：先把 context board / voice signal / recent outcomes 压成 `ProactiveObservation`，再交给 deterministic decision core 判断是否应该主动出现。

- `codeksei proactive observe --user <senderId> --workspace /absolute/workspace`
- `codeksei proactive observe --show --user <senderId> --workspace /absolute/workspace`
- `codeksei proactive observe --dry-run --user <senderId> --workspace /absolute/workspace`
- `codeksei proactive eval --fixture tests/fixtures/proactive-observation-cases.json`

说明：

- observation 只做观察，不决定 schedule truth，不直接发送消息，也不自动写 companion memory
- `sourceHash` 固定基于脱敏 observation source pack：checkin 摘要、context briefing、recent outcomes、deterministic stateCard、timezone、voice signal、target hash；不包含 observation 本身，避免循环依赖
- `confidence` 只描述模型自评；是否能进入决策看 `usable/discardReason`
- `--show` 只读 latest observation、当前 sourceHash、是否 expired、是否 usable，不触发模型调用
- [⚠️ 需确认] llama.cpp server 的 OpenAI-compatible 细节、`response_format`、多模态 `image_url`、`chat_template_kwargs` 等能力不保证跨版本/模型/GGUF 一致。V1 不自动重试删字段；endpoint 不兼容时直接 fallback，并把原因留在 diagnostics

## Onboarding

这一组入口负责“激活即访谈”的轻量本地流程：先自然聊出最小画像，再把长期事实写进 companion note，由 context board 投影给宿主消费。

- `codeksei onboarding start --user <senderId>`
- `codeksei onboarding step --user <senderId> --session <sessionId> --stdin`
- `codeksei onboarding status --user <senderId>`
- `codeksei onboarding reset --user <senderId>`

说明：

- `start` 返回第一句适合直接对用户说的话，不会吐出问卷模板
- `step` 负责吸收用户最新一轮回复、回写 companion note，并给出下一句更自然的追问
- `step` 现在会优先走小模型语义抽取，再回退到 deterministic 规则兜底；六域 persona taxonomy 只作为 backstage schema
- `status` 只看流程状态、session 和缺口
- `reset` 只重置流程状态，不清空已经形成的长期 companion note

## Companion Memory

这一组入口负责 ongoing companion memory：把会影响未来支持方式、边界、节奏、当前定位或近期重入点的新事实提炼进 companion note，而不是只留在宿主聊天记忆里。

- `codeksei companion remember --user <senderId> --workspace /absolute/workspace --source host_user_turn --stdin`

说明：

- 这是 ongoing memory 的统一公共写入口；所有宿主都应把高价值的新事实或纠正送到这里
- 支持安全 over-call：普通寒暄或低信号输入会返回 `noop` 或 `deferred`
- `source` 固定为 `host_user_turn|onboarding_turn|checkin_followup|review_summary|diary_supplement|reminder_proactive`
- `--context-file` 可选，用来补最小结构化上下文；不要求宿主传完整会话窗口
- 这条命令不负责写给用户看的回复，只负责 backstage 提炼、更新 companion note，并在需要时刷新 context board

## Host Attachment Contract

这一组是面向外部宿主的机器入口，不是仓内 TypeScript seam。

- `codeksei host manifest`
  输出 host attachment manifest / hostkit 机器入口；可传 `--provider codex|claudecode|hermes|generic-shell` 切换视角，默认仍列出全部 recipes / workflows
- `codeksei host bootstrap --provider codex`
  写入 Codex Mode canonical config：`modeClass=codex-managed`、`runtimeProvider=codex`、`runtimeOwner=codeksei`、`channelProvider=codeksei`、`deliveryRecipe=codeksei-weixin-bridge`
- `codeksei host bootstrap --provider claudecode`
  写入 Claude Code Mode canonical config：`modeClass=claudecode-managed`、`runtimeProvider=claudecode`、`runtimeOwner=codeksei`、`channelProvider=codeksei`、`deliveryRecipe=codeksei-weixin-bridge`
- `codeksei host bootstrap --provider hermes`
  写入 canonical `codeksei.config.json`，并按 provider 做最小 bootstrap
- `codeksei host doctor --provider codex`
  检查 Codex Mode state dir、模板、Weixin account / runtime capability 与 shared scripts readiness
- `codeksei host doctor --provider claudecode`
  检查 Claude Code Mode state dir、模板、Weixin account / Claude Code runtime 配置与 shared scripts readiness
- `codeksei host doctor --provider hermes`
  统一查看当前环境 / 当前 canonical config 下的 daemon / attachment / provider recipe readiness
- `codeksei host smoke --provider codex`
  执行不依赖 Hermes 的本地 readonly smoke
- `codeksei host smoke --provider claudecode`
  执行不依赖 Hermes 的本地 readonly smoke；不验证 Claude Code 登录态
- `codeksei host smoke --provider hermes`
  执行 provider recipe 的最小 attach smoke
- `codeksei host seed-proactive --provider hermes --user <senderId> --workspace /absolute/workspace`
  种下或修复第一条 future wake
- `codeksei host claim-checkin --provider hermes --user <senderId> --workspace /absolute/workspace`
  原子 claim 一次 delegated proactive pass 的执行 lease
- `codeksei host settle-checkin --provider hermes --user <senderId> --workspace /absolute/workspace --lease <leaseId> --result silent --create-handoff --observed-state "..." --followup-context "..."`
  记录这轮 cron 子 agent 的结构化 proactive handoff，不直接抢走主会话的最终收尾权
- `codeksei host finalize-checkin --provider hermes --user <senderId> --workspace /absolute/workspace --lease <leaseId> --sleep-for <duration>`
  由主会话消费 pending handoff，并写回这轮 delegated proactive pass 的最终 completion / next wake

补充：

- canonical 真相层现在是 `coreInvariant=codeksei-core-owned` 与 `scheduleTruthOwner=codeksei`；`runtimeInvariant=bridge-full` 只保留给旧 hostkit / config consumer 做兼容读取，不再是公开主命名。
- `host manifest` 现在表达默认机器合同，不再伪装成当前环境探测；当前机器/当前 workspace 的实际 provider、profile 与 readiness 统一看 `host doctor`。
- `system checkin-*` 仍保留为低层 truth layer；新宿主默认优先走 `host seed / claim / settle / finalize`。
- Hostkit 的 `entrypoints` 现在也暴露 `capabilitiesStatus`、`contextInspect`、`pulseToday`、`pulseGenerate`、`pulseFeedback`、`diaryWrite`、`timelineEvent`、`timelineCategories`、`timelineRead`、`reviewNightly`、`noteAuto`、`projectRadar`、`reminderWrite`，`recommendedWorkflows` 会提示 `capability_governance_check`、`daily_pulse_review`、`time_block_capture`、`cutover_bookkeeping`、`sleep_closeout`、`project_continuity_write`。宿主应主动使用这些入口做 bookkeeping 与解释，而不是只把它们当 README prose。

## 微信命令

下面这一组是 first-party bridge modes 下 Codeksei 自带微信桥的命令。`Hosted Mode` 下，宿主控制命令应交给 Hermes 自己。

- `/bind`
- `/status`
- `/new`
- `/reread`
- `/switch <threadId>`
- `/stop`
- `/compact`
- `/yes`
- `/always`
- `/no`
- `/model`
- `/model <id> [effort]`
- `/effort`
- `/effort <level>`
- `/checkin`
- `/checkin <min>-<max>`
- `/checkin reset`
- `/reply`
- `/reply mode stream|settled`
- `/reply merge <chars>`
- `/reply page auto|off|<chars>`
- `/reply reset`
- `/more`
- `/next`
- `/prev`
- `/page <n>`
- `/full`
- `/done`
- `/help`

`/reply` 只调整 Codeksei 自带微信桥的回复投递策略：`mode` 会影响后续 turn 的 stream / settled 行为，`merge` 会调整短片段合并阈值，`page` 会调整长回复是否自动分页和每页字符数，`reset` 会回到 `CODEKSEI_WEIXIN_REPLY_MODE`、`CODEKSEI_WEIXIN_MIN_CHUNK_CHARS`、`CODEKSEI_WEIXIN_PAGE_MODE`、`CODEKSEI_WEIXIN_PAGE_CHARS` 或默认值。长回复默认只发第 1 页，后续用 `/more`、`/prev`、`/page <n>` 翻页；`/full` 优先作为临时 `.txt` 文件发送，通道不支持文件时会提示继续翻页。中文短语 `更多`、`下一页`、`上一页`、`全文`、`收起`、`第3页` 只会在当前聊天已有 active page pointer 时被拦截，避免误吞普通消息。它不提供旧分片命令的兼容别名，也不会改变 Hosted Mode 下 Hermes 自己的控制命令。

## Timeline

这一组负责把一天里真实发生过的事留下来。

- `codeksei timeline event --date YYYY-MM-DD --start HH:mm --end HH:mm --title "标题" --subcategory <id>`
- `codeksei timeline write --date YYYY-MM-DD --json '{"events":[...]}'`
- `codeksei timeline read --date YYYY-MM-DD`
- `codeksei timeline categories`
- `codeksei timeline proposals --help`
- `codeksei timeline build`
- `codeksei timeline serve`
- `codeksei timeline dev`
- `codeksei timeline screenshot`

平台前提、agent / MCP 接入顺序、结构化截图合同统一见 [timeline-integration.md](./timeline-integration.md)。

## Frame

这一组负责本地平板常驻 Web 前台。页面默认读 `/frame/state`，只有 URL 显式带 `?mode=mock` 时才显示设计样张。

- `codeksei frame build`
- `codeksei frame serve`
- `codeksei frame serve --port 4327`
- `codeksei frame dev`

`frame serve` 会先刷新本地站点资产，再启动 `http://127.0.0.1:<port>/frame`。V0 继续用轮询和薄 HTTP API，不引入第二套长期状态。

支持速记：

- Windows / macOS / Linux 可跑 timeline CLI
- 要求 `Node.js >= 22`
- Chromium / Chrome / Edge 只在 `timeline screenshot` 时需要
- `CODEKSEI_TIMELINE_LOCALE=zh-CN|en` 可切换 timeline dashboard 文案、日期格式和 demo data 语言

建议：

- 单条明确时间块优先用 `timeline:event`
- 已有完整 JSON、或要批量写入时再用 `timeline:write`
- `timeline:write --stdin` 也要传完整 JSON 对象 `{"events":[...]}`，不要传裸数组
- 不确定分类 id 时先跑 `timeline:categories`，改已有日程前先跑 `timeline:read`
- 不带 offset 的本地时间按当前 runtime timezone 解释；如果 timeline state 已声明非 legacy timezone，会优先沿用它
- `timeline screenshot` 只生成本地文件；需要回传当前聊天时，再单独用 `codeksei channel send-file --path /absolute/path/to/screenshot.png`

这一层更接近生活事实层，优先留下发生过什么。

## Diary

Diary 用来接那些更琐碎、更生活化、也最容易散掉的东西。

- `codeksei diary write --section todo --state open --text "内容"`
- `codeksei diary write --section todo --state done --text "内容" --timeline-text "HH:mm-HH:mm ..."`
- `codeksei diary write --section timeline --text "17:30-17:58 做了什么"`
- `codeksei diary write --date 2026-04-06 --section supplement --title "标题" --text "内容"`

约定：

- 路由速记：`open loop / 待跟进 -> todo`；`事后完成块 -> timeline`；`灵感碎片 -> fragment`；`解释判断 -> supplement`；`收口带走 -> summary`
- `todo + done + --timeline-text` 是原子 cutover 写法
- `todo open` 会在条目里隐式保存这条 live block 的开始时间；如果 block 已经开始且你知道更早时间，开 todo 时就传 `--time HH:mm`
- `todo done` 若省略 `--timeline-text`，会优先复用同一 Todo 捕获的开始时间生成 `HH:mm-HH:mm ...`；只有找不到开始时间时才退回成单点时间事实
- 如果只是补记一条已经完成的事实，直接写 `timeline` 会更顺手
- 当前日期与默认时间都跟随统一 timezone contract，不再写死 `Asia/Shanghai`
- `summary` 主要给 nightly closeout
- `supplement` 用于背景、判断和补充说明，适合接住那些不必写成 live log 的内容

如果 Timeline 更像“发生了什么”，Diary 更像“这一天是怎么慢慢走成现在这样”。

## Reminders

提醒会替生活节奏留出一个外部支点。

- `codeksei reminder write --delay 30m --text "起身喝水"`
- `codeksei reminder write --at 2026-04-07 21:30 --text "收今晚的日记"`
- `codeksei reminder write --delay 2h --text "继续推进这个任务" --user <senderId>`

建议：

- 适合写那些不想只靠脑子记住的事
- 提醒最好短、明确、可执行
- first-party bridge modes 下写本地 reminder queue；Hosted Mode 下会创建 Hermes cron 并 deliver 回当前 origin chat
- 若要修复或安排未来 proactive 唤醒，改走 `host seed-proactive / claim-checkin / settle-checkin / finalize-checkin`
- 如果一条事同时需要后续回看，可以配合 `diary:write` 或 `timeline:event`

## Durable Notes

Durable note 负责把值得长期记住的判断、偏好和项目脉络，放到更稳定的位置。

- `codeksei note auto --project <slug> --kind recent --text "..."`
- `codeksei note auto --scope companion --kind preference --text "..."`
- `codeksei note maybe --project <slug>`
- `codeksei note maybe --scope companion --kind preference`
- `codeksei note sync --project <slug> --section "最近动作" --text "..."`
- `codeksei note sync --path "/absolute/path/to/note.md" --section "当前定位" --text "..."`

建议：

- 默认优先 `note:auto`
- 先判断路由时用 `note:maybe`
- 需要定制 section / slot 时再用 `note:sync`
- 公开示例默认用 `companion`；旧的 `assistant` scope 仍兼容
- 当没有 workspace schema / vault 时，`companion` scope 会自动回退到 `CODEKSEI_STATE_DIR/companions/<userKey>/profile.md`

这一层让值得长期保留的判断、偏好和项目脉络有稳定落点，也让后续照看更连贯。

## Reviews

复盘用于把日常记录慢慢压成更稳定的节奏感。

- `codeksei review nightly`
- `codeksei review nightly --date 2026-04-10`
- `codeksei review weekly`
- `codeksei review weekly --week 2026-W15`
- `codeksei review monthly`
- `codeksei review monthly --month 2026-04`

说明：

- 默认走 hybrid review：脚本保骨架，runtime 语义生成器做结构化提炼
- `CODEKSEI_REVIEW_SEMANTIC_HOST=auto|codex|hermes|deterministic` 可显式指定语义宿主；默认 `auto`
- `CODEKSEI_COMPANION_SEMANTIC_HOST=auto|codex|hermes|deterministic` 可为 ongoing companion memory 抽取单独指定宿主；留空时沿用默认 host 决策
- `CODEKSEI_COMPANION_SEMANTIC_MODEL` 可给 ongoing companion memory 抽取单独指定模型
- `CODEKSEI_COMPANION_SEMANTIC_TIMEOUT_MS` 默认 `15000`，超时自动退回 deterministic 提炼
- `CODEKSEI_ONBOARDING_SEMANTIC_HOST=auto|codex|hermes|deterministic` 可为 onboarding 隐藏抽取单独指定宿主；留空时沿用默认 host 决策
- `CODEKSEI_ONBOARDING_SEMANTIC_MODEL` 可给 onboarding 六域 persona 抽取单独指定模型
- `CODEKSEI_ONBOARDING_SEMANTIC_TIMEOUT_MS` 默认 `15000`，超时自动退回 deterministic 抽取
- `CODEKSEI_PROACTIVE_JUDGMENT_HOST=auto|local|openai-compatible|codex|hermes|deterministic` 可为主动判断层单独指定语义宿主；默认 `auto`
- `CODEKSEI_PROACTIVE_JUDGMENT_ENDPOINT` 默认 `http://127.0.0.1:11434/v1`，支持本地或云端 OpenAI-compatible API；失败不阻断 check-in，会回退 deterministic
- `CODEKSEI_PROACTIVE_JUDGMENT_MODEL` 默认 `qwen3.5:2b`，只是推荐默认值，实际模型由本地/云端 endpoint 决定
- `CODEKSEI_PROACTIVE_OBSERVATION_HOST=auto|local|openai-compatible|codex|hermes|deterministic` 可为 observation layer 单独指定语义宿主；默认 `auto`
- `CODEKSEI_PROACTIVE_OBSERVATION_ENDPOINT` 默认 `http://127.0.0.1:8080/v1`，优先服务 Gemma 4 E2B-it 这类本地小模型
- `CODEKSEI_PROACTIVE_OBSERVATION_TIMEOUT_MS` 默认 `8000`，`CODEKSEI_PROACTIVE_OBSERVATION_MIN_CONFIDENCE` 默认 `0.55`
- 不传 `--date/--week/--month` 时，当前日期按统一 timezone contract 推断
- 失败或超时会回退 deterministic
- nightly 是周/月复盘的前置压缩层

nightly 更接近睡前收口；weekly / monthly 更接近重新校准生活和项目节奏。

## Project Radar

Project radar 用于回答“项目现在在哪、应该从哪里重新进去”。

- `codeksei project radar --list`
- `codeksei project radar --project <slug> --json`

用途：

- 找回 tracked repo 的根目录、workspace note、稳定入口文件
- 看当前 branch、working tree、最近 commits
- 本地 repo 不在、不是 git repo、或只剩工作目录时，回退到 GitHub activity 来回答“最近这条项目线在哪活跃”
- GitHub fallback 只是 continuity signal，不伪装成本地工作树真相

## Maintainer Smoke

这组不是日常用户入口，而是 shared / adapter lifecycle 收口后的维护者最小 smoke checklist。

- `npm run shared:start`
- `npm run shared:status`
- `npm run shared:open` `Codex Mode only`
- 模拟一次 runtime child close / reconnect
- 验证 approval continuity after restart
- 仓库内自动化基线现在还会跑 `tests/shared-mode-long-chain.test.ts`
- `/reply mode` 与 `/reply merge` 的单元测试覆盖持久配置、运行中切换和短片段合并

自动化 smoke 覆盖：

- fake Codex app-server + fake Weixin HTTP server
- built `dist` shared entrypoints
- `stream` 与 `settled` 两种 reply mode
- pending approval 持久化后 restart 再 `/yes`
- 这组自动化证明的是仓内 fake-harness integration surface，不是 live account / live network / live runtime 证明

maintainer 仍需额外补一次真实账号 smoke：

- `npm run smoke:shared:real:attach`
  验证 shared:start / shared:status / shared:open 这条真实 env 链路；会用一次性 open probe 包装器确认 `resume <thread> --remote ...` 真的按当前绑定 thread 组装出来。
- `npm run smoke:shared:real:reply -- --mode stream|settled|both`
  assisted smoke。脚本会生成 nonce 和发送文案，维护者在真实微信里发出后，脚本从 `shared-wechat.log` 里等待 `delivered weixin reply ... hash=...`。
- `npm run smoke:shared:real:approval`
  assisted smoke。脚本会等待 pending approval 落盘、自动重启 bridge，然后等待 `/yes` 之后 approval 清空和最终 delivered hash。
- 这三条脚本都会在 `shared-wechat.log` / `shared-app-server.log` 里写 `[codeksei-smoke] stage=...` checkpoint，排查时优先从这些 marker 往后看。
- `[⚠️ 需确认]` 这组真实 smoke 依赖可用的 WeChat 登录态、绑定 thread 和能触发 approval 的活跃 Codex runtime；环境不满足时脚本会直接报错，而不是静默跳过。
- Claude Code Mode 的真实 smoke 走 `CODEKSEI_RUNTIME=claudecode npm run shared:start`，验证普通 turn、审批、`/new`、`/switch`、`/compact`；不使用 `shared:open`。
- Claude Code Tools MCP 的 smoke 先跑 `codeksei tool mcp-bootstrap --scope local --workspace-root <workspace>` 预览，再在可信 workspace 下显式 `--install`，通过 `claude mcp list` 或 Claude Code 内 `/mcp` 确认 `codeksei_tools`。
- Hosted Mode 的真实验证不走这套 shared smoke；那条线要验证的是 Hermes gateway + Hermes Weixin + Codeksei companion skill。
- Hosted operator 侧的前置检查入口是 `codeksei operator hermes smoke`；它会验证 Hermes CLI / repo-local sibling checkout / Weixin account / skill parity / hosted semantic review 准备度，不伪造 live Weixin 成功。
- 最近一次 recorded 结果入口统一看 [docs/maintainer/live-smoke.md](./maintainer/live-smoke.md)

## Maintainer Quality Gates

这组入口现在明确分工，不再靠 `prepare` 或 pack lifecycle 偷偷刷新发布产物。

- `npm run check`
  source-only：跑 authored-source JS guard、published runtime artifact guard、其它 lint guard、源码 typecheck、tests TS typecheck；不会重建 `dist/`
  这里已经直接覆盖 duplicate helper、bare empty catch、redundant `typedXxx`、`!:`、explicit `any` 等结构债 guard
- `npm run coverage:critical`
  owner-focused + per-file coverage gate：只覆盖 `config`、`weixin delivery text`、`runtime turn`、`stream delivery` 这组关键 owner，并逐文件执行阈值；不进入 `check`
- `npm run verify`
  built-runtime gate：先跑 `check` + `coverage:critical`，再显式 `npm run build`，然后跑 built `dist` 的仓内 tests，最后跑 `npm run pack:dry-run`
- `npm run build`
  只在你明确要刷新 published runtime artifacts 时使用；默认不是 `check` 的副作用

补充约定：

- `check` 当前仍以 repo-specific guard 为 canonical lint truth；没有额外引入 Prettier 或 whole-repo ESLint gate
- `playwright-core` 继续作为 runtime dependency，因为 `timeline screenshot` 是公开运行时能力；浏览器查找顺序固定为 `CODEKSEI_SCREENSHOT_CHROME_PATH` -> Playwright managed path -> 系统 Chrome/Chromium/Edge
- `dotenv` 继续作为 runtime dependency，因为运行时要先读 repo `.env`，再按 `CODEKSEI_STATE_DIR` 补读 state-dir `.env`，Hermes repo-local 入口还要镜像 `~/.hermes/.env`

这页只管“怎么使用这些入口”；维护与发布流程留在本地维护材料里。
