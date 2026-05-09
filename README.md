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
  <p><strong>把 timeline、diary、reminders、reviews 和 project continuity 收口进同一个本地优先 companion core，再按需要挂到不同宿主桥上。</strong></p>
  <p>它不是一个只会等你开口的聊天框，也不是另一套 agent runtime。Codeksei 会在合适的时候帮你补记录、接回线索、留提醒、带你重新进入项目，也让你的状态、日志和生活痕迹尽量继续留在本地。WeChat 现在只是一个 first-party adapter，不再是唯一正门。</p>
  <p>
    <a href="#agent-quickstart">给 Agent</a> ·
    <a href="#setup">SETUP</a> ·
    <a href="#mode-specific-bring-up">模式化拉起</a> ·
    <a href="#day-with-codeksei">一天会怎么相处</a> ·
    <a href="#现在可以做什么">当前能力</a> ·
    <a href="#why-the-name">名字寓意</a> ·
    <a href="./CHANGELOG.md">更新日志</a> ·
    <a href="./docs/commands.md">命令</a> ·
    <a href="./docs/architecture.md">架构</a>
  </p>
</div>

- **它是什么**：一个本地优先、`daemon-first / host-attachable` 的 companion engine；对用户是陪伴型助理，对宿主是可附着的领域层
- **CLI contract**：`codeksei help`、`codeksei schema`、`codeksei host manifest` 是默认 discovery 面；非 TTY 默认 JSON，`stdout` 留给结果，`stderr` 留给诊断
- **推荐开始方式**：先做通用 `SETUP`，再按 `Codex Mode`、`Claude Code Mode` 或 `Hosted Mode` 分流

<a id="agent-quickstart"></a>

## 给 Agent

如果你是外部 agent，不要先读长 README prose 再猜内部 seam。当前推荐入口是：

1. 先读 repo 根的 `CODEKSEI_HOSTKIT.json`
2. 把 README 当成人类说明，把 `HOSTKIT + codeksei host manifest/bootstrap/doctor/smoke` 当机器入口
3. 先明确宿主路径：`Codex Mode` 用 `--provider codex`，`Claude Code Mode` 用 `--provider claudecode`，`Hosted Mode` 用 `--provider hermes`
4. 把 `host bootstrap` 理解成“Codeksei attach/bootstrap 完成”，不要误读成 “宿主 gateway / Weixin live bring-up 已完成”

- `CODEKSEI_HOSTKIT.json` 现在也会带最小 entrypoint/workflow hints，足够让新 host 知道 onboarding / companion memory / context briefing / context inspect / capabilities status / pulse / diary / timeline / review / note / reminder 的默认路由；`codeksei host manifest --provider codex|claudecode|hermes` 可按 provider 视角查看入口，当前环境真相统一看 `codeksei host doctor --provider <provider>`

推荐顺序：

```bash
npx -y codeksei@latest host manifest
npx -y codeksei@latest host bootstrap --provider codex
npx -y codeksei@latest host doctor --provider codex
npx -y codeksei@latest host smoke --provider codex
npx -y codeksei@latest host bootstrap --provider hermes
npx -y codeksei@latest host doctor --provider hermes
npx -y codeksei@latest host smoke --provider hermes
```

- `operator hermes *` 继续保留为兼容入口，不是新的主入口
- `README` 负责人类 onboarding；真正的机器合同在 `CODEKSEI_HOSTKIT.json`、`codeksei host manifest` 和 public CLI schema

## Host Modes

Codeksei 现在把自己定义成 **daemon-first / host-attachable / companion engine**，不再默认等于某一个固定 agent 宿主。

- `Codex Mode`
  `provider=codex`：`Codeksei first-party Weixin adapter + Codex runtime`，Codeksei 自己持有 bootstrap / doctor / smoke / bridge lifecycle
- `Claude Code Mode`
  `provider=claudecode`：`Codeksei first-party Weixin adapter + Claude Code runtime`，Codeksei 自己持有 bridge lifecycle，runtime 由 Claude Code CLI 子进程按 workspace 管理
- `Hosted Mode`
  `provider=hermes`：Hermes 负责 agent loop 和宿主侧消息面；Codeksei 通过 CLI / skill surface 暴露 timeline、diary、reminder、review、note、project radar 等能力
- `主动性判断上下文层`
  Hosted proactive wake 默认读 Codeksei 自己维护的 context board。它由 checkin state、当日日记、companion note、project radar 和 workspace continuity 聚合而成，再由 Hermes cron `script` 在运行前注入，不要求用户必须维护 Obsidian/vault
- `治理与策展层`
  `capabilities status` 区分“已配置”和“当前可用”；`context inspect` 解释本轮上下文装配；`pulse today/generate/feedback` 提供最多三张每日可继续推进的用户可见卡片，不自动改变 proactive schedule
- 外部宿主默认通过 `host attachment contract` 接入：
  `codeksei host manifest`、`codeksei host bootstrap`、`codeksei host doctor`、`codeksei host smoke`、`codeksei host seed-proactive`、`codeksei host claim-checkin`、`codeksei host settle-checkin`、`codeksei host finalize-checkin`

<a id="setup"></a>

## SETUP

这块只负责通用安装、发现 contract、验证 CLI 正常，不预设你必须先选 `Codex Mode` 或 `Hosted Mode`。

### 通用前提

- `Node.js >= 22`
- repo 根默认机器入口：`CODEKSEI_HOSTKIT.json`
- canonical host config 文件名：`codeksei.config.json`

### 安装路径

1. 不落本地全局状态，直接临时运行：

```bash
npx -y codeksei@latest
```

2. 想先拿到全局 CLI：

```bash
npm install -g codeksei
```

3. 想看源码、脚本、模板和完整仓库文档：

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
```

### 最小验证

安装完成后，先确认 CLI 和机器合同都可发现：

```bash
codeksei help
codeksei schema
codeksei host manifest
codeksei capabilities status
```

如果你走的是 `npx` 路径，没有全局 `codeksei` 可执行名，就把同样的子命令挂到 `npx -y codeksei@latest` 后面执行。

### SETUP 的边界

- 这一步成功只代表 CLI、public schema、host attachment contract / hostkit 可发现
- 这一步不代表 `Codex Mode` / `Claude Code Mode` 已扫码登录
- 这一步也不代表 `Hosted Mode` 已 live attach 到 Hermes gateway / 宿主桥
- 这一步更不代表提醒、check-in、repo-local shim 或 hosted send-back 已全部就绪

<a id="mode-specific-bring-up"></a>

## 模式化拉起

`SETUP` 完成后，再按实际使用方式分流。

### Codex Mode

适合你想直接复用这个仓库现有的共享线程链路时。

拉起顺序：

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
codeksei host bootstrap --provider codex
codeksei host doctor --provider codex
codeksei host smoke --provider codex
npm run login
npm run shared:start
```

补充：

- Codex Mode 的 first-party Weixin adapter 默认协议版本会跟随腾讯官方包 `@tencent-weixin/openclaw-weixin@2.1.8`
- `host bootstrap --provider codex` 会写入 `modeClass=codex-managed`、`runtimeProvider=codex`、`runtimeOwner=codeksei`、`channelProvider=codeksei`、`deliveryRecipe=codeksei-weixin-bridge`
- 海外 / 国际版 WeChat 当前仍可能受官方地域灰度限制；如果手机扫码直接报网络问题，优先核对账号与客户端资格

常见后续命令：

```bash
npm run shared:open
npm run shared:status
```

### Claude Code Mode

适合你想复用 Codeksei 的微信桥、线程绑定和审批流程，但把 runtime 切到 Claude Code CLI 时。

拉起顺序：

```bash
codeksei host manifest --provider claudecode
codeksei host bootstrap --provider claudecode --workspace /absolute/path/to/workspace
codeksei host doctor --provider claudecode
CODEKSEI_RUNTIME=claudecode npm run shared:start
```

补充：

- `host bootstrap --provider claudecode` 会写入 `modeClass=claudecode-managed`、`runtimeProvider=claudecode`、`runtimeOwner=codeksei`、`channelProvider=codeksei`、`deliveryRecipe=codeksei-weixin-bridge`
- `CODEKSEI_CLAUDE_COMMAND` 默认回退 `CODEKSEI_RUNTIME_COMMAND`，再回退 `claude`
- `shared:start` 只启动 Codeksei bridge，不启动 `codex app-server`
- `shared:open` 只支持 Codex desktop attach；Claude Code Mode 下会明确返回不可用
- Codeksei Tools MCP 是显式 opt-in；默认用 `codeksei tool mcp-bootstrap --scope local` 预览或安装，不会默认写 workspace `.mcp.json`

Claude Code 需要调用 Codeksei 的 context、timeline、diary、note、reminder 等能力时，再显式安装 MCP：

```bash
codeksei tool mcp-bootstrap --scope local --workspace-root /absolute/path/to/workspace
codeksei tool mcp-bootstrap --scope local --toolset companion --install --workspace-root /absolute/path/to/workspace
```

`--scope project --install` 会写项目级 `.mcp.json`，必须额外传 `--allow-project-config`。`claude mcp serve` 是把 Claude Code 暴露给其他 MCP client，不是 Codeksei Tools MCP server。

### Hosted Mode

适合你已经有 Hermes runtime / gateway / 官方 Weixin，希望 Codeksei 只作为 companion workflow surface 接入时。

推荐顺序：

```bash
codeksei host manifest --provider codex
codeksei host bootstrap --provider codex
codeksei host doctor --provider codex
codeksei host smoke --provider codex
codeksei host manifest --provider hermes
codeksei host bootstrap --provider hermes
codeksei host doctor --provider hermes
codeksei host smoke --provider hermes
```

边界说明：

- `host manifest -> bootstrap -> doctor -> smoke` 是当前主入口
- `operator hermes *` 是兼容入口，不是新的主入口
- `host bootstrap` 只代表 Codeksei attach/bootstrap 完成，不等于 Hermes gateway / Weixin live bring-up 完成
- live gateway、官方 Weixin、审批和 runtime loop 仍由 Hermes 自己托管
- 外部 agent 不应从 README prose 猜内部 TypeScript seam，而应通过 host attachment contract 接入

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
- `Check-ins`：主动唤醒与主动分忧。发一句消息只是其中一种；它也会先回看上下文、整理后台、补一条 diary / timeline、留一个提醒，再决定是不是该主动露个面。Codeksei 负责生成 proactive trigger、维护 `tick -> ack -> complete` 的调度真相，并在 `checkin-complete` 时写回下一次唤醒；first-party bridge modes 下由本地 poller 包装 heartbeat 与入队，Hosted Mode 下由 Hermes 只执行受控 wake/recovery/guard job set，真正的下一次唤醒仍由 Codeksei 在 `checkin-complete` 里决定
- `Onboarding`：首次激活不走表单，而是走聊天式访谈。长期真相写进 companion note，再由 context board 投影给宿主；没有 Obsidian / workspace schema 时也能自动回退到本地 state-dir 下的 companion profile
- `Companion memory`：首访之后也会继续更新。只要用户新的自述、纠正、支持偏好、边界或近线任务会影响后续陪伴判断，就可以走 `companion remember` 这条 ongoing memory 主链，而不是把变化只留在宿主聊天记忆里
- `Context board`：主动判断用的受控上下文层。它把 checkin state、今天事实、活跃线头、注意事项和重入入口收口到一份 prompt-ready briefing；Hosted Mode 下每次 cron 运行前都会现读最新 board，而不是盲扫原始 vault 文件
- `Whereabouts`：本地位置语义层。事件落在 `CODEKSEI_STATE_DIR/whereabouts/`，再由 context inspect、Pulse 和 proactive 只消费“在家 / 在外 / 低电 / 刚移动过”这类粗粒度摘要，不把裸坐标带到用户可见面
- `Capability governance`：解释每个入口是“已配置、可用、降级还是阻断”，并给出 host profile、前置条件、side effect 与不可用原因
- `Context inspector`：在 context board 之上解释本轮上下文装配来源、排除项、stale 标记、pending handoff 和 context packs，不新增事实来源
- `Codeksei Pulse`：每日最多三张可继续推进的策展卡，默认 deterministic-first，读本地状态和反馈；like/save 会提高同主题后续候选分数，不自动推送微信，也不改变 proactive schedule
- `Reminders`：提醒写入与调度，给生活节奏和待办推进一个外部支点。Hosted Mode 下默认会把用户可见提醒绑定回当前 origin chat；未来 proactive 唤醒统一走 hosted check-in 主链
- `Review`：nightly / weekly / monthly，把日常记录压成更稳定的节奏校准与复盘材料
- `Project support`：workspace bootstrap、project radar、按 workspace 恢复共享线程。项目切走再回来时，不用先把整条线在脑子里重建一遍；本地 git 仍是第一真相，只有 repo 缺失或不是 git repo 时才回退到 GitHub activity continuity signal
- `WeChat bridge`
  Codex Mode / Claude Code Mode 下由 Codeksei 托管；Hosted Mode 下推荐直接用宿主自己的桥接能力
- `Runtime host`
  Codex Mode 默认是 Codex；Claude Code Mode 使用 Claude Code CLI；Hosted Mode 由宿主自己托管 agent/runtime/审批/模型切换
- `Durable note`：`note:auto`、`note:maybe`、`note:sync`

## 这些人会喜欢它

- 第一阶段更可信的用户是：时间感容易松开、项目线程经常被打断、愿意让系统替自己维护连续性的人。
- `非技术家人` 仍是重要方向，但当前更适合作为第二阶段分发压力测试，而不是首页第一用户群。
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

## CLI contract 速记

- `codeksei help`
  默认只展示 public finite CLI，不再把 shared / maintainer / background 入口混在一起
- `codeksei schema`
  输出当前 public CLI 的结构化 contract，适合 agent / 自动化读取
- `codeksei host manifest`
  输出 host attachment manifest / hostkit 机器入口
- `codeksei host doctor`
  查看 daemon / attachment / provider recipe readiness
- `codeksei capabilities status`
  查看当前 command surface 在当前 host/session 下哪些能力可用、降级或阻断
- `codeksei context inspect`
  解释 context board 本轮读入/排除的来源和 pending handoff
- `codeksei pulse today`
  查看或生成今天最多三张可继续推进的 Pulse 卡
- `codeksei operator help`
  查看 bootstrap、shared、background、maintainer 这类 operator surface
- `codeksei operator schema`
  输出 operator / bootstrap command surface 的结构化 schema
- 非 TTY 默认 JSON envelope，TTY 默认 text
- `stderr` 留给诊断；`stdout` 留给结果数据
- 统一全局参数：
  `--format json|text`、`--locale zh-CN|en`、`--verbose`、`--workspace-root /absolute/path`

## First-Party Bridge 运行时配置

Codex Mode / Claude Code Mode 都按“两阶段”补全环境变量：

1. 先保留当前进程里已经存在的环境变量
2. 读取当前项目目录下的 `.env`
3. 再根据这一步已经生效的 `CODEKSEI_STATE_DIR` 重新计算状态目录，并读取该状态目录下的 `.env`

前面的值优先，后面的 `.env` 只补缺省，不会覆盖已经存在的 key。也就是说，如果 repo `.env` 里才定义了 `CODEKSEI_STATE_DIR`，运行时会在读完 repo `.env` 之后，重新定位 state-dir `.env`。

<details>
<summary>展开常用可选环境变量</summary>

```dotenv
CODEKSEI_ACCOUNT_ID=
CODEKSEI_RUNTIME=codex
CODEKSEI_RUNTIME_ENDPOINT=ws://127.0.0.1:8765
CODEKSEI_RUNTIME_COMMAND=codex
CODEKSEI_CLAUDE_COMMAND=claude
CODEKSEI_CLAUDE_MODEL=
CODEKSEI_CLAUDE_PERMISSION_MODE=
CODEKSEI_CLAUDE_DISABLE_VERBOSE=
CODEKSEI_CLAUDE_EXTRA_ARGS=
CODEKSEI_CLAUDE_CONTEXT_WINDOW=
CODEKSEI_CLAUDE_MAX_OUTPUT_TOKENS=
CODEKSEI_CLAUDE_MCP_CONFIG=
CODEKSEI_CLAUDE_STRICT_MCP_CONFIG=0
CODEKSEI_HERMES_COMMAND=hermes
CODEKSEI_REVIEW_SEMANTIC_HOST=auto
CODEKSEI_COMPANION_SEMANTIC_HOST=
CODEKSEI_COMPANION_SEMANTIC_MODEL=
CODEKSEI_COMPANION_SEMANTIC_TIMEOUT_MS=15000
CODEKSEI_ONBOARDING_SEMANTIC_HOST=
CODEKSEI_ONBOARDING_SEMANTIC_MODEL=
CODEKSEI_ONBOARDING_SEMANTIC_TIMEOUT_MS=15000
CODEKSEI_PROACTIVE_JUDGMENT_MODE=hybrid
CODEKSEI_PROACTIVE_JUDGMENT_HOST=auto
CODEKSEI_PROACTIVE_JUDGMENT_ENDPOINT=http://127.0.0.1:11434/v1
CODEKSEI_PROACTIVE_JUDGMENT_API_KEY=
CODEKSEI_PROACTIVE_JUDGMENT_MODEL=qwen3.5:2b
CODEKSEI_PROACTIVE_JUDGMENT_TIMEOUT_MS=2500
CODEKSEI_PROACTIVE_JUDGMENT_MIN_CONFIDENCE=0.62
CODEKSEI_PROACTIVE_OBSERVATION_MODE=hybrid
CODEKSEI_PROACTIVE_OBSERVATION_HOST=auto
CODEKSEI_PROACTIVE_OBSERVATION_ENDPOINT=http://127.0.0.1:8080/v1
CODEKSEI_PROACTIVE_OBSERVATION_API_KEY=
CODEKSEI_PROACTIVE_OBSERVATION_MODEL=gemma-4-E2B-it
CODEKSEI_PROACTIVE_OBSERVATION_TIMEOUT_MS=8000
CODEKSEI_PROACTIVE_OBSERVATION_MIN_CONFIDENCE=0.55
CODEKSEI_WHEREABOUTS_HOST=127.0.0.1
CODEKSEI_WHEREABOUTS_PORT=4318
CODEKSEI_WHEREABOUTS_TOKEN=
CODEKSEI_WHEREABOUTS_RETENTION_DAYS=30
CODEKSEI_WHEREABOUTS_PLACES_FILE=/绝对路径/places.json
CODEKSEI_CODEX_ENDPOINT=ws://127.0.0.1:8765
CODEKSEI_WEIXIN_REPLY_MODE=stream
CODEKSEI_WEIXIN_MIN_CHUNK_CHARS=80
CODEKSEI_WEIXIN_ROUTE_TAG=
CODEKSEI_WEIXIN_PROTOCOL_CLIENT_VERSION=2.1.8
CODEKSEI_TIMEZONE=Asia/Shanghai
CODEKSEI_LOCALE=zh-CN
CODEKSEI_TIMELINE_LOCALE=zh-CN
CODEKSEI_DIARY_DIR=/绝对路径/你的 vault/日记
CODEKSEI_TIMELINE_STATE_DIR=/绝对路径/你的 Codeksei 状态根
CODEKSEI_WORKSPACE_BOOTSTRAP_CONFIG=/绝对路径/你的 workspace-bootstrap.json
CODEKSEI_PROJECT_RADAR_CONFIG=/绝对路径/你的 workspace/.codeksei/code-projects.json
CODEKSEI_DURABLE_NOTE_SCHEMA_CONFIG=/绝对路径/你的 workspace/.codeksei/durable-note-schema.json
CODEKSEI_REVIEW_SCHEMA_CONFIG=/绝对路径/你的 workspace/.codeksei/review-schema.json
CODEKSEI_SHARED_USE_BUNDLED_CODEX_BINARY=1
CODEKSEI_SHARED_DISABLE_PLUGINS=0
CODEKSEI_SHARED_DISABLE_SHELL_SNAPSHOT=0
```

</details>

说明：

- `CODEKSEI_WEIXIN_REPLY_MODE=stream` 现在更接近 hybrid stream：优先在自然句边界或已完成块发送，避免把半句 final 提前裂成多个微信气泡
- `CODEKSEI_WEIXIN_REPLY_MODE=settled` 仍表示“等整轮收口后再发”：只发送最新的可见最终回复
- `CODEKSEI_WEIXIN_MIN_CHUNK_CHARS` 控制微信短片段合并阈值；`CODEKSEI_WEIXIN_PAGE_MODE=auto|off` 与 `CODEKSEI_WEIXIN_PAGE_CHARS=600-2000` 控制长回复翻页。运行中也可以用 `/reply mode ...`、`/reply merge ...`、`/reply page ...` 写入持久覆盖，`/reply reset` 会回到 env / default
- 微信桥的正式 adapter 现在只保留 `v2`；issue #4 对应的媒体上传缺口只作为内部 legacy media fallback 处理，不再通过第二个 public adapter 暴露
- `CODEKSEI_WEIXIN_PROTOCOL_CLIENT_VERSION` 默认跟随腾讯官方包 `@tencent-weixin/openclaw-weixin@2.1.8`；只有在有 source-backed 上游变更或兼容性回退证据时才建议手动覆盖
- 国际版 / 海外 WeChat 扫码登录当前仍可能受官方地域灰度限制；腾讯公开资料提到香港地域已支持，其它地域仍在逐步开放
- `CODEKSEI_RUNTIME` / `CODEKSEI_CHANNEL_PROVIDER` 决定当前是 `Codex Mode`、`Claude Code Mode` 还是 `Hosted Mode`
- `CODEKSEI_RUNTIME_ENDPOINT` / `CODEKSEI_RUNTIME_COMMAND` 是新的 host-neutral runtime 入口；旧的 `CODEKSEI_CODEX_*` 变量仍保留兼容
- `CODEKSEI_CLAUDE_*` 只在 `CODEKSEI_RUNTIME=claudecode` 时生效；`CODEKSEI_CLAUDE_MAX_OUTPUT_TOKENS` 会兼容读取官方 `CLAUDE_CODE_MAX_OUTPUT_TOKENS`
- `CODEKSEI_CLAUDE_MCP_CONFIG` 可传一个或多个 Claude MCP config 路径，逗号或分号分隔；只有显式设 `CODEKSEI_CLAUDE_STRICT_MCP_CONFIG=1` 才会传 `--strict-mcp-config`
- `CODEKSEI_REVIEW_SEMANTIC_HOST=auto|codex|hermes|deterministic` 可显式指定 review hybrid 语义宿主；默认 `auto`
- `CODEKSEI_COMPANION_SEMANTIC_HOST=auto|codex|hermes|deterministic` 可为 ongoing companion memory 抽取单独指定宿主；留空时沿用默认 host 决策
- `CODEKSEI_COMPANION_SEMANTIC_MODEL` 可给 ongoing companion memory 抽取单独指定低成本模型
- `CODEKSEI_COMPANION_SEMANTIC_TIMEOUT_MS` 默认 `15000`，超时会自动退回 deterministic 提炼，避免宿主被后台记忆更新拖住
- `CODEKSEI_ONBOARDING_SEMANTIC_HOST=auto|codex|hermes|deterministic` 可为 onboarding 隐藏抽取单独指定宿主；留空时沿用默认 host 决策
- `CODEKSEI_ONBOARDING_SEMANTIC_MODEL` 可给 onboarding 隐藏抽取单独指定低成本模型
- `CODEKSEI_ONBOARDING_SEMANTIC_TIMEOUT_MS` 默认 `15000`，超时会自动退回 deterministic 抽取，避免激活访谈把用户晾住
- `CODEKSEI_PROACTIVE_JUDGMENT_HOST=auto|local|openai-compatible|codex|hermes|deterministic` 控制主动判断语义宿主；默认 `auto`，优先尝试 OpenAI-compatible 本地/云端 endpoint，失败退回 deterministic
- `CODEKSEI_PROACTIVE_JUDGMENT_ENDPOINT` 默认 `http://127.0.0.1:11434/v1`，可接 Ollama / LM Studio / llama.cpp server / vLLM / SGLang 或云端 OpenAI-compatible API
- `CODEKSEI_PROACTIVE_JUDGMENT_MODEL` 默认 `qwen3.5:2b`，只是推荐默认，不把 Codeksei 绑到具体模型
- `CODEKSEI_PROACTIVE_JUDGMENT_TIMEOUT_MS` 默认 `2500`，`CODEKSEI_PROACTIVE_JUDGMENT_MIN_CONFIDENCE` 默认 `0.62`；超时、低置信或 JSON 非法都会回退 deterministic
- `CODEKSEI_PROACTIVE_OBSERVATION_*` 是主动判断前的小模型观察层。它只生成 `ProactiveObservation`，不接管投递、调度真相，也不自动写 companion memory
- `CODEKSEI_WHEREABOUTS_*` 是本地位置语义层：`serve` 默认只监听 `127.0.0.1`，并要求 Bearer token；context / pulse / proactive 只消费 coarse summary，不消费裸坐标
- observation 的 `sourceHash` 来自脱敏后的 observation source pack：checkin 摘要、context briefing、recent outcomes、deterministic stateCard、timezone、voice signal 和 target hash；不包含模型输出，也不包含 observation 回写后的 board，避免 stateCard / observation 循环依赖
- observation 同时记录 `confidence` 与 `usable/discardReason`：低置信或缺证据的 observation 可以留在 eval/diagnostics 里，但不会进入 `ProactiveDecision`
- `codeksei proactive observe --user <id> --workspace <path>` 会生成并缓存 latest observation；`--dry-run` 不写 observation store；`--show` 只读 latest、sourceHash、expired、usable 状态，不触发模型调用。输出格式继续用全局 `--format json|text`
- `codeksei proactive eval --fixture tests/fixtures/proactive-observation-cases.json` 只读评测 fixture，不写本地状态
- [⚠️ 需确认] Gemma 4 E2B-it 的推荐本机入口是 `llama-server -hf ggml-org/gemma-4-E2B-it-GGUF:Q4_K_M --alias gemma-4-E2B-it --host 127.0.0.1 --port 8080 --jinja -c 8192 -ngl 99`；`--alias`、OpenAI-compatible `/v1/chat/completions`、`response_format`、多模态 `image_url`、`chat_template_kwargs` 等能力会随 llama.cpp 版本、模型架构和 GGUF 转换而变。endpoint 返回 400/不兼容时，Codeksei 不重试删字段隐藏问题，直接 fallback，并在 observation reason/diagnostics 里暴露不兼容原因
- `CODEKSEI_USER_NAME` 决定对话里怎么称呼你，不参与消息路由
- `CODEKSEI_ALLOWED_USER_IDS` 必须填写微信桥实际观测到的 sender id；最简单的做法是先跑 `codeksei accounts`，如果你当前就在仓库工作树里，也可以直接用 `npm run accounts`
- 微信 persona / continuity instructions 默认来自仓库里的 `templates/weixin-instructions.md`，如需本地覆盖可在状态目录放 `weixin-instructions.local.md`
- 如果你在共享模式下使用多 workspace，建议启动前就设置好 `CODEKSEI_WORKSPACE_ROOT`
- `CODEKSEI_TIMEZONE` 可选；若显式设置，它会统一驱动 reminder / diary / review / timeline 的本地时间解释
- `CODEKSEI_LOCALE=zh-CN|en` 可切换用户可见 CLI/help/errors/templates/diary/review/context 文案；JSON envelope 字段名保持稳定不本地化
- `CODEKSEI_TIMELINE_LOCALE` 可选；当前用于 timeline dashboard 的文案、日期格式和 demo data 语言切换，支持 `zh-CN` 与 `en`
- workspace 级 schema / radar 自动发现现在优先 `.codeksei/*`；旧的 `.codex/*` 仍保留兼容回退
- `CODEKSEI_HERMES_REPO_ROOT` 可选；Hosted Mode 下若 sibling `../hermes-agent` 不成立，用它显式指向 repo-local upstream checkout
- Hermes 原生 cron `env` 透传补丁现在作为可选资产跟仓发布；详细适用范围与 `git apply` 用法统一看 [`docs/hermes-cron-env-patch.md`](./docs/hermes-cron-env-patch.md)
- 如果不设 `CODEKSEI_TIMEZONE`，Codeksei 会优先沿用 timeline state 里已声明的非 legacy timezone；否则回退到系统时区
- 旧的 `Asia/Shanghai` legacy timeline state 在需要时会在下一次 timeline 命令时自动迁移到当前统一 timezone
- `CODEKSEI_TIMELINE_STATE_DIR` 默认指向 Codeksei timeline 数据根；当前主布局会在它下面使用 `timeline/*.json`
- 运行时的 `.env` 读取是刻意设计成“两阶段”：先读 repo `.env`，再根据新得到的 `CODEKSEI_STATE_DIR` 重新定位并补读 state-dir `.env`；这也是 `dotenv` 目前仍保留在 runtime dependency 的原因
- `.env` 只应放在你的本地工作目录或状态目录里，不要提交进仓库

## Windows 后台常驻

如果你希望 Codex Mode 登录后自动拉起，并在解锁或恢复睡眠后快速自愈：

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
codeksei doctor
codeksei help
codeksei schema
codeksei host manifest
codeksei host bootstrap --provider hermes
codeksei host doctor
codeksei host smoke --provider hermes
codeksei companion remember --user <wechat_user_id> --workspace /absolute/workspace --source host_user_turn --stdin
codeksei onboarding start --user <wechat_user_id>
codeksei onboarding status --user <wechat_user_id>
codeksei context briefing --user <wechat_user_id> --workspace /absolute/workspace --mode proactive
codeksei frame serve --port 4327
codeksei review weekly --help
```

终端（仓库 shared 脚本）：

```bash
npm run login
npm run accounts
npm run shared:start
npm run shared:open
npm run shared:status
```

`shared:open` 只对应 Codex desktop attach；`CODEKSEI_RUNTIME=claudecode` 时用 `shared:start/status` 和微信命令做 smoke。

微信：

```text
/bind /绝对路径
/status
/new
/reread
/switch <threadId>
/stop
/compact
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
/reply
/reply mode stream|settled
/reply merge <chars>
/reply page auto|off|<chars>
/reply reset
/more
/prev
/page <n>
/full
/done
/help
```

长回复默认不会一次性刷屏：微信里先发第 1 页，后续用 `/more`、`/prev`、`/page <n>` 翻页；`/full` 会优先发临时 `.txt` 文件。

终端：

```bash
codeksei system checkin --show
codeksei system checkin --range 3-60
codeksei system checkin --reset
codeksei host seed-proactive --provider hermes --user <wechat_user_id> --workspace /absolute/workspace
codeksei host claim-checkin --provider hermes --user <wechat_user_id> --workspace /absolute/workspace
codeksei host settle-checkin --provider hermes --user <wechat_user_id> --workspace /absolute/workspace --lease <leaseId> --result silent --create-handoff --observed-state "..." --followup-context "..."
codeksei host finalize-checkin --provider hermes --user <wechat_user_id> --workspace /absolute/workspace --lease <leaseId> --sleep-for <duration>
codeksei system checkin-trigger --user <wechat_user_id> --workspace /absolute/workspace
codeksei system checkin-tick --user <wechat_user_id> --workspace /absolute/workspace
codeksei system checkin-tick --user <wechat_user_id> --workspace /absolute/workspace --ack <triggerId>
codeksei system checkin-complete --user <wechat_user_id> --workspace /absolute/workspace --trigger <triggerId> --result silent --sleep-for <duration>
codeksei context briefing --user <wechat_user_id> --workspace /absolute/workspace --mode review
codeksei whereabouts snapshot
codeksei whereabouts summary
```

更完整的命令与架构说明见：

- [docs/commands.md](./docs/commands.md)
- [docs/timeline-integration.md](./docs/timeline-integration.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/hermes-cron-env-patch.md](./docs/hermes-cron-env-patch.md) `Hosted Mode 可选补丁`

如果你在维护这个仓库，当前质量门分工是：

- `npm run check`：跑 source-level guard、typecheck、tests TS typecheck 和 source-only runtime tests，不会刷新 `dist/`。source-only runner 会跳过必须验证 built `dist` 的契约/烟测，例如 shared-mode long chain、timeline first-party runtime、CLI native contract、root helper smoke、dependency contract 和 published runtime artifacts
- `npm run coverage:critical`：owner-focused + per-file coverage gate；只覆盖 `config`、`weixin delivery text`、`runtime turn` 与 `stream delivery` 这组关键 owner，并逐文件执行阈值；这是 `verify` 层，不进入 `check`
- `npm run verify`：在 `check` 与 `coverage:critical` 之后显式 `build`，再跑 built-runtime tests 和 `npm run pack:dry-run`
- `npm run audit:prod`：production dependency 的独立联网 gate；默认要求 `npm audit --omit=dev` 为零生产漏洞，不并入 `check` / `verify`
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
- `diary/`
- `timeline/`
- `logs/`

连续性关键的状态文件目前包括 `sessions.json`、`reminder-queue.json`、`system-message-queue.json`。这几类文件现在会走原子写；如果 JSON 可读但关键 schema 已坏、或者文件本身损坏，运行时会把原文件隔离成 `*.corrupt-<timestamp>.json` 再回到空默认状态继续启动。

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
