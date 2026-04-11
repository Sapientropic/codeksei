# Codeksei

[![CI](https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml/badge.svg)](https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml)

[English README](./README.en.md)

Codeksei 是一个面向个人本地部署的生活助理 Agent Bridge。  
它把 Codex runtime、微信桥接、timeline、diary、review、durable note 这些能力接到同一条工作流里，让一个长期在线的 agent 不只是“回答问题”，而是能在真实生活与项目上下文里持续接线、记账、回看和推进。

这个仓库已经不是对原仓 README 原样适用的轻量 fork。现在的实现包含共享 app-server 生命周期、WeChat v2 路由与回复去重、timeline/diary/review 命令链路、durable note 自动路由、workspace bootstrap、project radar 等大量改造，因此文档以当前仓库现状为准。

## 这是什么

- 一个本地优先的个人生活助理桥接层，不是云端 SaaS。
- 一个把微信消息、Codex 线程、时间轴、日记、复盘和轻量项目索引接起来的运行时。
- 一个更适合“需要外部脚手架、需要被重新接住、需要低摩擦收口”的个人协作系统。

它不是：

- 通用聊天机器人托管平台
- 多租户服务端产品
- 只靠提示词演戏、没有状态与工具落盘的“人格壳”

## 适合谁

- 希望把微信当成主要交互入口，而不是再开一个新 App 的人
- 需要 agent 帮自己记住线程状态、时间线、未收口事项和复盘线索的人
- 更在意本地数据可控、可改、可审计，而不是云端托管的人
- 有 ADHD / 执行功能摩擦，想把“重新接上”做成默认能力的人

## 当前能力

- 微信桥接：扫码登录、长轮询收发、文件发送、共享线程接管
- Codex runtime：共享 `app-server`、thread/session 绑定、审批流、stop / resume
- 时间轴：单条事件写入、批量写入、分类查询、构建/预览/截图
- 日记：Todo、时间线事实、碎片、补充记录、总结
- Review：nightly / weekly / monthly，默认 hybrid 语义提炼
- Durable note：`note:auto` / `note:maybe` / `note:sync`
- Workspace continuity：workspace bootstrap、project radar、共享线程按 workspace 恢复

## 命名与兼容

这轮开始，公共品牌以 `Codeksei` 为主。

- 主名称：`Codeksei`
- 主包名：`codeksei`
- 主 CLI 名：`codeksei`
- 主环境变量前缀：`CODEKSEI_*`
- 主状态目录：`~/.codeksei`

为了不打断已有本地使用，当前仍保留兼容层：

- 旧 CLI：`cyberboss`
- 旧环境变量前缀：`CYBERBOSS_*`
- 旧状态目录：`~/.cyberboss`

兼容规则：

- 新前缀优先于旧前缀
- 如果 `~/.codeksei` 不存在但 `~/.cyberboss` 已存在，运行时会优先复用旧状态
- Windows 后台任务会安装为 `Codeksei Shared *`，同时清理旧 `Cyberboss Shared *`

## 快速开始

### 1. 获取源码

现在已经可以直接通过 npm 安装 `codeksei`，但如果你要改源码、跑共享脚本或做本地定制，仍然建议直接 clone 仓库：

```bash
npm install -g codeksei
```

或：

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
```

### 2. 先配环境变量

运行时默认读取：

1. 当前项目目录下的 `.env`
2. 当前状态目录下的 `.env`

推荐优先使用新前缀：

```dotenv
CODEKSEI_USER_NAME=你的名字
CODEKSEI_USER_GENDER=female
CODEKSEI_ALLOWED_USER_IDS=你的微信 user id
CODEKSEI_WORKSPACE_ROOT=/绝对路径/你的项目目录
```

常用可选项：

```dotenv
CODEKSEI_ACCOUNT_ID=
CODEKSEI_CODEX_ENDPOINT=ws://127.0.0.1:8765
CODEKSEI_WEIXIN_ADAPTER=v2
CODEKSEI_WEIXIN_REPLY_MODE=stream
CODEKSEI_WEIXIN_ROUTE_TAG=
CODEKSEI_WEIXIN_PROTOCOL_CLIENT_VERSION=2.1.1
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

说明：

- 旧的 `CYBERBOSS_*` 仍可用，但新项目建议统一切到 `CODEKSEI_*`
- 第一次运行任意命令时，会在状态目录生成 `weixin-instructions.md`
- 如果你在共享模式下使用多 workspace，建议启动前就设置好 `CODEKSEI_WORKSPACE_ROOT`

### 3. 扫码登录

```bash
npm run login
```

### 4. 启动共享模式

默认推荐共享模式，不再推荐把桥接跑成一次性的私有 runtime：

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

### 5. Windows 后台常驻

如果你希望登录后自动拉起，并在解锁/恢复睡眠后快速自愈：

```powershell
npm run background:install
```

卸载：

```powershell
npm run background:uninstall
```

## 常用命令

普通用户最常用的是这些：

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

微信里常用的是这些：

- `/bind /绝对路径`
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

更完整的命令说明见：

- [docs/commands.md](./docs/commands.md)
- [docs/architecture.md](./docs/architecture.md)

## 发布与 CI

仓库现在已经内置 GitHub Actions CI 与 npm 发布 workflow。  
发布流程、所需 secret、tag 约定和 slug 迁移约束统一见：

- [docs/release.md](./docs/release.md)

## 本地数据在哪里

当前默认状态目录是：

```text
~/.codeksei
```

如果你是从旧版本升级，且只有旧目录存在，运行时会继续兼容：

```text
~/.cyberboss
```

常见内容包括：

- `accounts/`
- `sessions.json`
- `sync-buffers/`
- `weixin-instructions.md`
- `workspace-bootstrap.json`
- `reminder-queue.json`
- `system-message-queue.json`
- `timeline-screenshot-queue.json`
- `diary/`
- `timeline/`
- `logs/`

如果你单独设置了 `CODEKSEI_DIARY_DIR` 或 `CODEKSEI_TIMELINE_STATE_DIR`，真正的数据会写到你指定的位置，状态目录只保留运行态文件。

## Timeline 可单独复用

Codeksei 的时间轴能力建立在 [`timeline-for-agent`](https://github.com/WenXiaoWendy/timeline-for-agent) 之上。  
如果你只想要 timeline，而不需要微信桥接与生活助理能力，也可以直接单独使用上游项目。

## Upstream Acknowledgement

感谢原仓 [`WenXiaoWendy/cyberboss`](https://github.com/WenXiaoWendy/cyberboss) 的开源。  
Codeksei 是在其基础上发展出来的版本，但当前已经进行了大量魔改和结构调整，包括共享桥接生命周期、workspace continuity、review/durable-note/timeline 命令链路、WeChat v2 登录与回复处理等。因此，使用和维护时请以本仓 README、`docs/` 和实际代码实现为准，不再默认沿用原仓说明。

## FAQ

### 为什么不是直接 `npm install codeksei`？

因为当前默认入口仍是 clone 仓库后本地运行。  
现在 `codeksei@0.1.0` 已经发布到 npm，可以直接 `npm install -g codeksei`。  
如果你要做本地定制、调试共享桥接脚本、或直接改仓库源码，clone 仓库仍然是更合适的入口。

### 现在到底该用 `codeksei` 还是 `cyberboss`？

新项目和新文档都应使用 `Codeksei / codeksei / CODEKSEI_*`。  
旧名字目前仍保留兼容，只是为了不打断已有本地状态和脚本。

### 共享模式和 `npm run start` 有什么区别？

`npm run start` / `npm run start:checkin` 更适合最小链路调试。  
日常使用、微信与终端共用同一条线程、后台自愈和多窗口接管，默认都应走共享模式。

## License

本项目采用 `AGPL-3.0-only`。  
如果你基于本项目修改、扩展并通过网络向他人提供服务，需要按照 AGPL 的要求向对应用户提供完整的对应源代码。
