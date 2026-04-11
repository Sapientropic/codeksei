# Commands

`Codeksei` 的命令设计不是把所有通道都硬写成一套字符串，而是先定义稳定动作，再为终端和微信映射各自入口。

## 命名与兼容

当前主入口：

- 包名：`codeksei`
- CLI：`codeksei`
- env 前缀：`CODEKSEI_*`

兼容入口仍保留：

- CLI：`cyberboss`
- env 前缀：`CYBERBOSS_*`

README 和帮助文本默认都按新入口书写；旧名字只作为兼容层保留。

## 终端主入口

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

- 日常使用默认走共享模式
- `npm run start` / `npm run start:checkin` 更适合最小链路调试

## 微信命令

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

- `npm run timeline:event -- --date YYYY-MM-DD --start HH:mm --end HH:mm --title "标题" --subcategory <id>`
- `npm run timeline:write -- --date YYYY-MM-DD --stdin`
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
- 截图回微信统一走 `timeline:screenshot -- --send`

## Diary

- `npm run diary:write -- --section todo --state open --text "内容"`
- `npm run diary:write -- --section todo --state done --text "内容" --timeline-text "HH:mm-HH:mm ..."`
- `npm run diary:write -- --section timeline --text "17:30-17:58 做了什么"`
- `npm run diary:write -- --date 2026-04-06 --section supplement --title "标题" --text "内容"`

约定：

- `todo + done + --timeline-text` 是原子 cutover 写法
- `summary` 主要给 nightly closeout
- `supplement` 用于背景、判断、补充说明，不是第二条 live log

## Durable Notes

- `npm run note:auto -- --project <slug> --kind recent --text "..."`
- `npm run note:auto -- --scope assistant --kind preference --text "..."`
- `npm run note:maybe -- --project <slug>`
- `npm run note:maybe -- --scope assistant --kind preference`
- `npm run note:sync -- --project <slug> --section "最近动作" --text "..."`
- `npm run note:sync -- --path "项目/Codeksei 生活助理/README.md" --section "当前定位" --text "..."`

建议：

- 默认优先 `note:auto`
- 先判断路由时用 `note:maybe`
- 需要定制 section / slot 时再用 `note:sync`

## Reviews

- `npm run review:nightly`
- `npm run review:nightly -- --date 2026-04-10`
- `npm run review:weekly`
- `npm run review:weekly -- --week 2026-W15`
- `npm run review:monthly`
- `npm run review:monthly -- --month 2026-04`

说明：

- 默认走 hybrid review：脚本保骨架，Codex 做结构化语义提炼
- 失败或超时会回退 deterministic
- nightly 是周/月复盘的前置压缩层

## Project Radar

- `npm run project:radar -- --list`
- `npm run project:radar -- --project <slug> --json`

用途：

- 找回 tracked repo 的根目录、workspace note、稳定入口文件
- 看当前 branch、working tree、最近 commits
- 把 git 动作当“最近发生了什么”的弱信号，而不是长期真相

## 兼容细节

- 文档中的 `CODEKSEI_*` 都有 `CYBERBOSS_*` 兼容读取
- 主 bin 是 `codeksei`，旧 `cyberboss` 仍可调用
- 新 managed marker 前缀写成 `codeksei-*`，但旧 `cyberboss-*` marker 仍能继续被读取和更新

## 发布与 CI

发布流程、GitHub Actions 和仓库 slug 迁移约定统一见 [release.md](./release.md)。本页不重复维护第二份说明。
