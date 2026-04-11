# Codeksei

[![CI](https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml/badge.svg)](https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codeksei)](https://www.npmjs.com/package/codeksei)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-111111.svg)](https://github.com/Sapientropic/codeksei/blob/main/LICENSE)

[English README](./README.en.md)

> 一个本地优先的生活助理 Agent Bridge，把 WeChat、Codex runtime、timeline、diary、review、durable note 和 workspace continuity 接到同一条可持续运行的个人工作流里。

`Codeksei` 不是云端 SaaS，也不是只靠提示词扮演人格的聊天外壳。  
它更像一个本地运行的协作底座：让 agent 能持续记住线程、接住上下文、把事情往前推，并在你掉线之后还能低摩擦重新接上。

> 这个仓库已经显著偏离上游 `cyberboss` 的原始 README 和使用方式。当前行为请以本仓 `README`、`docs/` 和实际代码实现为准。

## 一眼看懂

| 项目 | 说明 |
| --- | --- |
| 定位 | 本地优先的个人生活助理桥接层 |
| 主要入口 | WeChat + `codeksei` CLI |
| 核心价值 | 同一条线程、同一份状态、低摩擦续接 |
| 当前发布 | `codeksei@0.1.0` |
| 兼容层 | `cyberboss` / `CYBERBOSS_*` / `~/.cyberboss` |

## 为什么它不是普通聊天壳

- 持续运行，而不是每次对话都从零开始。
- 微信和终端可以接到同一条共享线程，而不是两个互不相认的入口。
- `timeline`、`diary`、`review`、`note` 是内建工作流，不是后贴的边缘脚本。
- 数据与脚本本地可控、可改、可审计，更适合长期陪跑而不是一次性问答。

## 适合谁

- 希望把微信当成主要交互入口，而不是再开一个单独助手 App 的人
- 需要 agent 帮自己记住线程状态、时间线、未收口事项和复盘线索的人
- 更在意本地数据可控、可改、可审计，而不是云端托管的人
- 有 ADHD 或执行功能摩擦，想把“重新接上”做成默认能力的人

## 当前能力

| 模块 | 当前能力 |
| --- | --- |
| WeChat bridge | 扫码登录、长轮询收发、文件发送、共享线程接管 |
| Codex runtime | 共享 `app-server`、thread/session 绑定、审批流、stop/resume |
| Timeline | 单条事件写入、批量写入、分类查询、构建、预览、截图 |
| Diary | Todo、时间线事实、碎片、补充记录、总结 |
| Review | nightly / weekly / monthly，默认 hybrid 语义提炼 |
| Durable note | `note:auto`、`note:maybe`、`note:sync` |
| Workspace continuity | workspace bootstrap、project radar、按 workspace 恢复共享线程 |

## 快速开始

### 1. 最短安装路径

如果你只是要安装和使用：

```bash
npm install -g codeksei
```

如果你要改源码、调试共享脚本或做本地定制：

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
```

### 2. 最小环境变量

运行时默认读取：

1. 当前项目目录下的 `.env`
2. 当前状态目录下的 `.env`

推荐优先使用新前缀：

```dotenv
CODEKSEI_USER_NAME=你的名字
CODEKSEI_USER_GENDER=female
CODEKSEI_ALLOWED_USER_IDS=桥实际观测到的 sender id
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
CODEKSEI_TIMEZONE=Asia/Shanghai
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
- `CODEKSEI_USER_NAME` 是 agent 聊天时怎么称呼你的人设字段，不参与消息路由
- `CODEKSEI_ALLOWED_USER_IDS` 必须填写微信桥实际观测到的 sender id；最简单的做法是先跑 `npm run accounts`
- 第一次运行任意命令时，会在状态目录生成 `weixin-instructions.md`
- 如果你在共享模式下使用多 workspace，建议启动前就设置好 `CODEKSEI_WORKSPACE_ROOT`
- `CODEKSEI_TIMEZONE` 可选；若显式设置，它会统一驱动 reminder / diary / review / timeline 的本地时间解释
- 如果不设 `CODEKSEI_TIMEZONE`，Codeksei 会优先沿用 timeline state 里已声明的非 legacy timezone；否则回退到系统时区
- 旧的 `Asia/Shanghai` legacy timeline state 在需要时会在下一次 timeline 命令时自动迁移到当前统一 timezone
- `CODEKSEI_TIMELINE_STATE_DIR` 默认是 timeline-for-agent 的 state root；当前主布局会在它下面使用 `timeline/*.json`
- `.env` 只应放在你的本地工作目录或状态目录里，不要提交进仓库

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

如果你希望登录后自动拉起，并在解锁或恢复睡眠后快速自愈：

```powershell
npm run background:install
```

卸载：

```powershell
npm run background:uninstall
```

## 常用命令

终端里最常用的是这些：

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

微信里最常用的是这些：

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

更完整的命令与架构说明见：

- [docs/commands.md](./docs/commands.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/release.md](./docs/release.md)

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

## 本地数据与公开边界

当前默认状态目录是：

```text
~/.codeksei
```

如果你是从旧版本升级，且只有旧目录存在，运行时会继续兼容：

```text
~/.cyberboss
```

常见运行态内容包括：

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

这个仓库和 npm 包默认只放代码、脚本、模板与文档，不应包含你的账号、会话、日志、个人 `.env` 或本地业务数据。

## Timeline 可单独复用

Codeksei 的时间轴能力建立在 [`timeline-for-agent`](https://github.com/WenXiaoWendy/timeline-for-agent) 之上。  
如果你只想要 timeline，而不需要微信桥接与生活助理能力，也可以直接单独使用上游项目。

## Upstream Acknowledgement

感谢原仓 [`WenXiaoWendy/cyberboss`](https://github.com/WenXiaoWendy/cyberboss) 的开源。  
Codeksei 是在其基础上发展出来的版本，但当前已经进行了大量魔改和结构调整，包括共享桥接生命周期、workspace continuity、review/durable-note/timeline 命令链路、WeChat v2 登录与回复处理等。因此，使用和维护时请以本仓 README、`docs/` 和实际代码实现为准，不再默认沿用原仓说明。

## FAQ

### 为什么不是直接 `npm install -g codeksei`？

现在已经可以直接 `npm install -g codeksei`。  
如果你只想安装使用，npm 就是最短路径；如果你要做本地定制、调试共享桥接脚本或直接改仓库源码，clone 仓库仍然更合适。

### 现在到底该用 `codeksei` 还是 `cyberboss`？

新项目和新文档都应使用 `Codeksei / codeksei / CODEKSEI_*`。  
旧名字目前仍保留兼容，只是为了不打断已有本地状态和脚本。

### 共享模式和 `npm run start` 有什么区别？

`npm run start` / `npm run start:checkin` 更适合最小链路调试。  
日常使用、微信与终端共用同一条线程、后台自愈和多窗口接管，默认都应走共享模式。

## License

本项目采用 `AGPL-3.0-only`。  
如果你基于本项目修改、扩展并通过网络向他人提供服务，需要按照 AGPL 的要求向对应用户提供完整的对应源代码。
