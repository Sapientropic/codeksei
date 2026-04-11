# Architecture

`Codeksei` 的产品重心是一个会陪人生活、主动记录、帮助节奏校准与项目落地的本地优先生活助理。
在实现上，它通过 WeChat、runtime、timeline、diary、review、note 等能力，把这层照看落成一条可持续运行的生活助理桥接层。

这一页主要说明这份“照看”具体落在哪几层，以及每层各自守什么边界。

## 1. Runtime Core

`src/core/*`

这是最靠里的那层。它不直接表现“陪伴感”，但负责把整条链稳稳托住。

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

这一层离真实生活最近，因为它负责把日常入口接进来。

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

这一层负责把“收到的东西”真正变成 Codeksei 可以处理、记住和继续推进的内容。

负责：

- 把消息送入具体 runtime
- 管理 thread / session / approval / stop / resume
- 对共享 `app-server` 与本地 client attach 做边界适配

## 4. Integrations

`src/integrations/*`

当前最重要的是 timeline integration。

这层让 Codeksei 能把记录、提醒、复盘和项目推进慢慢串起来。

原则：

- 能复用独立上游能力就复用，不在主仓里重写一遍
- bridge 只负责把 timeline / diary / review / note 这些能力串起来

## 5. Shared Mode

`scripts/shared-*`

这是当前默认运行方式。

shared mode 让照看在你换入口、换窗口、或短暂离开之后，依然能继续接上。

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

本地优先会落实在这里：状态、日志、提醒队列和生活记录默认都留在自己手里。

## 7. Review / Notes / Timeline

当前仓库已经从微信桥接延伸成一套会慢慢照看日常与项目推进的上层工作流。

新增并稳定化的上层工作流包括：

- `timeline:event` / `timeline:write` / `timeline:screenshot`
- `diary:write`
- `review:nightly` / `review:weekly` / `review:monthly`
- `note:auto` / `note:maybe` / `note:sync`
- `project:radar`

这些命令共同构成了现在的 Codeksei operational layer。

如果把 Runtime / Adapters 看成骨架，这一层就是更接近“陪伴感”和“节奏感”的地方。

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

兼容层集中收口在配置读取、shared scripts、marker 读取与 CLI 入口，尽量不打断已经留下来的本地状态。

对 Codeksei 来说，改名可以发生，但已经留下来的生活痕迹不该轻易断掉。
