# Architecture

`Codeksei` 的产品重心仍然是一个会陪人生活、主动记录、帮助节奏校准与项目落地的本地优先生活助理。
实现层现在按“入口适配 -> runtime 协调 -> 状态持久化 -> 上层工作流”收口，而不是继续把这些职责混在 `src/core` 一个桶里。

## Host-Neutral Core

这一版开始把 `Codeksei` 明确收口成 companion/domain layer，而不是默认绑死某一个固定 agent 宿主。

- `Bridge Mode`
  `Codeksei Weixin bridge + Codex runtime`
- `Hermes Hosted Mode`
  Hermes 托管 agent + 官方 Weixin；Codeksei 通过 CLI / operator / skill surface 暴露领域能力

这次不会把 Hermes 的 Python Weixin adapter 硬塞进 Node/TS。Hermes Weixin 仍由 Hermes 官方维护，Codeksei 负责 timeline / diary / reminder / review / note / project radar 这些领域能力，并通过 `operator hermes` 入口管理 skill/status/smoke。
主动 checkin 也按同一条边界收口：Codeksei 负责 trigger generation、`tick -> ack -> complete` 调度真相与下一次唤醒决策，Bridge / Hermes 只负责各自宿主侧的 heartbeat、派发与超时兜底。
运行配置入口也已经收口成 `src/core/config.ts` 的 `parseEnvConfig()`：env/CLI override 先规范化成显式字段的 `AppRuntimeConfig`，下游 factory / host policy / CLI 命令不再各自做一轮局部 `typeof config.xxx === "string"` 补丁式收口。

当前质量基线也已经同步到结构层：

- `npm run check` / `npm run verify` 默认全绿
- TS 源码侧的 CommonJS 过渡 allowlist 已清零
- `@ts-nocheck` allowlist 已清零
- repo-tracked authored source 里的 `.js/.jsx/.mjs` 已清零；timeline first-party runtime 也回到同一条 TS build 主链
- 构建产物仍输出 CommonJS，但源码内部已经不再靠 `require / module.exports / export {}` 过渡态维持结构
- timeline build 现在只复制非代码资产（如 CSS / examples），不再把 source runtime 整树原样复制进 `dist`
- 跨模块共享的基础 helper 现在统一收口到 `src/contracts/text-normalization.ts`、`src/core/error-handling.ts`、`src/core/message-catalog.ts`
- `npm run check` 现在会直接守 bare `.catch(() => {})`、重复 `normalizeText`、冗余 `typedXxx`、`!:` 和 explicit `any` 这类结构债，不再只靠 review 口头约束

这一页只解释当前稳定结构，不复述实现细节清单。

## 1. Core Orchestration Shell

`src/core/*`

`src/core` 现在只负责最上层编排壳层。

负责：

- 组装 channel / runtime / integration
- 驱动 app poll loop
- 协调 command router 与 app-level wiring
- 保持 app-level wiring 与 bridge coordination
- host policy 现在按 sibling owner 拆开：`host-mode-resolution.ts` 只做纯判定，`hosted-hermes-diagnostics.ts` 负责 doctor/status/smoke，`hosted-hermes-skill.ts` 负责 skill preview/install，`review-semantic-host-policy.ts` 负责 semantic host 选择；`host-mode.ts` 退回 barrel
- 把 runtime event pipeline、lifecycle runner、terminal façade 委托给独立 helper，而不是继续把串行链、启动/关闭细节和 terminal 能力暴露堆在 `app.ts`
- `CodekseiApp` 现在是 thin façade：状态位 + `readonly services`，再把 admin / target resolution / runtime delegate 分别下沉到 `app-admin-actions.ts`、`app-target-resolution.ts`、`app-runtime-delegates.ts`

不负责：

- runtime lifecycle / stream delivery / thread state 实现
- managed state 文件读写细节
- workspace continuity 工具
- shared heartbeat owner
- review / notes 的实现逻辑

一句话理解：`src/core` 负责“把系统接起来”，不再负责“把状态怎么存、workspace 怎么找、复用说明怎么拼”。

## 1.1 Cross-Cutting Core Contracts

这些 helper 现在是跨层共享的稳定入口：

- `text-normalization.ts`
  `src/contracts/text-normalization.ts` 是 repo 唯一 canonical `normalizeText` owner；`src/core/text-normalization.ts` 仅保留兼容 re-export，避免 shared/contracts 再反向依赖 core
- `error-handling.ts`
  best-effort / cleanup 失败的显式 suppressed-error 路径；teardown 不再靠 bare catch 静默吞掉
- `message-catalog.ts`
  用户面与运维面文案策略入口：用户可见 CLI / WeChat / runtime failure 保持中文，operator / maintainer diagnostics 与 shared status line 保持英文

## 2. Runtime Subsystem

`src/runtime/*`

这一层收口真正的 runtime orchestration 子系统。

当前包括：

- `runtime-turn-lifecycle.ts`
- `runtime-watchdog-lifecycle.ts`
- `backstage-task-lifecycle.ts`
- `thread-state-store.ts`
- `stream-delivery.ts`
- `stream-delivery/*`

负责：

- runtime turn / approval / watchdog / backstage 调度
- thread state 与 stream delivery owner
- 把 channel / runtime adapter 之间的会话级协作收口成稳定实现
- 先看 adapter descriptor / operations，再决定是否调用 visible text / typing / file delivery 与 interactive runtime turn；unsupported host path 不再依赖“先调再在 adapter 里 reject”

不负责：

- app CLI wiring
- managed state store owner
- review / notes / timeline 的领域逻辑

## 3. State Ownership

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
- note / review / timeline consumer 通过 typed boundary 进入 state owner，不再靠 allowlist 或 `@ts-nocheck` 兜底

这一层是“状态怎么进、怎么存、怎么隔离坏文件”的真相层。

## 4. Workspace Continuity

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

## 5. Channel Adapters

`src/adapters/channel/*`

当前主要是 `Bridge Mode` 下的 WeChat bridge。

负责：

- 登录、收消息、发消息、文件发送
- context token、账号、sync buffer
- 对微信协议细节做适配

当前收口方式：

- `index.ts` 保持 facade
- `legacy.ts` 只保留 legacy adapter facade、account/context/getUpdates/login/sendFile
- `delivery.ts` 只保留 v2 text transport / typing facade
- `delivery-text.ts` 负责文本归一化、chunk、packing、stream 边界
- `delivery-trace.ts` 负责 trace context、retry backoff、stable client id 重试
- `updates.ts` 负责 account / context token / sync buffer / getUpdates
- `login-*`、`message-utils*`、`protocol.ts`、`account-store.ts`、`context-token-store.ts` 各自承担 owner-local 边界
- channel adapter 现在通过 `describe().operations` 显式声明 `pollUpdates` / `login` / `resolveAccount` / `visibleTextDelivery` / `visibleTypingDelivery` / `visibleFileDelivery`

实现约束：

- 源码内部统一走标准 `import / export`
- media 兼容路径与 v2 text delivery 的分工继续显式保留，避免“顺手统一”把文件发送重新路由回错误栈

不负责：

- Codex thread 语义
- review / durable note / timeline 业务规则

## 6. Runtime Adapters

`src/adapters/runtime/*`

当前仓内已实现的 bridge runtime 仍然是 Codex，但 core seam 已经按 host-neutral 方向收口。

负责：

- 把消息送入具体 runtime
- 管理 thread / session / approval / stop / resume
- 对共享 `app-server` 与本地 client attach 做边界适配

`Hermes Hosted Mode` 当前不在仓内重复实现一份 Hermes runtime adapter；它的主路径是 Hermes 自己做宿主，Codeksei 通过 CLI / operator / skill asset 暴露能力。

当前收口方式：

- `index.ts` 保持 facade
- `lifecycle.ts` 负责 reconnect / initialize / ready state
- `bootstrap.ts` 负责 thread bootstrap / instruction refresh 文本
- `diagnostics.ts` 负责 workspace diagnostics / turn completion wait
- `session-store.ts` 继续保留 public class surface，但内部 binding/workspace、approval、model catalog 已拆到独立 owner helpers，壳层只保留 refresh / mutate / persist / façade
- `session-store.ts` 现在只暴露同步读面；持久化写入通过 `session-store-writer.ts` 的 async owner 进入 non-blocking lock
- `rpc-client.ts` 继续承担 transport owner，但不再顺手吸收 session / shared 恢复规则
- runtime adapter 现在通过 `describe().operations` 显式声明 `initialize` / `interactiveTurn` / `refreshThreadInstructions` / `respondApproval` / `resumeThread` / `cancelTurn`
- hosted mode adapter 不再伪装成“支持 bridge-only runtime/send-back 但运行时再拒绝”；bridge-only 能力由 descriptor 与命令合同一起前置挡住

## 7. Shared Mode

公开入口脚本在 `scripts/*.sh` / `scripts/*.ps1`，shared lifecycle 逻辑收口在 `src/shared/*`。

这是当前 `Bridge Mode` 的默认运行方式。

负责：

- 共享 `codex app-server`
- 共享 WeChat bridge
- watchdog / supervisor / status / open
- shared heartbeat ownership

在 `Hermes Hosted Mode` 下，`shared:start` / `shared:open` / `shared:watchdog` 不会再偷偷起 Codeksei 自己的 bridge，而是明确提示“由 Hermes 宿主管理”。

`src/shared/shared-bridge-heartbeat.ts` 现在是 heartbeat ingress 与 owner，不再挂在 `src/core`。

当前 shared 进一步收口为：

- `shared-process-context.ts` 负责 shared env / path / context 解析
- `shared-process-state.ts` 负责 pid/json state 读写
- `shared-process-control.ts` 负责 readyz / spawn / stop / process control
- `shared-process.ts` 退回 barrel
- `shared-watchdog.ts`、`shared-status.ts`、`shared-supervisor.ts` 共享 `SharedBridgeHealth`、`SharedWatchdogState`、`ManagedStopResult` 等显式类型，而不是继续走高风险 `any`

运行时恢复链当前默认还有一条仓内 automated smoke 保护：

- `tests/shared-mode-long-chain.test.ts` 会走 built `dist` 入口与 fake Codex app-server / fake Weixin HTTP server，覆盖 `shared:start -> shared:status -> shared:open`、approval continuity after restart，以及 `stream / settled` reply mode 的 adapter 链路
- 这条自动化链路证明的是仓内 integration surface，不等于真实账号 / 真实网络 / 真实 runtime 环境下的 live smoke；后者继续由 maintainer `smoke:shared:real:*` assisted smoke 补证

## 8. Integrations And Operational Layer

`src/integrations/*`、`src/review/*`、`src/notes/*`、`src/app/*`

这几层共同构成更接近“陪伴感”和“节奏感”的工作流表面。

其中：

- `src/integrations/*` 负责接上游能力，例如 timeline
- `src/review/*` 负责 nightly / weekly / monthly review
- `src/notes/*` 负责 durable note routing 与写入
- `src/app/*` 负责公开 CLI 入口命令

当前这层的结构特征是：

- note / review / timeline / state 已经形成各自可读的 typed boundary
- `src/contracts/command-surface.ts` 只保留命令 façade；action definitions 与 rich help contract 已拆成 sibling truth layer
- `src/review/review-draft.ts`、`src/review/review-semantic.ts`、`src/core/timezone.ts` 现在是 façade 入口，window / heuristics / render、prompt / runtime / normalize、state / config / formatting 已各自 owner 化
- `src/app/*` 继续只做公开入口，不重新吸回领域实现
- `src/core` / `src/runtime` 不再依赖 style/type allowlist 才能维持这些边界
- Hermes 集成当前优先走 skill / CLI / operator contract，而不是把 Hermes gateway 逻辑重新 vendoring 进来
- Hermes Hosted Mode 的 repo-local send-back / cron 现在通过 Codeksei 自己的薄 Python shim 对接 sibling `hermes-agent` checkout，不在 TS 里重写 Weixin/CDN/context_token/cron 细节
- review hybrid 现在由宿主策略层选择 semantic host：Bridge Mode 默认走 Codex，Hermes Hosted Mode 默认走 Hermes，文件路由与落盘逻辑仍保留在 Codeksei 自己手里
- checkin 现在按 host-neutral core 收口：`system checkin-trigger` 提供 one-shot payload，`system checkin-tick` / `system checkin-complete` 维护调度真相，`system checkin-poller` 退回 bridge-only wrapper
- project radar 现在保持“本地 git 真相优先”，只有 git unavailable 时才补 GitHub activity fallback

架构保护规则默认守住：

- `src/review` 不反向依赖 `src/app`
- `src/notes` 不直接依赖 adapter 层
- `src/state` 不直接依赖 app CLI 层
- `src/core` 不重新吸回 review / notes 的实现细节
- `src/runtime` 不重新吸回 review / notes / app CLI 的实现细节

## 9. Persistence Model

主要状态默认在：

- `~/.codeksei`

常见持久化对象：

- accounts
- sessions
- sync buffers
- reminder / system / timeline screenshot queues
- workspace bootstrap config
- logs

Hermes Hosted Mode 下，这里不再承接 reminder queue 或 timeline screenshot queue 的主真相：

- reminder 改走 Hermes cron/jobs
- channel send-file / timeline screenshot --send 改走 Hermes repo-local origin delivery
- `system send` 仍保留 bridge-only backstage queue 语义

如果用户单独指定 `CODEKSEI_DIARY_DIR` / `CODEKSEI_TIMELINE_STATE_DIR`，业务数据会写到外部目录，状态目录保留运行态文件。

本地优先会落实在这里：状态、日志、提醒队列和生活记录默认都留在自己手里。

## 10. Compatibility Boundary

公开表面统一按 `Codeksei / codeksei / CODEKSEI_*` 书写。
运行时、shared wrapper、managed marker 与脚本入口都只认 `codeksei` 这一套命名，不再保留旧别名或旧状态目录 fallback。
