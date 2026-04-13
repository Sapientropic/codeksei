# Commands

这页汇总 `Codeksei` 当前对外可用的主要命令入口。

可把它当作一张入口地图：记录日常、补提醒、做复盘、重新进入项目时，都可以先从这里找到对应入口。

`Codeksei` 先定义稳定动作，再分别映射到终端和微信，让不同入口共享同一套行为语义。
这页只负责对外说明；真实 active command surface 以当前共享 help / manifest 为准，不再单独发明第二套命令语义。

## 命名

对外统一只用新名字。

当前主入口：

- 包名：`codeksei`
- CLI：`codeksei`
- env 前缀：`CODEKSEI_*`

README、帮助文本和公开示例默认都按 `codeksei` 书写。

## 终端主入口

首次使用时，先记住这一组主入口即可。

最常用（公共 CLI）：

- `codeksei login`
- `codeksei accounts`
- `codeksei doctor`
- `codeksei help`

仓库脚本 / shared 模式：

- `npm run shared:start`
- `npm run shared:open`
- `npm run shared:status`
- `npm run shared:watchdog`
- `npm run background:install`
- `npm run background:uninstall`

说明：

- 日常使用默认走共享模式，让微信入口和终端执行落在同一条线上
- `codeksei start` / `npm run start:checkin` 更适合最小链路调试

## 微信命令

微信侧命令保持少而稳，重点是绑定、查看状态、切换线程和审批。

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
- `/model <id>`
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

建议：

- 单条明确时间块优先用 `timeline:event`
- 已有完整 JSON、或要批量写入时再用 `timeline:write`
- `timeline:write --stdin` 也要传完整 JSON 对象 `{"events":[...]}`，不要传裸数组
- 不确定分类 id 时先跑 `timeline:categories`，改已有日程前先跑 `timeline:read`
- 不带 offset 的本地时间按当前 runtime timezone 解释；如果 timeline state 已声明非 legacy timezone，会优先沿用它
- 截图回微信统一走 `timeline:screenshot -- --send`

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

- 默认走 hybrid review：脚本保骨架，Codex 做结构化语义提炼
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
- 把 git 动作视作“最近发生了什么”的弱信号，方便判断下一步从哪里接上

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

这页只管“怎么使用这些入口”；维护与发布流程留在本地维护材料里。
