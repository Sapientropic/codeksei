# Codeksei Runtime / State Hardening Plan

## 目标

这份计划用于收口当前 code review 暴露出的核心工程问题，并把后续修复拆成可执行阶段。

本轮修复目标不是“把仓库看起来现代化”，而是优先解决以下真实风险：

- runtime event 合同分散、靠字符串字面量维持
- `sessions.json` 深层 schema 校验不足
- 审批请求在 bridge / runtime 重启后可能丢失连续性
- 状态与文档写入没有统一走原子写 helper
- `/status` 的 usage 作用域不准
- 命令面、帮助文本、parser、入口分散维护

## 结论

最优路径不是立刻全仓 big-bang 迁到 TypeScript。

当前推荐顺序是：

1. 先冻结合同
2. 再修 runtime / state 真问题
3. 再统一写入与 CLI 命令面
4. 最后渐进式引入 TypeScript

原因：

- 当前最高风险来自 contract drift 和状态连续性，而不是 JS 语法本身
- 这个仓已经有较强的测试基础；最应该补的是 producer / consumer / persisted state 的统一合同
- 直接全仓迁 TS 会把发布、CommonJS 入口、bin、脚本链路一起抬起来，收益和风险不成比例

## 不可破坏边界

整个修复过程中默认守住以下边界：

- public CLI compatibility
- shared-mode persistence contracts
- weixin / codex runtime interop
- `Codeksei / codeksei / CODEKSEI_*` 为主、`cyberboss / CYBERBOSS_*` 继续兼容

## L0-L3 对齐

这轮计划按 L0-L3 的关注层次收口，但资源优先级不是平均分配，而是优先解决 L2 的真实语义风险。

### L0 架构

已经纳入：

- `app.js`、`stream-delivery.js`、`review.js` 的拆分被明确放到“先冻结合同、后拆 orchestrator”
- 合同文件优先于大文件拆分，避免把隐含协议直接搬进新的模块边界里

补充约束：

- 拆分必须以“纯判定 / 纯转换 / 纯 IO”作为边界，而不是只按行数切文件
- 在 Phase 0-5 之前，不做以“更现代架构”为目标的大重写

### L1 加载层

已经纳入：

- command surface / help / dispatcher 单真相源
- config JSON 属于 schema 校验边界

本轮补充明确：

- `review.js`
- `durable-note-schema.js`
- `workspace-bootstrap.js`
- `workspace-alias.js`

这些 ad hoc `JSON.parse` loader 要进入统一 config loader hardening 范围，而不是只盯 `sessions.json`

### L2 运行时层

这是当前最高优先级，已经作为主线：

- runtime event contract
- approval continuity
- session schema
- delivery watchdog / stream consumer 对齐
- `/status` usage 作用域

原因：

- 这些问题会直接破坏产品语义和用户路径，不是代码风格问题

### L3 代码细节

已经纳入，但默认排在 L2/L1 主风险之后：

- `parseArgs` / `process.argv.slice(4)` 收口到统一 CLI parser helper
- `npm run check` 从 syntax-only 扩展到 typecheck / lint quality gates

本轮补充明确：

- `normalizeText` 重复实现要进入清债清单，但只在语义一致时收口；不要把 path、message text、domain-specific trim 逻辑误合并成一个“万能 helper”

## 当前问题地图

### A. Runtime Event Contract

问题：

- `src/adapters/runtime/codex/events.js` 输出 raw runtime event string
- `thread-state-store.js`、`runtime-watchdog-lifecycle.js`、`stream-delivery.js` 各自重复消费这些字符串
- `tests/codex-events.test.js` 目前只覆盖少量 happy path

结果：

- 上游 method 改名或 approval payload 形状变化时，容易静默打断 reply / watchdog / approval 流程

### B. Session / Approval State

问题：

- `SessionStore` 只做顶层 object 校验，嵌套 binding map 和 approval state 没有严格 schema
- `/yes`、`/always`、`/no` 依赖内存里的 `pendingApproval`
- 重启后虽然还记得部分 request metadata，但未必能恢复完整审批上下文

结果：

- JSON 可解析但结构损坏时可能被半加载
- 用户已经看到审批提示，但 bridge 重启后无法继续处理

### C. Atomic Write / Persistence Policy

问题：

- `json-state.js` 已经提供原子写 + corrupt quarantine
- 但 `sync-buffer-store.js`、`diary-write-cli.js`、`note-sync.js`、`review.js`、`durable-note-schema.js` 仍有直接 `fs.writeFileSync`

结果：

- crash consistency 策略不统一
- 运行态文件和用户文档文件没有清晰区分“managed state”和“foreign document”

### D. Usage Scope / Status Truth

问题：

- `ThreadStateStore` 只有一个全局 `latestUsage`
- `/status` 直接读取这个全局 usage

结果：

- 共享模式下 A 线程可能看到 B 线程最新 token / rate-limit 信息

### E. Command Surface Drift

问题：

- `command-registry.js`、`src/index.js`、`package.json` scripts、各个 `src/app/*-cli.js` parser 各维护一份命令真相
- 普遍存在手写 `process.argv.slice(4)` 和手写 flag parser

结果：

- help / docs / parser / wiring 容易漂移
- 类型化后仍可能保留多真相源

### F. Orchestrator Hotspots

当前大文件：

- `src/core/stream-delivery.js`
- `src/core/review.js`
- `src/core/app.js`

问题不是“文件行数大”本身，而是：

- 合同未冻结前，这些 orchestrator 同时承担状态机、协议适配、文本处理、IO 和错误恢复
- 后续任何改动都更容易在跨层边界上回归

### G. Config Loader / Schema Boundary

问题：

- `review.js`、`durable-note-schema.js`、`workspace-bootstrap.js`、`workspace-alias.js` 仍有 ad hoc `JSON.parse`
- env load 顺序和兼容策略总体可用，但文件配置层还没有统一 loader + schema + fallback 语义

结果：

- 配置文件可解析但结构不对时，容易在业务逻辑内部晚爆
- loader 行为、默认值和错误提示不统一

### H. Low-Level Duplication / Tooling Gaps

问题：

- 多处重复实现 `normalizeText`
- 多个 CLI 入口手写 `parseArgs` 与 `process.argv.slice(4)`
- `package.json` 里的 `check` 仍偏 syntax-only，没有把 typecheck / lint 纳入默认质量门

结果：

- 小差异容易累积成行为漂移
- 新命令、新参数、新入口更难保持一致

## 执行原则

### 1. 先合同，后迁移

每一类 producer / consumer / persisted state 必须先明确唯一合同，再谈 TS、拆文件、重构。

### 2. Zod / JSON Schema 用在边界，不用在每个热路径都 parse

推荐用法：

- persisted state
- CLI args
- config JSON
- adapter ingress / egress payload

不推荐：

- 在每个 `runtime.reply.delta` 的热路径里层层重复 parse

### 3. Managed State 和 Foreign Document 分开治理

要明确两类文件：

- managed state：运行态真相，允许 quarantine / fallback
- foreign document：用户文档、note、review、diary，要求原子写，但不能随便做 corrupt quarantine

### 4. 单真相源优先于“顺手补一份文档”

命令、事件、store schema 都应收口到单一入口；README / docs 只引用或围绕它解释，不再镜像一份逻辑。

### 5. 先修用户会踩的坑，再做结构整理

优先级固定：

1. runtime event contract
2. approval continuity + session schema + status usage
3. atomic write consistency + queue item contract
4. config loader hardening + command surface / command args unification
5. incremental TypeScript + typecheck / lint gates
6. orchestrator split

## 分阶段执行计划

## Phase 0：建立合同骨架与基线

目标：

- 把“未来所有阶段要围绕什么合同改”先钉死

建议新增：

- `src/contracts/runtime-events.js`
- `src/contracts/session-state.js`
- `src/contracts/queue-items.js`
- `src/contracts/command-surface.js`
- `src/contracts/command-args.js`
- `src/contracts/config-files.js`
- `tests/runtime-event-contract.test.js`
- `tests/session-store.test.js`

本阶段工作：

- 盘点所有 runtime event 名称、payload 字段和 consumer
- 盘点 `sessions.json` 结构和所有读写点
- 盘点 queue item 形状、producer、consumer、persisted shape
- 盘点现有 terminal / weixin command surface 和 parser 分布
- 盘点所有 ad hoc config loader 和 `JSON.parse` 边界
- 约定 persisted state / config file 的 versioning 与 compatibility 策略
- 为后续阶段建立 fixture 和 golden cases

验收：

- runtime event 名称只在合同文件里定义一次
- session persisted shape 有明确 schema 草图
- queue item persisted shape 有明确 schema 草图
- review / durable-note / workspace config 有明确 schema 草图
- command surface 有一份清单，不再靠 `README + help + parser` 对读

## Phase 1：修复 Runtime Event Contract

目标：

- 去掉 runtime event 字符串合同的分散复制

建议落点：

- `src/adapters/runtime/codex/events.js`
- `src/core/thread-state-store.js`
- `src/core/runtime-watchdog-lifecycle.js`
- `src/core/stream-delivery.js`

实施要点：

- 在 `src/contracts/runtime-events.js` 中定义 event name 常量和 payload shape helper
- `mapCodexMessageToRuntimeEvent()` 只负责“Codex message -> normalized runtime event”
- 下游 consumer 一律 import 合同常量，不再自己手写字符串
- 对 approval payload 做统一 normalize，避免 downstream 反复猜字段

建议测试补齐：

- `turn/started`
- `turn/completed`
- `turn/failed`
- `item/agentMessage/delta` 的 delta / snapshot 两种形态
- `item/completed`
- usage 更新
- approval request 多种 payload 形态
- unknown / unsupported method 返回 `null`

额外加一道 consumer 对齐测试：

- 校验每个已定义 runtime event 至少被核心 consumer 显式处理，或显式标记为 ignored

验收：

- runtime event 名称不再散落在多个 consumer 中裸写
- `tests/codex-events.test.js` 从 happy path 补到 contract coverage
- 上游 method 名称漂移时，优先在测试层爆，而不是线上 silent break

## Phase 2：修复 Session Schema 与 Approval Continuity

目标：

- 把 `sessions.json` 从“顶层合法”提升到“结构合法”
- 审批在 bridge / runtime 重启后仍能继续处理

建议落点：

- `src/adapters/runtime/codex/session-store.js`
- `src/core/channel-command-control-handlers.js`
- `src/core/runtime-watchdog-lifecycle.js`
- `src/core/thread-state-store.js`

实施要点：

- 为 `bindings`
- `threadIdByWorkspaceRoot`
- `codexParamsByWorkspaceRoot`
- `workspaceBootstrapThreadIdByWorkspaceRoot`
- `approvalPromptStateByThreadId`
- `availableModelCatalog`

建立严格 schema validator

审批连续性建议改法：

- 让 `SessionStore` 持久化最小可恢复的 pending approval record，而不是只记 dedupe signature
- `ThreadStateStore` 继续维护运行态 view，但 `/yes` `/always` `/no` 不能只依赖内存
- 重启恢复时，把 persisted pending approval 与当前 thread/binding 对齐
- approval resolve / clear 时，内存态和持久态一起收口

顺带修复：

- `/status` 的 usage 改成 thread-scoped 或 thread+workspace-scoped
- 不再使用单一全局 `latestUsage`

建议新增测试：

- `tests/session-store.test.js`
- `tests/approval-continuity.test.js`
- `tests/status-usage-scope.test.js`

核心场景：

- nested schema invalid -> quarantine
- approval pending -> restart -> `/yes` 仍能成功
- approval resolved -> persisted state 清空
- A/B 两条线程各自 usage 不串台

验收：

- JSON 可解析但 schema 错误的 session state 会被隔离
- 审批请求在 bridge 重启后仍可继续响应
- `/status` 只显示当前 thread 的 usage truth

## Phase 3：统一 Atomic Write、Queue Contract 与 State/File Policy

目标：

- 让所有关键写入都走统一 helper
- 让 queue item 合同有单一入口
- 明确 managed state 与 foreign document 的不同写入策略

建议新增：

- `src/core/atomic-file.js` 或 `src/core/text-state.js`

建议能力拆分：

- `writeJsonFileAtomically()`：JSON 原子写
- `writeTextFileAtomically()`：文本原子写
- `readManagedJsonStateFile()`：允许 schema validate + quarantine
- `readForeignJsonDocument()`：只 fallback，不 quarantine

迁移目标：

- `src/adapters/channel/weixin/sync-buffer-store.js`
- `src/core/system-message-queue-store.js`
- `src/core/timeline-screenshot-queue-store.js`
- `src/app/diary-write-cli.js`
- `src/core/note-sync.js`
- `src/core/review.js`
- `src/core/durable-note-schema.js`

策略要求：

- `sync-buffer` 属于 managed runtime state，应纳入 crash-safe policy
- queue store 应导入统一 queue item schema / validator，而不是各自手写形状真相
- `diary/review/note` 属于 foreign document，应使用原子写，但不能用 runtime state 的“损坏即隔离”策略误伤用户文档

建议新增测试：

- `tests/atomic-text-file.test.js`
- `tests/sync-buffer-store.test.js`
- `tests/queue-item-contract.test.js`
- 为 `diary-write` / `review` / `note-sync` 增补“不会留下 tmp 文件”的测试

验收：

- 关键状态文件写入不再直接裸用 `fs.writeFileSync`
- queue item 合同有单一 schema / validator 入口
- foreign document 写入具备原子性
- managed state 与 foreign document 的异常处理边界明确

## Phase 4：统一 Config Loader、Command Surface 与 CLI Parser

目标：

- 让加载层的 JSON / env / help / dispatcher 进入单一合同体系
- 让命令面只剩一份真相源

建议落点：

- `src/core/config-loader.js` 或等价 loader helper
- `src/core/review.js`
- `src/core/durable-note-schema.js`
- `src/core/workspace-bootstrap.js`
- `src/core/workspace-alias.js`
- `src/contracts/command-surface.js`
- `src/core/command-registry.js`
- `src/index.js`
- `src/app/*-cli.js`

实施要点：

- 建立统一 config loader helper，负责 read + parse + schema validate + default / fallback
- 将 review profile、durable note schema config、workspace bootstrap / alias config 从 ad hoc `JSON.parse` 收口到该 helper
- 建立统一 command manifest，描述：
  - topic
  - action
  - terminal forms
  - weixin forms
  - summary
  - parser contract
  - args schema
  - help contract
- parser helper 收口，不再每个 CLI 都手写一套 flag 解析
- CLI 入口统一消费规范化后的 `args`，逐步移除 leaf command 里的 `process.argv.slice(4)`
- `command-registry.js` 的 help 文本从 manifest 派生
- `src/index.js` 的 dispatch 与 manifest 对齐

注意：

- `docs/commands.md` 仍可保留叙事型说明
- 但命令清单和参数 shape 不应再靠手工镜像维护

建议新增测试：

- `tests/config-loader.test.js`
- `tests/command-surface-contract.test.js`
- `tests/cli-arg-parser.test.js`

验收：

- review / durable-note / workspace config loader 不再直接裸用 ad hoc `JSON.parse`
- terminal / weixin help、dispatcher、parser 由同一份 manifest 驱动
- 新增或改名命令时，不需要改四五处独立映射

## Phase 5：渐进式引入 TypeScript

目标：

- 用最小代价把合同真正类型化

结论：

- 不建议现在立刻全仓迁 TS
- 建议先 `typecheck-first`，再 selective migration

### Phase 5A：先上 Type Checking，不改运行时产物

建议：

- 新增 `tsconfig.json`
- 打开 `allowJs`
- 打开 `checkJs`
- 使用 `noEmit`
- 新增最小可执行的 `npm run lint`
- 新增统一校验入口，例如 `npm run verify`

优先加 `// @ts-check` 的模块：

- `src/contracts/*`
- `src/core/config-loader.js`
- `src/adapters/runtime/codex/events.js`
- `src/adapters/runtime/codex/session-store.js`
- `src/core/json-state.js`
- queue store
- CLI parser helper

### Phase 5B：优先迁 contract-heavy leaf modules

优先迁移候选：

- `events`
- `session-store`
- `json-state`
- `system-message-queue-store`
- `timeline-screenshot-queue-store`
- CLI args / parser helper

原因：

- 这些模块输入输出更稳定
- 最容易从 TS 获得收益
- 不会立刻把整个 bootstrap / bin / shared scripts 链路一起掀翻

### Phase 5C：最后再评估 orchestrator 层

最后才考虑：

- `app.js`
- `stream-delivery.js`
- `review.js`

因为这些文件在 Phase 0-4 之前迁 TS，往往只是把“大量隐含合同”换成“大量临时类型断言”。

验收：

- 新增 `npm run typecheck`
- `npm run lint` 和 `npm run verify` 能进入默认开发链
- 关键 contract-heavy 模块具备真实类型约束
- 不引入新的发布构建回归

## Phase 6：在合同稳定后拆 Orchestrator

目标：

- 降低后续维护和回归半径

### app.js

建议拆成：

- bootstrap / startup
- long poll loop
- runtime wiring
- backstage dispatch
- failure handling

### stream-delivery.js

建议拆成：

- run state model
- delta / snapshot merge
- visible text sanitization
- delivery transport
- trace / dedupe / abandonment

### review.js

建议拆成：

- schema/profile loading
- window resolution
- diary/nightly source parse
- deterministic draft build
- managed block sync

注意：

- 拆分目标不是“文件必须小于多少行”
- 目标是把纯判定、纯转换、纯 IO 分开，让测试更细、更稳

验收：

- orchestrator 只保留编排，不再承载大量纯转换逻辑
- 关键纯函数模块可单测

## 推荐实施批次

建议按 6 个批次做，不要一口气合成大 PR：

1. contracts + runtime event hardening
2. session schema + approval continuity + usage scope
3. atomic file helpers + queue contract + persistence migration
4. config loader + command surface manifest + parser unification
5. typecheck / lint gate + selective TS
6. orchestrator split

## 每批 PR 切分建议

### Batch 1：contracts + runtime events

建议改动：

- 新增 `src/contracts/runtime-events.js`
- 收口 `src/adapters/runtime/codex/events.js`
- 替换 `thread-state-store.js`、`runtime-watchdog-lifecycle.js`、`stream-delivery.js` 里的裸字符串
- 补 `tests/codex-events.test.js` 与 consumer 对齐测试

控制点：

- 不同时改 approval persistence
- 不在这一批引入 TS 构建

完成标志：

- runtime event 名称只保留一份定义
- 现有 reply / watchdog / delivery 行为 smoke 不回归

### Batch 2：session schema + approval continuity + usage scope

建议改动：

- 为 `SessionStore` 建立深层 schema
- 持久化最小 pending approval record
- 恢复路径补齐 pending approval rehydrate
- 把 `/status` usage 改成 thread-scoped

控制点：

- 明确 approval record 的最小字段集，避免把瞬时 UI 状态整包持久化
- 每改一处 persisted shape 都补 migration / compatibility 测试

完成标志：

- restart 后 approval 可继续处理
- invalid nested session state 会被拒绝或隔离
- A/B 线程 usage 不串台

### Batch 3：atomic file helpers + queue contract + persistence migration

建议改动：

- 新增统一 atomic file helper
- 先迁 `sync-buffer-store.js`
- 把 queue store 的 item shape 校验收口到统一 schema
- 再迁 `diary-write-cli.js`、`note-sync.js`、`review.js`、`durable-note-schema.js`

控制点：

- helper API 必须显式区分 managed state 与 foreign document
- 不把 quarantine 逻辑传播到用户文档写入

完成标志：

- 关键状态写入都不再直接裸写
- queue item 校验不再分散成多份手写真相
- 文档类写入具备原子性但不被 runtime quarantine 误伤

### Batch 4：config loader + command surface + parser

建议改动：

- 新增统一 config loader helper
- 收口 review / durable-note / workspace config loader
- 新增 command manifest
- `command-registry.js` / `src/index.js` / CLI parser 从 manifest 派生
- `docs/commands.md` 只保留叙事说明和示例

控制点：

- 先兼容现有命令形式，再收口内部实现
- 不把“生成文档”误做成第二真相源

完成标志：

- 配置加载边界具备统一 schema / fallback 语义
- help、parser、dispatch 共用同一份命令合同
- 新命令接入只改 manifest 和单点实现

### Batch 5：typecheck / lint gate + selective TS

建议改动：

- 新增 `tsconfig.json`
- 新增最小 `lint` 能力
- 引入 `npm run typecheck`
- 引入 `npm run verify`
- 先 `allowJs + checkJs + noEmit`
- 再迁 contract-heavy leaf modules

控制点：

- 不在这一批顺手改 bin、发布链、CommonJS 入口
- 只有合同稳定的叶子模块才迁 `.ts`

完成标志：

- 类型检查和 lint 进入默认校验链
- 关键合同模块类型化，但不引入运行时构建震荡

### Batch 6：orchestrator split

建议改动：

- 以合同稳定后的纯判定 / 纯转换 / 纯 IO 为拆分边界
- 优先拆 `stream-delivery.js`
- 再拆 `app.js`
- 最后拆 `review.js`

控制点：

- 拆分必须伴随测试颗粒度提升
- 不做“只切文件、不收责任”的表面重构

完成标志：

- orchestrator 退回编排角色
- 关键子模块可独立单测和定位回归

## 风险控制与回滚策略

默认要求：

- 每个 batch 独立成 PR，避免把合同变更、持久化变更、CLI 变更、TS 变更揉成一次大上线
- 每个 batch 都保留一条最小 smoke 路径，确认 shared mode、reply、approval、status 至少一条主链仍可走通

高风险点：

- persisted session shape 变更
- approval continuity 恢复逻辑
- stream delivery 对 delta / snapshot 的兼容
- weixin sync cursor 写入策略切换
- config loader 默认值 / fallback 语义变化

回滚原则：

- contract 文件新增一般可直接回滚
- persisted state shape 一旦变更，必须保证旧文件仍可读，至少维持一个版本的向后兼容
- 新 helper 替换旧写入逻辑时，先保留旧行为语义，再替换实现细节，不要一批里同时改语义和存储策略

## 验收矩阵

每个批次至少跑：

- `npm run check`
- `node --test tests/*.test.js`

在引入 typecheck 后追加：

- `npm run typecheck`
- `npm run lint`
- `npm run verify`

建议补的 targeted smoke：

- shared mode 正常启动 / reopen / status
- runtime approval -> restart -> approve
- system message queue defer / dead-letter / recovery
- timeline screenshot queue
- weixin stream / settled reply 两种模式
- review profile / workspace bootstrap / durable note config 的 invalid config fallback

## 完成定义

以下条件同时满足，才算这轮修复完成：

- runtime event、session state、command surface 都有单一合同入口
- queue item、command args、config files 也进入单一合同入口
- approval 不再因为 bridge 重启丢失可操作性
- `sessions.json` 嵌套结构错误会被拒绝或隔离
- `/status` usage 作用域正确
- managed state 与 foreign document 写入策略分清
- 关键写入统一走原子写 helper
- `npm run typecheck` / `npm run lint` / `npm run verify` 已进入默认校验链
- 大文件拆分建立在稳定合同之上，而不是只做表面切文件

## 明确不做

本计划默认不把下面这些事情当成第一优先：

- 为了迁 TS 先重做发布链
- 在没有统一合同前直接大拆 `app.js` / `stream-delivery.js`
- 对所有运行时热路径无差别套 Zod parse
- 为了“去重”强行把所有 `normalizeText` 合并成一个全局万能函数
- 只为了“减少行数”而重构

## 阶段进度（2026-04-12）

- Phase 5 已完成：`tsconfig.json`、`npm run lint`、`npm run typecheck`、`npm run verify` 已进入默认校验链。
- Phase 6A 已完成：`stream-delivery` 已拆出 `run-state`、`delta-merge`、`visible-text`、`delivery-transport`、`trace-abandonment`。
- Phase 6B 已完成：`stream-delivery` 第二批拆出 `reply-target-registry`、`flush-scheduler`，`StreamDelivery` 保持唯一对外入口；`src/core/stream-delivery/*.js`、`runtime-watchdog-lifecycle.js`、`thread-state-store.js`、`message-utils.js`、`model-catalog.js` 已纳入保守 typed surface 并补 `@ts-check`。
- 当前仍留作后续 debt：`src/core/app.js`、`src/core/review.js`、shared scripts 仍不在本轮 typed surface 内；若后续类型扩面会被动触发它们，应单独开下一阶段处理。

## 下一步

按这个顺序开工：

1. 先做 Phase 0 + Phase 1
2. 紧接着做 Phase 2
3. 然后做 Phase 3

理由：

- runtime event contract 和 approval continuity 是当前最容易造成用户感知错误的部分
- atomic write 与 CLI 收口更适合作为第二波结构化改善
- TypeScript 应该建立在前面几轮已经稳定的合同之上
