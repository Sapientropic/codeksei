# Architecture

`Codeksei` 的产品重心仍然是一个会陪人生活、主动记录、帮助节奏校准与项目落地的本地优先生活助理。
实现层现在按“入口适配 -> runtime 协调 -> 状态持久化 -> 上层工作流”收口，而不是继续把这些职责混在 `src/core` 一个桶里。

这一页只解释当前稳定结构，不复述实现细节清单。

## 1. Core Orchestration Shell

`src/core/*`

`src/core` 现在只负责最靠里的编排壳层。

负责：

- 组装 channel / runtime / integration
- 驱动 app poll loop、runtime turn/watchdog/backstage lifecycle
- 协调 command router、stream delivery、thread state
- 保持 app-level wiring 与 bridge coordination

不负责：

- managed state 文件读写细节
- workspace continuity 工具
- shared heartbeat owner
- review / notes 的实现逻辑

一句话理解：`src/core` 负责“把系统接起来”，不再负责“把状态怎么存、workspace 怎么找、复用说明怎么拼”。

## 2. State Ownership

`src/state/*`

这一层收口持久化 helper 与 queue/store owner。

当前由它负责的核心对象：

- `json-state.ts`
- `system-message-queue-store.ts`
- `timeline-screenshot-queue-store.ts`
- `reminder-queue-store.ts`

设计规则：

- schema / validate 只在 ingress canonicalize
- store 只操作 canonical state
- queue / reminder / screenshot 这类 managed state 不再挂在 `src/core`

这一层是“状态怎么进、怎么存、怎么隔离坏文件”的真相层。

## 3. Workspace Continuity

`src/workspace/*`

这一层只负责 workspace identity 与 continuity 引导。

当前包括：

- `workspace-alias.ts`
- `workspace-bootstrap.ts`
- `default-targets.ts`

负责：

- Windows alias path 与 runtime cwd 兼容
- workspace bootstrap 读入顺序
- 默认 sender / workspace root 推断

不负责：

- runtime thread/session 主链
- review / note / adapter 业务规则

## 4. Channel Adapters

`src/adapters/channel/*`

当前主要是 WeChat bridge。

负责：

- 登录、收消息、发消息、文件发送
- context token、账号、sync buffer
- 对微信协议细节做适配

当前收口方式：

- `index.ts` 保持 facade
- `delivery.ts` 负责 chunk / retry / trace / v2 text send
- `updates.ts` 负责 account / context token / sync buffer / getUpdates

不负责：

- Codex thread 语义
- review / durable note / timeline 业务规则

## 5. Runtime Adapters

`src/adapters/runtime/*`

当前主运行时是 Codex。

负责：

- 把消息送入具体 runtime
- 管理 thread / session / approval / stop / resume
- 对共享 `app-server` 与本地 client attach 做边界适配

当前收口方式：

- `index.ts` 保持 facade
- `lifecycle.ts` 负责 reconnect / initialize / ready state
- `bootstrap.ts` 负责 thread bootstrap / instruction refresh 文本
- `diagnostics.ts` 负责 workspace diagnostics / turn completion wait

## 6. Shared Mode

公开入口脚本在 `scripts/*.sh` / `scripts/*.ps1`，shared lifecycle 逻辑收口在 `src/shared/*`。

这是当前默认运行方式。

负责：

- 共享 `codex app-server`
- 共享 WeChat bridge
- watchdog / supervisor / status / open
- shared heartbeat ownership

`src/shared/shared-bridge-heartbeat.ts` 现在是 heartbeat ingress 与 owner，不再挂在 `src/core`。

## 7. Integrations And Operational Layer

`src/integrations/*`、`src/review/*`、`src/notes/*`、`src/app/*`

这几层共同构成更接近“陪伴感”和“节奏感”的工作流表面。

其中：

- `src/integrations/*` 负责接上游能力，例如 timeline
- `src/review/*` 负责 nightly / weekly / monthly review
- `src/notes/*` 负责 durable note routing 与写入
- `src/app/*` 负责公开 CLI 入口命令

架构保护规则默认守住：

- `src/review` 不反向依赖 `src/app`
- `src/notes` 不直接依赖 adapter 层
- `src/state` 不直接依赖 app CLI 层
- `src/core` 不重新吸回 review / notes 的实现细节

## 8. Persistence Model

主要状态默认在：

- `~/.codeksei`

常见持久化对象：

- accounts
- sessions
- sync buffers
- reminder / system / timeline screenshot queues
- workspace bootstrap config
- logs

如果用户单独指定 `CODEKSEI_DIARY_DIR` / `CODEKSEI_TIMELINE_STATE_DIR`，业务数据会写到外部目录，状态目录保留运行态文件。

本地优先会落实在这里：状态、日志、提醒队列和生活记录默认都留在自己手里。

## 9. Compatibility Boundary

公开表面统一按 `Codeksei / codeksei / CODEKSEI_*` 书写。
运行时、shared wrapper、managed marker 与脚本入口都只认 `codeksei` 这一套命名，不再保留旧别名或旧状态目录 fallback。
