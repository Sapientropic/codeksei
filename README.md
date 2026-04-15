# Codeksei

<div align="center">
  <p>
    <a href="./README.en.md">English README</a>
  </p>
  <p>
    <a href="https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://www.npmjs.com/package/codeksei"><img alt="npm version" src="https://img.shields.io/npm/v/codeksei"></a>
    <a href="./LICENSE"><img alt="License: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-111111.svg"></a>
  </p>
  <p><a href="https://zread.ai/Sapientropic/codeksei" target="_blank"><img src="https://img.shields.io/badge/Ask_Zread-_.svg?style=for-the-badge&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff" alt="zread"/></a></p>
  <h3>一个会主动照看时间感、帮你把日常和项目线程慢慢接回来的本地优先陪伴者助理</h3>
  <p><strong>以 WeChat 为入口，把 timeline、diary、reminders、reviews 和 project continuity 放进同一条共享线程。</strong></p>
  <p>它不是一个只会等你开口的聊天框。Codeksei 会在合适的时候帮你补记录、接回线索、留提醒、带你重新进入项目，也让你的状态、日志和生活痕迹尽量继续留在本地。</p>
  <p>
    <a href="#try-codeksei">先试试看</a> ·
    <a href="#day-with-codeksei">一天会怎么相处</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#现在可以做什么">当前能力</a> ·
    <a href="#why-the-name">名字寓意</a> ·
    <a href="./docs/commands.md">命令</a> ·
    <a href="./docs/architecture.md">架构</a>
  </p>
</div>

- **它是什么**：以 WeChat 为入口、把日常记录、提醒、复盘和项目连续性接在一起的本地优先 companion
- **它适合谁**：容易时间感松开、项目线程常被打断、想让人替自己照看线头的人
- **你可以先这样试**：`npm install -g codeksei` 先体验基础 CLI；想体验完整形态，可选 `Bridge Mode` 或 `Hermes Hosted Mode`

## Host Modes

Codeksei 现在把自己定义成 **companion/domain layer**，不再默认等于某一个固定 agent 宿主。

- `Bridge Mode`
  现有默认路径：`Codeksei Weixin bridge + Codex runtime`
- `Hermes Hosted Mode`
  Hermes 负责 agent loop 和官方 Weixin；Codeksei 通过 CLI / skill surface 暴露 timeline、diary、reminder、review、note、project radar 等能力

选择建议：

- 如果你想直接复用这个仓库现有的共享线程链路，用 `Bridge Mode`
- 如果你已经在 Hermes 生态里，并且想直接吃 Hermes 官方维护的 Weixin，用 `Hermes Hosted Mode`

<a id="try-codeksei"></a>

## 先试试看

如果你想先判断 Codeksei 是不是你的路子，先走最短路径：

```bash
npm install -g codeksei
codeksei help
codeksei schema
codeksei review weekly --help
```

如果你想直接体验它更完整的样子，有两条官方路径：

### Bridge Mode

让 Codeksei 自己托管 WeChat bridge 和共享线程：

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
npm run login
npm run shared:start
```

### Hermes Hosted Mode

让 Hermes 托管 agent + Weixin，Codeksei 只作为 companion workflow surface：

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
codeksei doctor
codeksei operator hermes install-skill
codeksei operator hermes status
codeksei operator hermes smoke
# 然后再由 Hermes gateway / Weixin 使用
```

- `先试基础 CLI`：看命令面、确认本机环境、感受产品边界
- `需要 bootstrap / operator 命令时`：再用 `codeksei operator help` 或仓库里的 `npm run ...`
- `再进共享模式`：体验它真正的连续性、主动分忧、提醒和项目接续
- `若你已经用 Hermes`：优先直接接 Hermes Hosted Mode，不必再让 Codeksei 重复托管微信桥
- `试完给反馈`：欢迎到 [GitHub Issues](https://github.com/Sapientropic/codeksei/issues) 告诉我们哪里最有用、哪里最别扭、哪里应该更主动或更克制

<a id="day-with-codeksei"></a>

## 一天里，你会这样遇见 Codeksei

- **开始一天时**：你也许只说一句“我现在准备开始了”，或者问“昨天那条线停在哪来着？”。它会把挂着的提醒、最近状态、项目线索和更适合眼前的第一步慢慢接回来，让起步不必从空白和慌乱开始。
- **白天推进中**：你把念头、待办、做完的时间块、突然想到的事丢给它。它会把该留的留下来：有的去 diary，有的钉进 timeline，有的变成提醒，脑子不用一直替未来的自己硬撑记忆。
- **一抬头发现半天过去了**：你问“我刚刚到底干嘛去了？”或者“今天怎么又糊了”。它会把已经发生过的时间块、切换点和留下的线索慢慢钉回时间线，让这一天重新有形。
- **你安静了一阵子**：它不会急着冒出来。它会先掂量现在更适合问一句、跟进一条线、补一条记录、留给未来一个提醒，还是先安静陪着这条线往后走。
- **项目做到一半又切回来**：你只说“继续这条”或者“我现在卡在哪了？”。它会顺着同一条线程、项目脉络和最近动作，把重新进去的入口慢慢接回来。
- **卡住、切换、想躲一下的时候**：你说“我有点散”、“我想逃一下”，或者“我现在不知道先做哪件”。它会帮你把线缩回眼前，留下一步可做的动作，必要时替你补一个提醒或收一个尾。
- **一天要收口的时候**：睡前、出门前、做完一段之后，让它陪你收一下。它会把今天真实发生过的东西压成 timeline、review 和明天更容易接上的入口，让明天回来时，线还在，时间感也还在。

> `主动分忧` 更像一种有人轻轻替你照看着的在场感。
>
> 它会先替你守住时间感、线头和已经发生过的痕迹；该留痕时留痕，该接话时接话，该安静时也会安静。

## 现在可以做什么

- `Timeline`：把已经发生过的时间块、切换点和生活事实钉成时间感与记忆锚点，不让一天只剩模糊印象
- `Diary`：Todo、碎片、补充记录、总结，以及和 timeline 紧密联动的时间线事实，帮你把零散日常慢慢收成可用痕迹
- `Check-ins`：主动唤醒与主动分忧。发一句消息只是其中一种；它也会先回看上下文、整理后台、补一条 diary / timeline、留一个提醒，再决定是不是该主动露个面，并在每次 proactive pass 结束后自己写回下一次何时再醒
- `Check-ins`
  Codeksei 负责生成 proactive trigger、维护 `tick -> ack -> complete` 的调度真相，并在 `checkin-complete` 时写回下一次唤醒；Bridge Mode 下由本地 poller 包装 heartbeat 与入队，Hermes Hosted Mode 下由 Hermes 只持有 one-shot wake/recovery job，真正的下一次唤醒仍由 Codeksei 在 `checkin-complete` 里决定
- `Reminders`：提醒写入与调度，给生活节奏和待办推进一个外部支点
- `Review`：nightly / weekly / monthly，把日常记录压成更稳定的节奏校准与复盘材料
- `Project support`：workspace bootstrap、project radar、按 workspace 恢复共享线程。项目切走再回来时，不用先把整条线在脑子里重建一遍；本地 git 仍是第一真相，只有 repo 缺失或不是 git repo 时才回退到 GitHub activity continuity signal
- `WeChat bridge`
  Bridge Mode 下由 Codeksei 托管；Hermes Hosted Mode 下推荐直接用 Hermes 官方 Weixin
- `Runtime host`
  Bridge Mode 当前默认是 Codex；Hermes Hosted Mode 由 Hermes 自己托管 agent/runtime/审批/模型切换
- `Durable note`：`note:auto`、`note:maybe`、`note:sync`

## 这些人会喜欢它

- 想有人替自己照看琐碎日常、提醒和未收口事项的人
- 有 ADHD 或执行功能摩擦，希望得到持续陪伴和轻推的人
- 希望对方会主动来问、主动跟进，也愿意替你分担一点琐碎的人
- 一天常常糊成一团，事后很难想起自己到底做了什么的人
- 项目一被别的事岔开，再回来就像整条线一起断掉的人
- 想把项目推进、日常记录和复盘整理放进同一条工作流的人
- 想把微信保留成主要交互入口，同时保留本地可控性的人

<a id="why-the-name"></a>

## 为什么叫 Codeksei

<div align="center">
  <p><strong>一个名字，留下两层感觉。</strong></p>
</div>

- `Code`：散落日常里的隐秘书写。那些稍纵即逝的念头、半途停下的线索、以及你本来想记住的生活纹理，都留在这里。
- `-ksei`：取自 `Aleksei` 的后半段。在这里，它借来“守护 / 帮助 / 同行”的意象，像一位安静陪在身边的同行者。

<div align="center">
  <p><em>线索有人照看，离开之后仍能顺着原来的温度回来。</em></p>
</div>

## 快速开始

### CLI contract 速记

- `codeksei help`
  默认只展示 public finite CLI，不再把 shared / maintainer / background 入口混在一起
- `codeksei schema`
  输出当前 public CLI 的结构化 contract，适合 agent / 自动化读取
- `codeksei operator help`
  查看 bootstrap、shared、background、maintainer 这类 operator surface
- `codeksei operator schema`
  输出 operator / bootstrap command surface 的结构化 schema
- 非 TTY 默认 JSON envelope，TTY 默认 text
- `stderr` 留给诊断；`stdout` 留给结果数据
- 统一全局参数：
  `--format json|text`、`--verbose`、`--workspace-root /absolute/path`

### 1. 先选安装方式

如果你想按本文完整使用共享模式，先 clone 仓库，再跑 shared / background 脚本：

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
```

如果你只是想先拿到基础 CLI：

```bash
npm install -g codeksei
codeksei help
codeksei schema
codeksei review weekly --help
```

说明：

- 公共 CLI 示例默认写成 `codeksei ...`
- 只有 shared / background / maintainer 脚本继续写成 `npm run ...`
- 全局安装更适合先体验基础 CLI；共享模式相关脚本在仓库内运行最直接

### 2. 配置最小环境变量

运行时会按“两阶段”补全环境变量：

1. 先保留当前进程里已经存在的环境变量
2. 读取当前项目目录下的 `.env`
3. 再根据这一步已经生效的 `CODEKSEI_STATE_DIR` 重新计算状态目录，并读取该状态目录下的 `.env`

前面的值优先，后面的 `.env` 只补缺省，不会覆盖已经存在的 key。也就是说，如果 repo `.env` 里才定义了 `CODEKSEI_STATE_DIR`，运行时会在读完 repo `.env` 之后，重新定位 state-dir `.env`。

最小可用配置：

```dotenv
CODEKSEI_RUNTIME=codex
CODEKSEI_CHANNEL_PROVIDER=codeksei
CODEKSEI_USER_NAME=你的名字
CODEKSEI_USER_GENDER=female
CODEKSEI_ALLOWED_USER_IDS=桥实际观测到的 sender id
CODEKSEI_WORKSPACE_ROOT=/绝对路径/你的项目目录
```

<details>
<summary>展开常用可选环境变量</summary>

```dotenv
CODEKSEI_ACCOUNT_ID=
CODEKSEI_RUNTIME_ENDPOINT=ws://127.0.0.1:8765
CODEKSEI_RUNTIME_COMMAND=codex
CODEKSEI_HERMES_COMMAND=hermes
CODEKSEI_REVIEW_SEMANTIC_HOST=auto
CODEKSEI_CODEX_ENDPOINT=ws://127.0.0.1:8765
CODEKSEI_WEIXIN_ADAPTER=v2
CODEKSEI_WEIXIN_REPLY_MODE=stream
CODEKSEI_WEIXIN_ROUTE_TAG=
CODEKSEI_WEIXIN_PROTOCOL_CLIENT_VERSION=2.1.1
CODEKSEI_TIMEZONE=Asia/Shanghai
CODEKSEI_TIMELINE_LOCALE=zh-CN
CODEKSEI_DIARY_DIR=/绝对路径/你的 vault/日记
CODEKSEI_TIMELINE_STATE_DIR=/绝对路径/你的 vault/.codex/timeline
CODEKSEI_WORKSPACE_BOOTSTRAP_CONFIG=/绝对路径/你的 workspace-bootstrap.json
CODEKSEI_PROJECT_RADAR_CONFIG=/绝对路径/你的 workspace/.codex/code-projects.json
CODEKSEI_DURABLE_NOTE_SCHEMA_CONFIG=/绝对路径/你的 workspace/.codex/durable-note-schema.json
CODEKSEI_REVIEW_SCHEMA_CONFIG=/绝对路径/你的 workspace/.codex/review-schema.json
CODEKSEI_SHARED_USE_BUNDLED_CODEX_BINARY=1
CODEKSEI_SHARED_DISABLE_PLUGINS=0
CODEKSEI_SHARED_DISABLE_SHELL_SNAPSHOT=0
```

</details>

说明：

- `CODEKSEI_WEIXIN_REPLY_MODE=stream` 现在表示“半实时增量流”：会按小窗口持续发送用户可见增量，保留段落结构，可读性优先于减少气泡数量
- `CODEKSEI_WEIXIN_REPLY_MODE=stream` 现在更接近 hybrid stream：优先在自然句边界或已完成块发送，避免把半句 final 提前裂成多个微信气泡
- `CODEKSEI_WEIXIN_REPLY_MODE=settled` 仍表示“等整轮收口后再发”：只发送最新的可见最终回复
- `CODEKSEI_RUNTIME` / `CODEKSEI_CHANNEL_PROVIDER` 决定当前是 `Bridge Mode` 还是 `Hermes Hosted Mode`
- `CODEKSEI_RUNTIME_ENDPOINT` / `CODEKSEI_RUNTIME_COMMAND` 是新的 host-neutral runtime 入口；旧的 `CODEKSEI_CODEX_*` 变量仍保留兼容
- `CODEKSEI_REVIEW_SEMANTIC_HOST=auto|codex|hermes|deterministic` 可显式指定 review hybrid 语义宿主；默认 `auto`
- `CODEKSEI_USER_NAME` 决定对话里怎么称呼你，不参与消息路由
- `CODEKSEI_ALLOWED_USER_IDS` 必须填写微信桥实际观测到的 sender id；最简单的做法是先跑 `codeksei accounts`，如果你当前就在仓库工作树里，也可以直接用 `npm run accounts`
- 微信 persona / continuity instructions 默认来自仓库里的 `templates/weixin-instructions.md`，如需本地覆盖可在状态目录放 `weixin-instructions.local.md`
- 如果你在共享模式下使用多 workspace，建议启动前就设置好 `CODEKSEI_WORKSPACE_ROOT`
- `CODEKSEI_TIMEZONE` 可选；若显式设置，它会统一驱动 reminder / diary / review / timeline 的本地时间解释
- `CODEKSEI_TIMELINE_LOCALE` 可选；当前用于 timeline dashboard 的文案、日期格式和 demo data 语言切换，支持 `zh-CN` 与 `en`
- `CODEKSEI_HERMES_REPO_ROOT` 可选；Hermes Hosted Mode 下若 sibling `../hermes-agent` 不成立，用它显式指向 repo-local upstream checkout
- 如果不设 `CODEKSEI_TIMEZONE`，Codeksei 会优先沿用 timeline state 里已声明的非 legacy timezone；否则回退到系统时区
- 旧的 `Asia/Shanghai` legacy timeline state 在需要时会在下一次 timeline 命令时自动迁移到当前统一 timezone
- `CODEKSEI_TIMELINE_STATE_DIR` 默认指向 Codeksei timeline 数据根；当前主布局会在它下面使用 `timeline/*.json`
- 运行时的 `.env` 读取是刻意设计成“两阶段”：先读 repo `.env`，再根据新得到的 `CODEKSEI_STATE_DIR` 重新定位并补读 state-dir `.env`；这也是 `dotenv` 目前仍保留在 runtime dependency 的原因
- `.env` 只应放在你的本地工作目录或状态目录里，不要提交进仓库

### 3. 选择运行模式

#### Bridge Mode

Codeksei 自己负责 Weixin bridge 和共享线程。

#### Hermes Hosted Mode

不要执行 `codeksei start` 或 `npm run shared:*`。

- 由 Hermes 负责 gateway / agent loop / Weixin
- 由 Codeksei CLI + 官方受管的 Hermes skill 提供 companion workflows
- `channel send-file`、`timeline screenshot --send`、`reminder write` 现在会走 Hermes repo-local shim；`system send` 仍保持 blocked，因为还没有 source-backed backstage-only host primitive
- 主动 checkin 由 Hermes 执行 one-shot wake/recovery job；Codeksei 提供 `system checkin-trigger` / `system checkin-tick` / `system checkin-complete` 维护 `tick -> ack -> complete` 的调度真相，并通过 `operator hermes sync-checkin` 把下一次 one-shot wake 重新 arm 回 Hermes
- `sync-checkin` 创建/更新 job 时才需要 origin context；真正 cron 裸跑时，Hermes 直接按持久化的 `job.origin` 投递，不再反查 live session
- 若 sibling checkout 不在默认位置，可显式设置 `CODEKSEI_HERMES_REPO_ROOT`；`codeksei operator hermes status` / `smoke` 会把 repo-local readiness 和 commit 打出来
- 可先用 `codeksei operator hermes --help` 或 `codeksei operator schema operator hermes` 看 4 个 leaf action
- 推荐先执行：
  `codeksei operator hermes install-skill`
  `codeksei operator hermes sync-checkin --user <wechat_user_id> --workspace /absolute/workspace`
  `codeksei operator hermes status`
  `codeksei operator hermes smoke`

### 4. Bridge Mode 扫码登录

```bash
npm run login
```

### 5. Bridge Mode 拉起共享模式

共享模式更适合日常使用：微信和终端会接到同一条共享线程。

```bash
npm run shared:start
```

接入当前微信绑定的共享线程：

```bash
npm run shared:open
```

查看状态：

```bash
npm run shared:status
```

如果当前配置是 Hermes Hosted Mode，这几条 shared 命令会明确提示“改用 Hermes gateway”，不会偷偷回退到 Codex app-server。

### 6. Windows 后台常驻

如果你希望登录后自动拉起，并在解锁或恢复睡眠后快速自愈：

```powershell
npm run background:install
```

卸载：

```powershell
npm run background:uninstall
```

## 常用命令

先记住这一小组就够用：

终端：

```bash
codeksei login
codeksei accounts
codeksei doctor
codeksei help
```

终端（仓库 shared 脚本）：

```bash
npm run shared:start
npm run shared:open
npm run shared:status
```

微信：

```text
/bind /绝对路径
/status
/new
/reread
/switch <threadId>
/stop
/yes
/always
/no
/model
/model <id> [effort]
/effort
/effort <level>
/checkin
/checkin <min>-<max>
/checkin reset
/help
```

终端：

```bash
codeksei system checkin --show
codeksei system checkin --range 3-60
codeksei system checkin --reset
codeksei system checkin-trigger --user <wechat_user_id> --workspace /absolute/workspace
codeksei system checkin-tick --user <wechat_user_id> --workspace /absolute/workspace
codeksei system checkin-tick --user <wechat_user_id> --workspace /absolute/workspace --ack <triggerId>
codeksei system checkin-complete --user <wechat_user_id> --workspace /absolute/workspace --trigger <triggerId> --result silent --sleep-for 6h
codeksei operator hermes sync-checkin --user <wechat_user_id> --workspace /absolute/workspace
```

更完整的命令与架构说明见：

- [docs/commands.md](./docs/commands.md)
- [docs/timeline-integration.md](./docs/timeline-integration.md)
- [docs/architecture.md](./docs/architecture.md)

如果你在维护这个仓库，当前质量门分工是：

- `npm run check`：只跑 source-level guard、typecheck 和 tests TS typecheck，不会刷新 `dist/`
- `npm run coverage:critical`：只对关键 owner 集跑 coverage gate，目前覆盖 `config`、`weixin delivery text`、`runtime turn` 与 `stream delivery`；这是 `verify` 层，不进入 `check`
- `npm run verify`：在 `check` 与 `coverage:critical` 之后显式 `build`，再跑 built-runtime tests 和 `npm run pack:dry-run`
- `npm run build`：只在你明确要刷新 published runtime artifacts 时运行

这条分工是刻意收口的：以后不要再依赖 `prepare` 或 `npm pack` 的隐式 lifecycle 去偷偷帮你 build。

依赖与工具链方面，当前仓库也有两条刻意保留的决定：

- `playwright-core` 继续是 runtime dependency，因为 `timeline screenshot` 是公开运行时能力，不只是维护者脚本；浏览器查找顺序是 `CODEKSEI_SCREENSHOT_CHROME_PATH` -> Playwright managed browser path -> 系统 Chrome/Chromium/Edge
- `check` 继续以 repo-specific AST/type guards 为 canonical lint truth；这轮没有额外引入 Prettier 或 whole-repo ESLint gate

如果你是第一次读这个仓库的代码结构，先看 `docs/architecture.md`，再进具体目录会更快。

## 本地数据与公开边界

当前默认状态目录是：

```text
~/.codeksei
```

常见运行态内容包括：

- `accounts/`
- `sessions.json`
- `sync-buffers/`
- `weixin-instructions.local.md`
- `weixin-operations.local.md`
- `workspace-bootstrap.json`
- `reminder-queue.json`
- `system-message-queue.json`
- `system-message-dead-letter.json`
- `timeline-screenshot-queue.json`
- `diary/`
- `timeline/`
- `logs/`

连续性关键的状态文件目前包括 `sessions.json`、`reminder-queue.json`、`system-message-queue.json`、`timeline-screenshot-queue.json`。这几类文件现在会走原子写；如果 JSON 可读但关键 schema 已坏、或者文件本身损坏，运行时会把原文件隔离成 `*.corrupt-<timestamp>.json` 再回到空默认状态继续启动。

如果你单独设置了 `CODEKSEI_DIARY_DIR` 或 `CODEKSEI_TIMELINE_STATE_DIR`，真正的数据会写到你指定的位置，状态目录只保留运行态文件。

默认 persona / operations 模板继续跟仓库一起发布在 `templates/`；状态目录里的 `*.local.md` 只负责你本机的 overlay，不再充当唯一真相源。

这个仓库和 npm 包默认只放代码、脚本、模板与文档，不应包含你的账号、会话、日志、个人 `.env` 或本地业务数据。

## Upstream Acknowledgement

感谢原仓 [`WenXiaoWendy/cyberboss`](https://github.com/WenXiaoWendy/cyberboss) 的开源。  
Codeksei 从那里长出来，也感谢这份开源起点。

## FAQ

### 可以直接 `npm install -g codeksei` 吗？

可以。
如果你只想先拿到基础 CLI，这是最短路径；如果你要按本 README 跑完整共享模式、调试共享桥接脚本或直接改仓库源码，clone 仓库会更顺手。

### 共享模式和 `npm run start` 有什么区别？

`npm run start` / `npm run start:checkin` 更适合最小链路调试。  
日常使用、微信与终端共用同一条线程、后台自愈和多窗口接管，默认都应走共享模式。

## License

本项目采用 `AGPL-3.0-only`。  
如果你基于本项目修改、扩展并通过网络向他人提供服务，需要按照 AGPL 的要求向对应用户提供完整的对应源代码。
