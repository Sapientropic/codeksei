# Architecture

`Codeksei` 现在的架构重点不是“做一个聊天人格”，而是把多个本地能力拼成一条可持续运行的 personal agent bridge。

## 1. Runtime Core

`src/core/*`

负责：

- 读取配置与状态目录
- 组装 channel / runtime / integration
- 维护 shared bridge 生命周期
- 管理 thread/session、审批流、workspace continuity

不负责：

- 具体微信协议实现
- timeline 原始实现本体

## 2. Channel Adapters

`src/adapters/channel/*`

当前主要是 WeChat bridge。

负责：

- 登录、收消息、发消息
- 文件发送
- 长轮询同步
- context token、账号与 sync buffer 持久化

不负责：

- Codex thread 语义
- review / durable note / timeline 业务规则

## 3. Runtime Adapters

`src/adapters/runtime/*`

当前主运行时是 Codex。

负责：

- 把消息送入具体 agent runtime
- 管理 thread / session / approval / stop / resume
- 对共享 `app-server` 与本地 client attach 做边界适配

## 4. Integrations

`src/integrations/*`

当前最重要的是 timeline integration。

原则：

- 能复用独立上游能力就复用，不在主仓里重写一遍
- bridge 只负责把 timeline / diary / review / note 这些能力串起来

## 5. Shared Mode

`scripts/shared-*`

这是当前默认运行方式。

包含：

- 共享 `codex app-server`
- 共享 WeChat bridge
- watchdog / supervisor
- 终端 attach / status / recovery

设计目标：

- 微信和终端看到的是同一条 thread
- 共享桥掉线时可恢复
- Windows / macOS / Linux 都能有统一入口

## 6. Persistence Model

主要状态默认在：

- `~/.codeksei`
- 兼容旧目录 `~/.cyberboss`

常见持久化对象：

- accounts
- sessions
- sync buffers
- reminder/system/timeline screenshot queues
- workspace bootstrap config
- logs

如果用户单独指定 `CODEKSEI_DIARY_DIR` / `CODEKSEI_TIMELINE_STATE_DIR`，业务数据会写到外部目录，状态目录保留运行态文件。

## 7. Review / Notes / Timeline

当前仓库已经不只是“微信桥接”。

新增并稳定化的上层工作流包括：

- `timeline:event` / `timeline:write` / `timeline:screenshot`
- `diary:write`
- `review:nightly` / `review:weekly` / `review:monthly`
- `note:auto` / `note:maybe` / `note:sync`
- `project:radar`

这些命令共同构成了现在的 Codeksei operational layer。

## 8. Compatibility Strategy

当前改名采用“新入口为主，旧入口兼容”：

- 主名称：`Codeksei`
- 主 CLI / 包名：`codeksei`
- 主 env 前缀：`CODEKSEI_*`
- 主状态目录：`~/.codeksei`

同时兼容：

- `cyberboss`
- `CYBERBOSS_*`
- `~/.cyberboss`

兼容层集中收口在配置读取、shared scripts、marker 读取与 CLI 入口，而不是要求用户手工迁移所有本地状态。
