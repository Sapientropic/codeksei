> [!IMPORTANT]
> Archived snapshot。自 2026-04-12 起，这份文档只保留**上一阶段 runtime/state hardening 的历史记录**。
> 
> 当前唯一 active 升级计划请看：
> [`../architecture-and-quality-upgrade-plan.md`](../architecture-and-quality-upgrade-plan.md)
>
> 下文保留的是当时阶段的结论、批次与验收轨迹，用于追溯，不再充当当前入口。

# Codeksei Engineering Hardening Plan

## 这份文档负责什么

这份文档现在只负责保留 `codeksei` 上一阶段 runtime/state hardening 的历史记录。

它收口两类内容：

- 当时已经存在的 runtime / state hardening 主线
- 2026-04-12 之前这一轮 hardening 的问题、批次与实施轨迹

当前 active 升级计划、后续 batch、开 issue 与 PR 收口，都应回到 [`../architecture-and-quality-upgrade-plan.md`](../architecture-and-quality-upgrade-plan.md)。

## 当前结论

截至 2026-04-12，这轮 hardening 计划的 A-G 批次已经全部落地完成。

当前状态可以概括为：

- canonical 计划入口已收口到本文件；旧路径 `docs/runtime-and-state-hardening-plan.md` 已删除
- Batch A/B/C 已分别收口 transport hardening、默认质量门 blind spot 和 README / docs truth alignment
- Batch D/E/F/G 已完成 runtime/session/queue 合同收口、managed state vs foreign document 写入分治、command surface 真收口与 `app.js` orchestrator 薄化
- 这轮的完成定义在代码与自动化测试层面已经满足；当前未补的只剩 maintainer 级真实 WeChat / shared-session live smoke

历史推荐顺序仍保留在本文后续 phase / batch 区块中，作为这轮实施轨迹与追溯材料。

[⚠️ 需确认]

- 本轮仍没有补真实 WeChat 登录和 live shared-session smoke；关于共享模式现场行为的最终判断仍以未来 maintainer 手工冒烟为准

## 当前基线

截至 2026-04-12，已确认：

- `npm run verify` 通过，`221` tests / `0` fail
- `tsconfig.json`、`npm run lint`、`npm run typecheck`、`npm run verify` 已经进入默认校验链
- `npm run lint` 现在通过 `scripts/check-covered-js-entrypoints.js` 自动覆盖 `bin/`、`src/`、`scripts/` 的 shipped JS entrypoints，当前 syntax gate 覆盖 `103` 个发布面 JS 文件
- `stream-delivery` 已拆出 `run-state`、`delta-merge`、`visible-text`、`delivery-transport`、`trace-abandonment`、`reply-target-registry`、`flush-scheduler`
- runtime / session / queue / config / command surface 的合同入口已分别收口到 `src/contracts/runtime-events.js`、`src/contracts/session-state.js`、`src/contracts/queue-items.js`、`src/contracts/config-files.js`、`src/contracts/command-surface.js`

[⚠️ 需确认]

- 本轮没有做真实 WeChat 登录和 live shared-session smoke，关于共享模式现场行为的判断主要来自代码与测试，不是在线运行证据

## 不可破坏边界

整个修复过程中默认守住：

- public CLI compatibility
- shared-mode persistence contracts
- weixin / codex runtime interop
- `Codeksei / codeksei / CODEKSEI_*` 作为唯一公开命名
- public repo 不引入单道杨本机专用路径、私有 vault 约定或 maintainer-only 操作细节

## L0-L3 问题地图

## L0 架构层

当前优点：

- `core / adapters / integrations / shared scripts` 的大层次边界已经成立
- `stream-delivery` 与 `runtime-watchdog-lifecycle` 的协作关系比较清楚，说明主线架构不是无序堆叠

当前问题：

- `src/core/app.js` 仍然同时承担 composition root、生命周期编排、queue glue、shutdown policy、bridge failure 收口
- command surface 的真相仍分散在 `package.json`、`src/contracts/command-surface.js`、`src/core/command-registry.js`、README / docs
- 计划、帮助、入口、校验链还没有完全做到单一真相源

架构判断：

- 现在还不应该先把 `app.js` 拆散
- 但必须先冻结 transport / config / command contracts，否则后面的拆分只会把隐含协议搬到更多文件里

## L1 加载层 / 启动层

本轮新增高优先级问题：

- `src/adapters/runtime/codex/rpc-client.js` 的 Windows spawn 仍走 `cmd.exe /c <command> app-server`
- 如果 `CODEX_COMMAND` 是带空格的绝对路径，启动会被 `cmd.exe` 解析坏
- spawn 模式下 `stderr` 没有被消费；长时间输出时会带来卡死或至少丢诊断风险
- README 仍写着“首次运行会在 state dir 生成 `weixin-instructions.md`”，但代码已经改成 repo template + local overlay 模型

已有但未完全收口的问题：

- review / durable-note / workspace bootstrap / alias config 仍有多种 loader 边界
- 帮助文本、命令面、dispatcher 仍不是完全由同一份 manifest 派生

## L2 运行时层

这是仍然最关键的一层。

之前已知主线问题：

- runtime event contract 分散
- `sessions.json` 深层 schema 校验不足
- approval continuity 在 bridge / runtime 重启后可能掉链
- `/status` usage 作用域曾经不准
- queue / persistence 合同未完全统一

本轮新增最高优先级问题：

- spawn 模式子进程退出时，只把 `isReady` 置回 `false`，没有 reject 掉 `pending` RPC promises
- 这会让 `initialize`、`turn/start`、`thread/resume`、approval response 等请求直接悬挂
- 用户表面看到的是 “bridge 没反应” 或 “共享线程卡住”，实际上是 transport 已死但等待链没被打断

运行时判断：

- `watchdog + stream-delivery + queue store` 的主体设计是值得保留的
- 现在最应该做的是补 transport hardening，不是重写 runtime 主链

## L3 代码细节层

当前问题：

- `npm run lint` 仍是手写长串 `node --check ...`
- 一批 JS 文件既不在 `lint` 链里，也不在 `tsconfig.json` typed surface 里，属于默认校验盲区
- `normalizeText` 一类小 helper 仍存在重复实现
- `README / docs / tests / code comment` 之间已有少量真相漂移

当前已确认的 blind spot 例子：

- `bin/codeksei.js`
- 已移除的历史 CLI 别名入口
- `src/adapters/channel/weixin/media-receive.js`
- `src/adapters/runtime/codex/protocol-leak-monitor.js`
- `src/core/branding.js`
- `src/core/instructions-template.js`
- `src/core/path-utils.js`
- `src/core/person-reference.js`

注意：

- `src/contracts/*.js` 当前在 `tsconfig.json` 里，属于 typed surface
- 问题不是“所有漏项都完全无保护”，而是默认质量门还不能证明全仓 shipped JS entrypoints 都被覆盖；这里至少包括 `bin/`、`src/`、`scripts/`

## 问题 -> 工作流映射

### A. Transport / Spawn Reliability

问题：

- spawn child close 没有 reject pending RPC
- spawn child stderr 没有 drain
- Windows `cmd.exe /c` 对带空格命令不稳

主要文件：

- `src/adapters/runtime/codex/rpc-client.js`
- 对应测试需新增到 `tests/`

### B. Release Gate / Verification Blind Spot

问题：

- `package.json` 的 `lint` 是手写列表，容易漏文件
- `tsconfig.json` 目前是保守 typed surface，不等于全仓 coverage
- 新文件或冷门文件可能既不 syntax-check，也不 typecheck
- 当前 blind spot 不只在 `src/`、`scripts/`，还包括真正对外发布的 `bin/` 入口
- 如果 coverage 断言只放在 tests 里，它只能保护 `npm run verify`，不能兑现 `npm run check` 的目标

主要文件：

- `package.json`
- `tsconfig.json`
- `bin/codeksei.js`
- 已移除的历史 CLI 别名入口
- 新增校验脚本建议放在 `scripts/` 或 `src/contracts/`

### C. Atomic Write / Persistence Policy

问题：

- `json-state.js` 已经提供原子写 + corrupt quarantine
- 但 `sync-buffer-store.js`、`diary-write-cli.js`、`note-sync.js`、`review.js`、`durable-note-schema.js` 仍然没有完全统一到同一套写入策略
- 当前文档里虽然保留了 `managed state` / `foreign document` 原则，但如果没有独立 phase 和 batch，这条主线很容易被 transport / command surface 任务挤掉

主要文件：

- `src/core/json-state.js`
- `src/adapters/channel/weixin/sync-buffer-store.js`
- `src/core/system-message-queue-store.js`
- `src/core/timeline-screenshot-queue-store.js`
- `src/app/diary-write-cli.js`
- `src/core/note-sync.js`
- `src/core/review.js`
- `src/core/durable-note-schema.js`

### D. Docs / Truth Drift

问题：

- README 的 persona bootstrap 描述与实际代码不一致
- command/help/docs 仍存在多真相源风险

主要文件：

- `README.md`
- `README.en.md`
- `docs/commands.md`
- `src/core/config.js`
- `src/index.js`
- `src/contracts/command-surface.js`

### E. Runtime Contract Completion

问题：

- runtime events、session schema、approval continuity、queue contract 仍需继续完成既定 hardening 主线

主要文件：

- `src/contracts/runtime-events.js`
- `src/contracts/session-state.js`
- `src/contracts/queue-items.js`
- `src/adapters/runtime/codex/events.js`
- `src/adapters/runtime/codex/session-store.js`
- `src/core/runtime-watchdog-lifecycle.js`
- `src/core/thread-state-store.js`
- `src/core/system-message-queue-store.js`

### F. Config / Command Surface Unification

问题：

- config loader、command manifest、help、dispatcher、parser 尚未完全收口

主要文件：

- `src/core/config-loader.js`
- `src/contracts/config-files.js`
- `src/contracts/command-surface.js`
- `src/contracts/command-args.js`
- `src/core/command-registry.js`
- `src/index.js`
- `src/app/*-cli.js`

### G. Orchestrator Split

问题：

- `app.js`、`review.js` 仍承担过多职责

主要文件：

- `src/core/app.js`
- `src/core/review.js`

## 执行原则

### 1. 先修硬故障，再修结构美观

当前最先要修的是：

- transport 死锁 / 吊死
- 启动路径不稳
- 质量门盲区
- 文档把人导向错误真相源

这些优先级高于“行数太大”或“还没迁 TS”。

### 2. 单一真相源优先

命令、帮助、config schema、persisted state shape、计划文档都必须尽量各有一个稳定入口。

这意味着：

- 不再新建第二份计划文档
- README / docs 更像说明层，而不是再镜像一套实现逻辑

### 3. typed surface 要继续保守扩面

不做 big-bang TS migration。

当前继续推荐：

- 先把边界合同、校验脚本、transport 相关模块纳入 typed surface
- 再考虑 orchestrator 层

### 4. managed state 与 foreign document 继续分治

保留现有原则：

- managed state：允许 schema validate + quarantine + fallback
- foreign document：要求 atomic write，但不能被 runtime quarantine 策略误伤

### 5. 大文件拆分要以职责边界为准

拆分目标不是“每个文件少于多少行”，而是：

- 纯判定
- 纯转换
- 纯 IO
- 编排 glue

各自独立。

### 6. 想保护 `npm run check` 的规则，必须进入 `check` 本身

如果目标写的是：

- “`npm run check` 不应继续存在 blind spot”

那么对应断言必须：

- 直接跑在 `check` 链里
- 或者被 `lint` / `typecheck` 显式调用

只把 coverage 断言放到 tests 里，最多只能保护 `verify`，不能保护 `check`。

## 分阶段实施计划

## Phase 0：冻结本轮真相与基线

目标：

- 把这轮 code review 的新增问题纳入现有单一计划入口
- 建立“默认校验链实际覆盖哪些文件”的可验证基线

实施：

- 更新本计划文档
- 产出一份自动校验或脚本，枚举 `bin/`、`src/`、`scripts/` 下哪些 JS 文件未被默认质量门覆盖
- 明确哪些规则必须在 `check` 生效，哪些只要求在 `verify` 生效
- 把 transport / spawn / docs drift 新问题写进 issue / batch 列表

验收：

- 本文成为唯一工程优化总计划
- blind spot 列表可由命令重算，而不是手工记忆

## Phase 1：Transport / Spawn Hardening

目标：

- 修掉最容易造成 bridge 吊死或启动失败的 transport 边界问题

实施：

- `rpc-client` 的 spawn `close` / `error` 路径统一走 `handleTransportClosed(...)`
- close / error 时 reject 所有 pending requests
- drain `child.stderr`
- Windows 下不要再依赖 `cmd.exe /c <command> app-server`；改成可安全处理空格路径的直接 spawn 策略
- 为 reconnect / pending rejection / startup failure 增补针对性测试

建议测试：

- child close 时 pending request 被 reject
- child stderr 连续输出不会卡住父进程
- Windows 带空格命令路径能生成正确 spawn spec
- reconnectable error 后能重新初始化

验收：

- 子进程意外退出不会让 RPC promise 永久悬挂
- Windows 自定义 `CODEX_COMMAND` 含空格时可以启动
- transport failure 在日志和用户面都能被稳定诊断

## Phase 2：Release Gate / Verification Hardening

目标：

- 解决 “`npm run check` 绿，但一部分真实文件根本没被检查” 的问题

实施：

- 用自动发现替代手写 `node --check` 长串，或新增一层脚本对全仓 JS 做 syntax gate
- 明确 `lint`、`typecheck`、`verify` 各自负责什么
- 为 blind spot 建一条 check-level gate：任何新增 `bin/**/*.js` / `src/**/*.js` / `scripts/**/*.js` 文件都必须落在至少一个默认质量门内
- 上述 gate 必须直接挂到 `npm run check` 链路，而不是只放到 tests
- tests 可以再补一条 verify-level contract test，作为 belt-and-suspenders，而不是主保护层
- typed surface 保守扩面，把 `branding.js`、`path-utils.js`、`instructions-template.js`、`person-reference.js`、`protocol-leak-monitor.js`，以及必要的 `bin/` entrypoints 纳入

建议测试：

- `scripts/check-covered-js-entrypoints.js` 或等价脚本，直接进入 `npm run check`
- `tests/check-coverage-contract.test.js` 作为 verify-level 回归保护
- 新增文件若未纳入 gate，`check` 本身直接失败

验收：

- 默认质量门覆盖 `bin/`、`src/`、`scripts/` 的全部 shipped JS entrypoints
- 新增文件不会再靠手工同步 `package.json` 长串

## Phase 3：Docs / Truth Surface Alignment

目标：

- 修复 README / docs 与当前实现真相的漂移

实施：

- 更新 README 中 persona bootstrap 说明：默认 truth 是 repo template + local overlay，而不是 state dir 生成的 `weixin-instructions.md`
- 检查 README.en 是否同步
- 对 `docs/commands.md` 做一次 truth sweep，确认与 `command-surface.js` 一致
- 如有必要，让帮助文本或 docs 片段更多由 manifest 派生，减少未来再漂移

验收：

- operator 按 README 排查 persona / overlay 时不会被带到错误路径
- command docs 不再和真实 manifest 明显偏离

## Phase 4：继续 Runtime / Session / Approval / Queue Hardening

目标：

- 继续完成原本已经启动的 runtime/state 主线，而不是半途停在“补了几处 transport bug”

实施：

- 收口 `runtime-events` producer / consumer / tests
- 深化 `session-state` schema，确保 nested invalid state 会被拒绝或隔离
- 持久化最小 pending approval record，保证 bridge / runtime 重启后审批还能继续
- `/status` usage truth 严格 thread-scoped
- queue item persisted shape 继续统一到合同层

验收：

- runtime event 名称与 payload shape 只在合同层定义一次
- approval continuity 经重启场景后仍可继续操作
- `/status` 不再串台

## Phase 5：Atomic Write / Persistence Policy 收口

目标：

- 把 `managed state` / `foreign document` 的写入边界重新拉回独立主线，而不是只留在原则里

实施：

- 为 atomic write 与文本写入 helper 建立稳定入口，避免写入策略继续散落
- 将 `sync-buffer-store.js`、queue store、`diary-write-cli.js`、`note-sync.js`、`review.js`、`durable-note-schema.js` 按文件类型分批迁移
- 明确 `managed state` 允许 quarantine / fallback，`foreign document` 只做 atomic write，不做 runtime-style quarantine
- 为 crash consistency、tmp 文件清理、文档写入边界补 targeted tests

建议测试：

- `tests/atomic-text-file.test.js`
- `tests/sync-buffer-store.test.js`
- `tests/queue-item-contract.test.js`
- 为 `diary-write` / `review` / `note-sync` 增补“不留 tmp 文件 / 不误隔离用户文档”的测试

验收：

- 关键状态写入不再继续散落成多套策略
- foreign document 写入具备原子性
- managed state 与 foreign document 的异常处理边界明确

## Phase 6：Config Loader / Command Surface / Parser 收口

目标：

- 让 config、command manifest、help、parser、dispatcher 继续往单一合同收口

实施：

- review / durable-note / workspace bootstrap / alias config 统一经 `config-loader` + schema 边界进入
- terminal / weixin command surface 从 manifest 派生
- CLI parser 继续从 leaf command 手写解析向统一 helper 收口

验收：

- 新命令接入只需要改 manifest + 单点实现
- config invalid / fallback 语义一致

## Phase 7：Selective Typed Surface Expansion

目标：

- 继续把边界型模块纳入 typed surface，不做 big-bang

优先候选：

- `rpc-client.js`
- `branding.js`
- `path-utils.js`
- `config-loader.js`
- `protocol-leak-monitor.js`
- 校验脚本 / contract 脚本

验收：

- 新增或修复的边界模块进入 `checkJs` / `typecheck`
- 不引入新的构建发布震荡

## Phase 8：Orchestrator Split

目标：

- 在合同与真相层稳定后，再拆 `app.js` / `review.js`

建议顺序：

1. 先把 `app.js` 中 transport / startup / queue orchestration 旁边的纯函数与 wiring helper 拆出去
2. 再把 `review.js` 拆成 profile loading、window resolution、source collection、draft build、document sync

注意：

- 当前 `stream-delivery` 已完成第一阶段拆分，不要为了“结构对称”再回头重做
- `app.js` 与 `review.js` 的拆分都必须建立在已有 contract 和 targeted tests 之上

验收：

- orchestrator 退回编排角色
- 回归定位可以落到更小的 pure module

## 推荐批次与顺序

建议按 7 个实施批次推进：

1. Batch A：Phase 1 transport / spawn hardening
2. Batch B：Phase 2 release gate / verification hardening
3. Batch C：Phase 3 docs / truth surface alignment
4. Batch D：Phase 4 runtime / session / approval / queue contract completion
5. Batch E：Phase 5 atomic write / persistence policy 收口
6. Batch F：Phase 6 config / command surface / parser 收口 + Phase 7 selective typed surface 扩面
7. Batch G：Phase 8 orchestrator split

推荐这样排序：

- A 必须最先做，因为它会直接影响共享桥接是否卡死
- B 紧随其后，因为没有质量门补强，后续所有批次都可能继续把盲区带下去
- C 很便宜，但能显著降低后续排障成本，适合在 A/B 后立刻做
- D/E/F/G 再按合同、持久化、配置、结构逐层推进

## 每批 PR 的最小建议范围

### Batch A：Transport / Spawn Hardening

改动范围：

- `src/adapters/runtime/codex/rpc-client.js`
- 新增对应测试

不要顺手做：

- 大规模命令面重构
- `app.js` 拆分
- README 改写

### Batch B：Release Gate / Verification Hardening

改动范围：

- `package.json`
- `tsconfig.json`
- `bin/codeksei.js`
- 已移除的历史 CLI 别名入口
- 新增 coverage / gate 脚本与测试

不要顺手做：

- runtime 合同重构

### Batch C：Docs / Truth Surface Alignment

改动范围：

- `README.md`
- `README.en.md`
- `docs/commands.md`

不要顺手做：

- 新增第二份 roadmap

### Batch D：Runtime / Session / Approval / Queue

改动范围：

- contract files
- `events.js`
- `session-store.js`
- `runtime-watchdog-lifecycle.js`
- `thread-state-store.js`
- queue store 相关模块

不要顺手做：

- typed surface 大扩面

### Batch E：Atomic Write / Persistence Policy

改动范围：

- `src/core/json-state.js`
- `src/adapters/channel/weixin/sync-buffer-store.js`
- queue store 相关模块
- `src/app/diary-write-cli.js`
- `src/core/note-sync.js`
- `src/core/review.js`
- `src/core/durable-note-schema.js`

不要顺手做：

- transport hardening
- 命令面重构

### Batch F：Config / Command Surface / Parser + Typed Surface

改动范围：

- `config-loader`
- `command-surface`
- `command-args`
- `command-registry`
- `src/index.js`
- `src/app/*-cli.js`
- `src/adapters/runtime/codex/rpc-client.js`
- `src/core/branding.js`
- `src/core/path-utils.js`
- `src/adapters/runtime/codex/protocol-leak-monitor.js`
- 校验脚本 / contract 脚本

### Batch G：Orchestrator Split

改动范围：

- `app.js`
- `review.js`

前提：

- A-F 已稳定

## 验收矩阵

每个 batch 至少跑：

- `npm run check`
- `node --test tests/*.test.js`

如相关批次涉及 typed surface 或 gate 收口，再补：

- `npm run typecheck`
- `npm run verify`

建议补的 targeted smoke：

- shared mode 启动 / reopen / status
- runtime approval -> restart -> approve
- transport child close / reconnect / startup failure
- weixin stream / settled reply 两种模式
- README 指南中的 persona / overlay 排障路径
- config invalid / fallback 场景

## 完成定义

以下条件同时满足，才算这轮计划完成：

- spawn transport 不会因 child close 把 pending RPC 永久挂住
- Windows 含空格 `CODEX_COMMAND` 启动稳定
- 默认质量门覆盖所有 `bin/`、`src/`、`scripts/` shipped JS entrypoints
- README / docs 不再把 persona bootstrap 指向旧真相
- runtime events、session state、queue items、command surface、config files 都各有明确合同入口
- approval continuity 与 `/status` usage truth 已稳定
- managed state 与 foreign document 的写入策略已经重新收口到独立主线，并完成落地
- orchestrator 拆分建立在稳定合同之上，而不是表面切文件

当前状态（2026-04-12）：

- 已满足：spawn transport 在 child close / error 时会 reject pending RPC；见 `tests/rpc-client.test.js`
- 已满足：Windows 含空格 `CODEX_COMMAND` 启动稳定；见 `tests/codex-spawn.test.js`
- 已满足：默认质量门覆盖所有 `bin/`、`src/`、`scripts/` shipped JS entrypoints；见 `scripts/check-covered-js-entrypoints.js`、`tests/check-coverage-contract.test.js`
- 已满足：README / docs 已不再把 persona bootstrap 指向旧 state-dir 真相；见 `README.md`、`README.en.md`、`docs/commands.md`
- 已满足：runtime events、session state、queue items、command surface、config files 都各有明确合同入口
- 已满足：approval continuity 与 `/status` usage truth 已稳定；见 `tests/approval-continuity.test.js`、`tests/status-usage-scope.test.js`
- 已满足：managed state 与 foreign document 写入策略已分治落地；见 `src/core/json-state.js` 与相关写入调用点、`tests/json-state.test.js`
- 已满足：orchestrator 拆分建立在稳定合同之上；`app.js` 已继续回收为 composition root，纯 helper / wiring helper 已拆到 `src/core/app-runtime-helpers.js`、`src/core/app-runtime-factory.js`

## 明确不做

本计划默认不优先做：

- 直接全仓迁 TypeScript
- 为了“更现代”先重写 shared mode
- 在合同未稳前大拆 `app.js`
- 再建第二份 code review 计划或 roadmap
- 只为了减少行数而做表面重构

## 当前进度（2026-04-12）

已完成：

- Batch A：Transport / Spawn Hardening
- Batch B：Release Gate / Verification Hardening
- Batch C：Docs / Truth Surface Alignment
- Batch D：Runtime / Session / Approval / Queue Contract Completion
- Batch E：Atomic Write / Persistence Policy 收口
- Batch F：Config / Command Surface / Parser 真收口 + selective typed surface 扩面
- Batch G：`app.js` orchestrator split（本轮以 `app.js` 为主，`review.js` 保持稳定，不做主动大拆）
- 旧计划入口 `docs/runtime-and-state-hardening-plan.md` 已删除；canonical 入口只保留本文件
- 本轮实现已提交：`075f525`（A/B/C）与 `546eb21`（D/E/F/G）

待补：

- maintainer 级真实 WeChat / shared-session live smoke

## 下一步

这轮大计划默认不再继续拆新 batch。

如需继续推进，下一步只建议做两件事：

1. 跑一次 maintainer 级真实 WeChat / shared-session smoke，验证 shared mode 现场行为
2. 若 smoke 暴露现场问题，再另开小范围 follow-up 修复；否则把这份文档视为当前阶段已完成的收口入口
