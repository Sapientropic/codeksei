# Commands

## 设计原则

`Cyberboss` 不把所有终端、微信、不同 agent 的命令写死成同一套字符串。

它先定义稳定的内部 action，再让每个通道做自己的映射：

- core action：内部稳定语义
- terminal command：终端入口
- weixin command：微信入口

这样后面接入新的 runtime 或 channel 时，不需要反复重命名 core。

## 当前 action 分组

### 启动与诊断

- `app.login`
- `app.accounts`
- `app.start`
- `app.doctor`

### 项目与线程

- `workspace.bind`
- `workspace.status`
- `thread.new`
- `thread.switch`
- `thread.stop`

### 授权与控制

- `approval.accept_once`
- `approval.accept_workspace`
- `approval.reject_once`

### 能力集成

- `model.inspect`
- `model.select`
- `project.radar`
- `channel.send_file`
- `timeline.write`
- `reminder.create`
- `diary.append`
- `app.help`

## 当前终端命令

当前只开放最小一组：

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
- `npm run project:radar -- --list`
- `npm run project:radar -- --project <slug> --json`
- `npm run note:auto -- --project <slug> --kind <kind> --text "..."`
- `npm run note:maybe -- [--project <slug> | --scope <name>] [--kind <kind>]`
- `npm run note:sync -- --project <slug> --section <标题> --text "..."` 或 `--path <path>`
- `npm run review:nightly -- [--date YYYY-MM-DD] [--deterministic] [--model <id>]`
- `npm run review:weekly -- [--week YYYY-Www] [--date YYYY-MM-DD] [--deterministic] [--model <id>]`
- `npm run review:monthly -- [--month YYYY-MM] [--date YYYY-MM-DD] [--deterministic] [--model <id>]`

## 规划中的终端子命令

为了避免继续把所有能力都平铺在顶层，后续命令会按能力分组：

### channel

- `npm run channel:send-file -- --path /绝对路径`

说明：
- 用来把本地已有文件直接发回当前微信聊天
- 可选 `--user <wechatUserId>` 覆盖默认接收用户

### reminder

- `npm run reminder:write -- --delay 30m --text "提醒内容"`
- `npm run reminder:write -- --delay 1h30m --text "提醒内容"`
- `npm run reminder:write -- --at "2026-04-07 21:30" --text "提醒内容"`

### diary

- `npm run diary:write -- --section todo --state open --text "内容"`
- `npm run diary:write -- --section todo --state done --text "内容" --timeline-text "22:39-23:04 做完了什么"`
- `npm run diary:write -- --section timeline --text "17:30-17:58 把药单发出去了"`
- `npm run diary:write -- --date 2026-04-06 --section supplement --title "4.6" --text "内容"`

说明：
- `--section` 决定写到 `Todo / 时间线事实 / 今日碎片 / 补充记录 / 总结` 里的哪一层
- `--state` 只和 `--section todo` 一起用，支持 `open | done`
- 新调用在 `--section todo --state done` 时默认应同时带 `--timeline-text`，这样 cutover 会在一个命令里同时写 `Todo + 时间线事实`
- `--title` 默认主要给 `supplement` 用；其他 section 会和 `--text` 合成单行内容
- `--date` 才决定写入哪个日记文件
- `--time` 可选，用来覆盖条目时间

### system

- `npm run system:send -- --text "系统消息"`
- `npm run system:checkin`

说明：
- `checkin` 更推荐跟随共享模式一起开：`npm run shared:start`
- `system:checkin` 仅保留为底层轮询入口
- 后台桥本身的健康巡检请优先用 `npm run shared:watchdog`
- Windows 默认后台安装会注册 `登录 / 解锁 / 睡眠恢复` 三类 poke task；这些任务只打一枪 `shared:start`，而长期健康检查由常驻 supervisor 在进程内按 5 分钟间隔睡眠巡检

### timeline

- `npm run timeline:event -- --date YYYY-MM-DD --start HH:mm --end HH:mm --title "标题" --subcategory <id>`
- `npm run timeline:write -- --date YYYY-MM-DD --stdin`
- `npm run timeline:build`
- `npm run timeline:serve`
- `npm run timeline:dev`
- `npm run timeline:screenshot -- --send`

说明：
- 单条事件优先用 `timeline:event`，它会在 bridge 里帮你组装 `timeline write --json ...`，避免 agent 自己拼 raw JSON。
- `timeline:write` 保留给批量写入、替换或你已经有完整 JSON payload 的情况。
- `timeline:screenshot -- --send` 会把截图任务发给当前微信桥执行，并自动把结果回传给当前微信用户。
- 这条命令本身只表示“已入队”；不要把 `queued` 误解成“图片已经发到微信”。

当前文档里列出的 `reminder / diary / system / timeline` 都已可直接使用。

### project

- `npm run project:radar -- --list`
- `npm run project:radar -- --project <slug> --json`

说明：
- 默认从当前 workspace 的 `.codex/code-projects.json` 读取已跟踪代码项目
- 输出会包含 workspace note、repo 里的稳定入口、当前 branch、working tree 摘要和最近 commits
- 这里的 git 信息只应视为“最近在做什么”的弱信号，不应该直接替代项目页、README 或索引报告

### note

- `npm run note:auto -- --project cyberboss --kind recent --text "补了 durable note schema 和 note:auto / note:maybe"`
- `npm run note:auto -- --scope assistant --kind preference --text "默认先接住，再定向，再推进，不做催债式主动提醒"`
- `npm run note:auto -- --scope inspiration --kind idea --text "做一个更像 transition scaffolding 的主动 check-in"`
- `npm run note:maybe -- --project cyberboss`
- `npm run note:maybe -- --scope assistant --kind preference`
- `npm run note:sync -- --project cyberboss --section "最近动作" --text "把 prompt 收口成更温柔的 chief-of-staff 风格"`
- `npm run note:sync -- --project cyberboss --section "当前状态" --slot current-status --style paragraph --text "shared bridge 正常，默认主 workspace 是 Website"`
- `npm run note:sync -- --path "项目/Cyberboss 生活助理/README.md" --section "当前定位" --text "默认先接住，再定向，再推进"`

说明：
- `note:auto` 会按 workspace 的 durable note schema 自动决定 file / section / style / slot，默认应该优先用它
- `note:maybe` 只看路由，不落盘；适合先判断当前摘要应该进哪个 durable sink
- 这是轻量 durable note 回写入口，不是强制日志系统
- 默认 `style=bullet`，适合“最近动作 / durable 结论 / 下一步”
- 传 `--slot <id>` 时，会在该 section 里维护一个受控块，适合“当前状态”这类需要覆盖旧值的摘要
- `--project <slug>` 适合代码项目 note；`--path` 适合 life-assistant note 或其他 workspace note

### review

- `npm run review:nightly`
- `npm run review:nightly -- --date 2026-04-10`
- `npm run review:weekly`
- `npm run review:weekly -- --week 2026-W15`
- `npm run review:monthly`
- `npm run review:monthly -- --month 2026-04`

说明：
- 复盘来源是当前 workspace 的日记真相源，不是 timeline 派生页，也不是学习项目模板
- 默认走 `hybrid review v2`：脚本负责窗口、文件、幂等 block 和 fallback，Codex 只负责结构化语义提炼
- 语义提炼失败、超时或请求审批时，会自动回退到 deterministic 提取
- `nightly` 负责睡前收口，给后面的周/月复盘先压一层低摩擦原料
- 传 `--deterministic` 可强制只走脚本；传 `--model <id>` 可覆盖 review semantic pass 用的模型
- 周复盘默认按周一到周日；月复盘默认按自然月
- 生成的 note 会保留固定骨架，并用受控 block 更新“推进 / 摩擦 / 线头 / 每天收口摘录”等生成区
- 当同一时间窗口里已经有 nightly note 时，周/月复盘会优先吸收 nightly 的“睡前收口摘录 / 值得带走的信号”

## 当前已接入的微信命令

- `/bind`
- `/status`
- `/new`
- `/reread`
- `/stop`
- `/switch <threadId>`
- `/yes`
- `/always`
- `/no`
- `/model`
- `/model <id>`
- `/help`

说明：

- `/status` 合并了原先 `where` 和 `usage` 的职责
- `/new` 后的下一条普通消息会先按当前 workspace 重建上下文入口
- `/reread` 会让当前线程重读最新 instructions 和当前 workspace 的稳定入口
- `/switch <threadId>` 如果命中这条 thread 已知的旧 workspace，会一起切回去；下一条普通消息会按当前 workspace 检查是否需要补读稳定入口
- `/help` 保留
- `/reread` 保留为显式重读入口；如果只是轻微提醒模型“重新读一下”，自然语言也可以
- 文件发送能力仍保留，但不再暴露成微信命令
