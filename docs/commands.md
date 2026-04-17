# Commands

这页汇总 `Codeksei` 当前对外可用的主要命令入口。

可把它当作一张入口地图：记录日常、补提醒、做复盘、重新进入项目时，都可以先从这里找到对应入口。

`Codeksei` 先定义稳定动作，再分别映射到终端和微信，让不同入口共享同一套行为语义。
这页只负责对外说明；真实 active command surface 以当前共享 help / manifest 为准，不再单独发明第二套命令语义。

## Host Modes

当前有两条官方路径：

- `Codex Mode`
  `runtime=codex` + `channelProvider=codeksei` + `channel=weixin`
- `Hosted Mode`
  `runtime=hermes` + `channelProvider=hermes` + `channel=weixin`

边界：

- `Codex Mode` 下，Codeksei 自己托管 bridge / shared 线程
- `Hosted Mode` 下，宿主控制命令交给 Hermes；Codeksei 主要暴露 timeline / diary / reminder / review / note / project radar / doctor / schema，并提供 Hermes operator 入口做 skill/status/smoke/sync-checkin
- `channel send-file`、`timeline screenshot --send`、`reminder write` 已接上 Hermes repo-local 路径；`system send` 仍因缺少 backstage-only 宿主原语而保持 blocked
- `Hosted Mode` 下，Hermes 只执行受控 wake/recovery job set；Codeksei 继续持有 `tick -> ack -> complete` 的调度真相，并通过 `operator hermes sync-checkin` 把下一次 wake/recovery 重新 arm 给 Hermes
- 外部宿主优先通过 `host attachment contract` 接入：`host manifest`、`host bootstrap`、`host doctor`、`host smoke`、`host seed-proactive`、`host claim-checkin`、`host settle-checkin`

## 命名

对外统一只用新名字。

当前主入口：

- 包名：`codeksei`
- CLI：`codeksei`
- env 前缀：`CODEKSEI_*`

README、帮助文本和公开示例默认都按 `codeksei` 书写。

表层文案约定：

- 用户可见的 CLI / WeChat / runtime failure 提示默认中文
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
- `codeksei host manifest`
- `codeksei host bootstrap`
- `codeksei host doctor`
- `codeksei host smoke`
- `codeksei host seed-proactive`
- `codeksei host claim-checkin`
- `codeksei host settle-checkin`
- `codeksei host render`

operator / bootstrap：

- `codeksei operator help`
- `codeksei operator schema`
- `codeksei operator hermes install-skill`
- `codeksei operator hermes sync-checkin`
- `codeksei operator hermes status`
- `codeksei operator hermes smoke`
- `codeksei login` `Codex Mode only`
  默认协议版本对齐腾讯官方包 `@tencent-weixin/openclaw-weixin@2.1.8`；海外 / 国际版 WeChat 扫码仍可能受官方地域灰度限制
- `codeksei accounts` `Codex Mode only`
- `codeksei start` `Codex Mode only`
- `codeksei system checkin-trigger`
- `codeksei system checkin-tick`
- `codeksei system checkin-complete`
- `codeksei system checkin-poller`

仓库脚本 / shared 模式：

- `npm run shared:start` `Codex Mode only`
- `npm run shared:open` `Codex Mode only`
- `npm run shared:status`
- `npm run shared:watchdog` `Codex Mode only`
- `npm run background:install`
- `npm run background:uninstall`

主动 check-in 控制：

- `codeksei host seed-proactive --provider hermes --user <senderId> --workspace /absolute/workspace`
- `codeksei host claim-checkin --provider hermes --user <senderId> --workspace /absolute/workspace`
- `codeksei host settle-checkin --provider hermes --user <senderId> --workspace /absolute/workspace --lease <leaseId> --result silent --sleep-for <duration>`
- `codeksei system checkin --show`
- `codeksei system checkin --range 3-60`
- `codeksei system checkin --reset`
- `codeksei system checkin-trigger --user <senderId> --workspace /absolute/workspace`
- `codeksei system checkin-tick --user <senderId> --workspace /absolute/workspace`
- `codeksei system checkin-tick --user <senderId> --workspace /absolute/workspace --ack <triggerId>`
- `codeksei system checkin-complete --user <senderId> --workspace /absolute/workspace --trigger <triggerId> --result silent --sleep-for <duration>`
- `codeksei operator hermes sync-checkin --user <senderId> --workspace /absolute/workspace`
- `codeksei context briefing --user <senderId> --workspace /absolute/workspace --mode proactive`
- `codeksei context briefing --user <senderId> --workspace /absolute/workspace --mode review`

说明：

- `codeksei help` / `codeksei schema` 默认只暴露 public finite command surface
- `codeksei operator help` / `codeksei operator schema` 才会显示 bootstrap、shared、background、maintainer 入口
- `codeksei operator hermes --help` / `codeksei operator schema operator hermes` 会列出 Hosted Mode / Hermes recipe 的 4 个 leaf action
- `codeksei operator hermes install-skill` 是唯一会改本机 Hermes skill 状态的 leaf action；支持 `--dry-run`
- `codeksei operator hermes sync-checkin` 会按当前 target 的 checkin state 为 Hermes 创建/更新当前需要存在的受控 wake/recovery job set；支持 `--dry-run`
- `Codeksei` 当前 hosted check-in 主链不再要求 Hermes upstream 先支持 cron `env`；若想把 Hermes 原生 cron `env` 能力也补上，可选补丁统一看 [`docs/hermes-cron-env-patch.md`](./hermes-cron-env-patch.md)
- 非 TTY 默认返回 JSON envelope；TTY 默认返回 text
- `stdout` 留给结果数据，`stderr` 留给诊断与 debug 信息
- 全局参数统一支持：`--format json|text`、`--verbose`、`--workspace-root /absolute/path`
- 日常使用默认走共享模式，让微信入口和终端执行落在同一条线上
- `codeksei start` / `npm run start:checkin` 更适合 operator 调试，不再视作默认 public discovery 面
- 如果当前配置是 `Hosted Mode`，`codeksei start` 与 `shared:start` 会明确提示“改由 Hermes gateway 托管”，不会隐式回退到 Codex app-server
- `codeksei system checkin-poller` 现在只保留 bridge 宿主包装；host-neutral 真相层是 `checkin-trigger`、`checkin-tick` 与 `checkin-complete`
- `checkin-complete` 在 Hosted Mode 下会在写回 state 后自动 re-arm 下一组 wake/recovery jobs，并清理多余的未来 job
- `sync-checkin` 创建/更新 job 时需要 origin context；真正 cron 投递时，Hermes 直接读取持久化的 `job.origin`，不会再按 target 反查 live session
- `sync-checkin` 现在会同时写入 Hermes cron `script`；每次 wake 前先调用 `codeksei context briefing` 读取最新 context board，再让 Hermes 用这份 handoff context 执行主动判断
- `sync-checkin` 现在会先确保目标 wake/recovery job 已成功存在，再 best-effort 清理旧 job；中途失败时不会先把最后一条 recovery wake 删掉
- `system checkin --range` 现在是 fallback window，不再代表 agent 的真实唤醒节奏

## Context Board

这一组入口把 Codeksei 的“主动性判断上下文层”暴露成稳定 CLI，而不是要求宿主或 agent 去盲扫原始 vault / repo。

- `codeksei context briefing --user <senderId> --workspace /absolute/workspace`
- `codeksei context briefing --user <senderId> --workspace /absolute/workspace --mode proactive`
- `codeksei context briefing --user <senderId> --workspace /absolute/workspace --mode review`

说明：

- 默认输出当前 target 的 prompt-ready briefing；`--mode proactive|review` 用来调整 framing
- board 落在 `CODEKSEI_STATE_DIR/context/boards/<targetKey>.md`
- 来源固定为受控输入集：checkin state、当日日记、最近 companion note、proactive follow-up context、project radar、workspace continuity 入口
- 缺源时显式标 `[⚠️ 需确认]`，不会编造
- Hosted Mode 下的 proactive wake 会在 cron 运行前现读这份 board；原始 `AGENTS.md / Home.md / diary` 是输入源，不再是 cron prompt 的直接 surface

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
  输出 host attachment manifest / hostkit 机器入口
- `codeksei host bootstrap --provider hermes --ensure-daemon`
  写入 canonical `codeksei.config.json`，并按 provider 做最小 bootstrap
- `codeksei host doctor --provider hermes`
  统一查看 daemon / attachment / provider recipe readiness
- `codeksei host smoke --provider hermes`
  执行 provider recipe 的最小 attach smoke
- `codeksei host seed-proactive --provider hermes --user <senderId> --workspace /absolute/workspace`
  种下或修复第一条 future wake
- `codeksei host claim-checkin --provider hermes --user <senderId> --workspace /absolute/workspace`
  原子 claim 一次 delegated proactive pass 的执行 lease
- `codeksei host settle-checkin --provider hermes --user <senderId> --workspace /absolute/workspace --lease <leaseId> --result silent --sleep-for <duration>`
  回写这轮 delegated proactive pass 的真实结果

补充：

- canonical 真相层现在是 `coreInvariant=codeksei-core-owned` 与 `scheduleTruthOwner=codeksei`；`runtimeInvariant=bridge-full` 只保留给旧 hostkit / config consumer 做兼容读取，不再是公开主命名。
- `operator hermes *` 与 `system checkin-*` 继续保留为兼容 building blocks；新宿主默认优先走 `host seed / claim / settle`。

## 微信命令

下面这一组是 `Codex Mode` 下 Codeksei 自带微信桥的命令。`Hosted Mode` 下，宿主控制命令应交给 Hermes 自己。

- `/bind`
- `/status`
- `/new`
- `/reread`
- `/switch <threadId>`
- `/stop`
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
- `/help`

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
- `codeksei timeline screenshot --send`

平台前提、agent / MCP 接入顺序、结构化截图合同统一见 [timeline-integration.md](./timeline-integration.md)。

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
- 截图回微信统一走 `timeline:screenshot -- --send`；Codex Mode 下经本地截图队列，Hosted Mode 下经 Hermes repo-local send-back

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
- `codeksei reminder write --delay 2h --delivery proactive --text "白天再主动接回这条线"`

建议：

- 适合写那些不想只靠脑子记住的事
- 提醒最好短、明确、可执行
- Codex Mode 下写本地 reminder queue；Hosted Mode 下默认 `--delivery direct`，会创建 Hermes cron 并 deliver 回当前 origin chat
- Hosted Mode 下若正文是内部后续跟进而不是用户可见文案，改用 `--delivery proactive`，让它回到未来 proactive wake，而不是直接发给用户
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
- `npm run shared:open`
- 模拟一次 runtime child close / reconnect
- 验证 approval continuity after restart
- 仓库内自动化基线现在还会跑 `tests/shared-mode-long-chain.test.ts`

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
- Hosted Mode 的真实验证不走这套 shared smoke；那条线要验证的是 Hermes gateway + Hermes Weixin + Codeksei companion skill。
- Hosted operator 侧的前置检查入口是 `codeksei operator hermes smoke`；它会验证 Hermes CLI / repo-local sibling checkout / Weixin account / skill parity / hosted semantic review 准备度，不伪造 live Weixin 成功。
- 最近一次 recorded 结果入口统一看 [docs/maintainer/live-smoke.md](./maintainer/live-smoke.md)

## Maintainer Quality Gates

这组入口现在明确分工，不再靠 `prepare` 或 pack lifecycle 偷偷刷新发布产物。

- `npm run check`
  source-only：跑 authored-source JS guard、published runtime artifact guard、其它 lint guard、源码 typecheck、tests TS typecheck；不会重建 `dist/`
  这里已经直接覆盖 duplicate helper、bare empty catch、redundant `typedXxx`、`!:`、explicit `any` 等结构债 guard
- `npm run coverage:critical`
  owner-focused coverage gate：只覆盖 `config`、`weixin delivery text`、`runtime turn`、`stream delivery` 这组关键 owner；不进入 `check`
- `npm run verify`
  built-runtime gate：先跑 `check` + `coverage:critical`，再显式 `npm run build`，然后跑 built `dist` 的仓内 tests，最后跑 `npm run pack:dry-run`
- `npm run build`
  只在你明确要刷新 published runtime artifacts 时使用；默认不是 `check` 的副作用

补充约定：

- `check` 当前仍以 repo-specific guard 为 canonical lint truth；没有额外引入 Prettier 或 whole-repo ESLint gate
- `playwright-core` 继续作为 runtime dependency，因为 `timeline screenshot` 是公开运行时能力；浏览器查找顺序固定为 `CODEKSEI_SCREENSHOT_CHROME_PATH` -> Playwright managed path -> 系统 Chrome/Chromium/Edge
- `dotenv` 继续作为 runtime dependency，因为运行时要先读 repo `.env`，再按 `CODEKSEI_STATE_DIR` 补读 state-dir `.env`，Hermes repo-local 入口还要镜像 `~/.hermes/.env`

这页只管“怎么使用这些入口”；维护与发布流程留在本地维护材料里。
