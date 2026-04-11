# Commands

这页汇总 `Codeksei` 当前对外可用的主要命令入口。

可把它当作一张入口地图：记录日常、补提醒、做复盘、重新进入项目时，都可以先从这里找到对应入口。

`Codeksei` 先定义稳定动作，再分别映射到终端和微信，让不同入口共享同一套行为语义。

## 命名与兼容

对外统一用新名字，对内尽量不打断旧痕迹。

当前主入口：

- 包名：`codeksei`
- CLI：`codeksei`
- env 前缀：`CODEKSEI_*`

兼容入口仍保留：

- CLI：`cyberboss`
- env 前缀：`CYBERBOSS_*`

README 和帮助文本默认都按新入口书写；旧名字只作为兼容层保留。

## 终端主入口

首次使用时，先记住这一组主入口即可。

最常用：

- `npm run login`
- `npm run accounts`
- `npm run shared:start`
- `npm run shared:open`
- `npm run shared:status`
- `npm run shared:watchdog`
- `npm run background:install`
- `npm run background:uninstall`
- `npm run doctor`
- `npm run help`

说明：

- 日常使用默认走共享模式，让微信入口和终端执行落在同一条线上
- `npm run start` / `npm run start:checkin` 更适合最小链路调试

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

- `npm run timeline:event -- --date YYYY-MM-DD --start HH:mm --end HH:mm --title "标题" --subcategory <id>`
- `npm run timeline:write -- --date YYYY-MM-DD --json '{"events":[...]}'`
- `npm run timeline:read -- --date YYYY-MM-DD`
- `npm run timeline:categories`
- `npm run timeline:proposals -- --help`
- `npm run timeline:build`
- `npm run timeline:serve`
- `npm run timeline:dev`
- `npm run timeline:screenshot -- --send`

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

- `npm run diary:write -- --section todo --state open --text "内容"`
- `npm run diary:write -- --section todo --state done --text "内容" --timeline-text "HH:mm-HH:mm ..."`
- `npm run diary:write -- --section timeline --text "17:30-17:58 做了什么"`
- `npm run diary:write -- --date 2026-04-06 --section supplement --title "标题" --text "内容"`

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

- `npm run reminder:write -- --delay 30m --text "起身喝水"`
- `npm run reminder:write -- --at 2026-04-07 21:30 --text "收今晚的日记"`
- `npm run reminder:write -- --delay 2h --text "继续推进这个任务" --user <senderId>`

建议：

- 适合写那些不想只靠脑子记住的事
- 提醒最好短、明确、可执行
- 如果一条事同时需要后续回看，可以配合 `diary:write` 或 `timeline:event`

## Durable Notes

Durable note 负责把值得长期记住的判断、偏好和项目脉络，放到更稳定的位置。

- `npm run note:auto -- --project <slug> --kind recent --text "..."`
- `npm run note:auto -- --scope companion --kind preference --text "..."`
- `npm run note:maybe -- --project <slug>`
- `npm run note:maybe -- --scope companion --kind preference`
- `npm run note:sync -- --project <slug> --section "最近动作" --text "..."`
- `npm run note:sync -- --path "/absolute/path/to/note.md" --section "当前定位" --text "..."`

建议：

- 默认优先 `note:auto`
- 先判断路由时用 `note:maybe`
- 需要定制 section / slot 时再用 `note:sync`
- 公开示例默认用 `companion`；旧的 `assistant` scope 仍兼容

这一层让值得长期保留的判断、偏好和项目脉络有稳定落点，也让后续照看更连贯。

## Reviews

复盘用于把日常记录慢慢压成更稳定的节奏感。

- `npm run review:nightly`
- `npm run review:nightly -- --date 2026-04-10`
- `npm run review:weekly`
- `npm run review:weekly -- --week 2026-W15`
- `npm run review:monthly`
- `npm run review:monthly -- --month 2026-04`

说明：

- 默认走 hybrid review：脚本保骨架，Codex 做结构化语义提炼
- 不传 `--date/--week/--month` 时，当前日期按统一 timezone contract 推断
- 失败或超时会回退 deterministic
- nightly 是周/月复盘的前置压缩层

nightly 更接近睡前收口；weekly / monthly 更接近重新校准生活和项目节奏。

## Project Radar

Project radar 用于回答“项目现在在哪、应该从哪里重新进去”。

- `npm run project:radar -- --list`
- `npm run project:radar -- --project <slug> --json`

用途：

- 找回 tracked repo 的根目录、workspace note、稳定入口文件
- 看当前 branch、working tree、最近 commits
- 把 git 动作视作“最近发生了什么”的弱信号，方便判断下一步从哪里接上

## 兼容细节

改名不应该让已有状态、旧脚本和历史痕迹一下子失效，所以兼容层会继续保留。

- 文档中的 `CODEKSEI_*` 都有 `CYBERBOSS_*` 兼容读取
- 主 bin 是 `codeksei`，旧 `cyberboss` 仍可调用
- 新 managed marker 前缀写成 `codeksei-*`，但旧 `cyberboss-*` marker 仍能继续被读取和更新

## 发布与 CI

发布流程、GitHub Actions 和仓库 slug 迁移约定统一见 [release.md](./release.md)。
这页只管“怎么使用这些入口”，不再重复维护第二份发布说明。
