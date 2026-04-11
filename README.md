# Codeksei

<div align="center">
  <p>
    <a href="./README.en.md">English README</a>
  </p>
  <p>
    <a href="https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://www.npmjs.com/package/codeksei"><img alt="npm version" src="https://img.shields.io/npm/v/codeksei"></a>
    <a href="https://github.com/Sapientropic/codeksei/blob/main/LICENSE"><img alt="License: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-111111.svg"></a>
  </p>
  <h3>主动记录日常，照看生活节奏，也陪你把项目慢慢落地</h3>
  <p><strong>一个本地优先的生活助理与伙伴。</strong></p>
  <p>它会接住那些最容易被忽略的碎片：微信里的念头、待办、提醒、时间线、复盘线索和零散日常；再把它们慢慢整理成更稳的生活节奏与推进中的项目行动。</p>
  <p>
    <a href="#为什么叫-codeksei">名字寓意</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#现在可以做什么">当前能力</a> ·
    <a href="./docs/commands.md">命令</a> ·
    <a href="./docs/architecture.md">架构</a> ·
    <a href="./docs/release.md">发布</a>
  </p>
</div>

> 这个仓库已经显著偏离上游 `cyberboss` 的原始 README 和使用方式。当前行为请以本仓 `README`、`docs/` 和实际代码实现为准。

| 主入口 | 更像什么 | 当前状态 |
| --- | --- | --- |
| WeChat + `codeksei` | 面向 ADHD 陪伴、照看、主动记录与生活节奏校准的本地生活助理 | `codeksei@0.1.1`，兼容 `cyberboss` / `CYBERBOSS_*` / `~/.cyberboss` |

## 为什么叫 Codeksei

<div align="center">
  <p><strong>一个名字，留下两层感觉。</strong></p>
</div>

| `Code` | `-ksei` |
| --- | --- |
| 散落日常里的隐秘书写。<br>稍纵即逝的念头、半途停下的线索、以及你本来想记住的生活纹理。 | 取自 `Aleksei` 的后半段。<br>在这里，它借来“守护 / 帮助 / 同行”的意象，像一位安静的陪跑者。 |

<div align="center">
  <p><em>线索有人照看，离开之后仍能顺着原来的温度回来。</em></p>
</div>

## 它会怎么帮你

- 主动记录和整理琐碎日常，减少“回头再记”时已经散掉的东西。
- 提醒、日记、时间线和复盘会彼此接力，慢慢帮你校准生活节奏。
- 项目推进、碎片收集和后续整理放在同一条链上，更容易真的落地。
- 微信和终端共用同一条状态，让这份照看不会因为换入口就断掉。

## 这些人会喜欢它

- 想有人替自己照看琐碎日常、提醒和未收口事项的人
- 有 ADHD 或执行功能摩擦，希望得到持续陪伴和轻推的人
- 想把项目推进、日常记录和复盘整理放进同一条工作流的人
- 想把微信保留成主要交互入口，同时保留本地可控性的人

## 现在可以做什么

- `Diary`：Todo、时间线事实、碎片、补充记录、总结，帮你把零散日常慢慢收成可用痕迹
- `Reminders`：提醒写入与调度，给生活节奏和待办推进一个外部支点
- `Review`：nightly / weekly / monthly，把日常记录压成更稳定的节奏校准与复盘材料
- `Timeline`：单条事件写入、批量写入、分类查询、构建、预览、截图
- `WeChat bridge`：扫码登录、长轮询收发、文件发送、共享线程接管
- `Codex runtime`：共享 `app-server`、thread/session 绑定、审批流、stop/resume
- `Durable note`：`note:auto`、`note:maybe`、`note:sync`
- `Project support`：workspace bootstrap、project radar、按 workspace 恢复共享线程，帮助项目更容易重新进入推进状态

## 快速开始

### 1. 先选安装方式

如果你想按本文完整使用共享模式，先 clone 仓库，再跑 `npm run ...`：

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
```

如果你只是想先拿到基础 CLI：

```bash
npm install -g codeksei
codeksei help
```

说明：

- 本文后续命令示例默认按仓库工作树写成 `npm run ...`
- 全局安装更适合先体验基础 CLI；共享模式相关脚本在仓库内运行最直接

### 2. 配置最小环境变量

运行时会依次读取：

1. 当前项目目录下的 `.env`
2. 当前状态目录下的 `.env`

最小可用配置：

```dotenv
CODEKSEI_USER_NAME=你的名字
CODEKSEI_USER_GENDER=female
CODEKSEI_ALLOWED_USER_IDS=桥实际观测到的 sender id
CODEKSEI_WORKSPACE_ROOT=/绝对路径/你的项目目录
```

<details>
<summary>展开常用可选环境变量</summary>

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

</details>

说明：

- 旧的 `CYBERBOSS_*` 仍可用，但新项目建议统一切到 `CODEKSEI_*`
- `CODEKSEI_USER_NAME` 决定对话里怎么称呼你，不参与消息路由
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

### 4. 拉起共享模式

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

先记住这一小组就够用：

终端：

```bash
npm run login
npm run accounts
npm run shared:start
npm run shared:open
npm run shared:status
npm run doctor
npm run help
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
/model <id>
/help
```

更完整的命令与架构说明见：

- [docs/commands.md](./docs/commands.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/release.md](./docs/release.md)

## 命名与兼容

品牌上现在统一使用 `Codeksei`，兼容上仍保留旧入口。

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

### 可以直接 `npm install -g codeksei` 吗？

可以。
如果你只想先拿到基础 CLI，这是最短路径；如果你要按本 README 跑完整共享模式、调试共享桥接脚本或直接改仓库源码，clone 仓库会更顺手。

### 现在到底该用 `codeksei` 还是 `cyberboss`？

新项目和新文档都应使用 `Codeksei / codeksei / CODEKSEI_*`。  
旧名字目前仍保留兼容，只是为了不打断已有本地状态和脚本。

### 共享模式和 `npm run start` 有什么区别？

`npm run start` / `npm run start:checkin` 更适合最小链路调试。  
日常使用、微信与终端共用同一条线程、后台自愈和多窗口接管，默认都应走共享模式。

## License

本项目采用 `AGPL-3.0-only`。  
如果你基于本项目修改、扩展并通过网络向他人提供服务，需要按照 AGPL 的要求向对应用户提供完整的对应源代码。
