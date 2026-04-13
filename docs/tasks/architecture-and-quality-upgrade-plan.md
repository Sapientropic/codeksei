# Codeksei Architecture And Quality Upgrade Plan

## 这份文档负责什么

这是 `codeksei` 当前唯一的 active engineering roadmap。

它只负责仍在推进的结构与质量收口，不再复述上一阶段已经完成的
runtime/state hardening 历史。历史批次、旧验收口径与实现轨迹，统一留在
[`runtime-and-state-hardening-plan.md`](./runtime-and-state-hardening-plan.md)。

## 当前目标（2026-04-13）

本轮 active work 只有 3 条：

- 修复 `docs/tasks/` 真相层断链，恢复一个真实存在的 active roadmap 入口
- 把 4 个高风险边界文件的显式 `any` 收到 `0`
- 统一 `check` / `verify` / maintainer real smoke 的证据口径，避免把仓内 fake-harness 证明写成 live 集成证明

## 活跃主线

### 1. Truth Surface Repair

目标：

- `docs/tasks/` 对当前入口、历史快照、已完成计划的表达不再互相打架
- 新人从 README / architecture / tasks 进入时，能立刻分清：
  - 当前活跃计划在哪里
  - 历史 hardening 在哪里
  - 哪些 smoke 是仓内自动化，哪些是 maintainer live smoke

完成定义：

- `runtime-and-state-hardening-plan.md` 顶部明确标成 archived snapshot
- 本文件成为唯一 active roadmap
- 文档测试能直接断言 forward link 存在且可达

### 2. Boundary Typing Follow-up

目标：

- 只收口 4 个最关键的热点边界文件，不做全仓清债运动

本轮范围：

- `src/contracts/session-state.ts`
- `src/core/system-message-dispatcher.ts`
- `src/core/approval-command-policy.ts`
- `src/integrations/timeline/state-sync.ts`

约束：

- persisted JSON shape 不变
- public CLI、script name、env name 不变
- shared-mode、approval continuity、timeline timezone 现有语义不翻转

完成定义：

- 上述 4 个文件显式 `any = 0`
- 相关 targeted tests 通过

### 3. Evidence Stratification

目标：

- 默认质量门与真实集成验证的证明边界清楚可见

稳定口径：

- `npm run check`：默认快速质量门
- `npm run verify`：包含 built `dist` + fake Codex / fake Weixin 的仓内 integration proof
- `npm run smoke:shared:real:*`：maintainer-only assisted live smoke，不并入默认 CI

完成定义：

- `docs/architecture.md` 与 `docs/commands.md` 都按这三层表述
- docs contract tests 能防止“fake 自动化被误写成真实 smoke”

## 本轮不做

- 不把 real smoke 自动化进 `verify` 或 CI
- 不引入 repo-wide `any` budget、inventory 或评分层
- 不顺手扩大到 `config-files.ts`、`runtime-events.ts`、`reminder-write-cli.ts`、`model-catalog.ts`

## 验收

本轮默认验收命令：

- `npm run check`
- `npm run verify`

并补以下回归保护：

- approval policy targeted tests
- timeline state sync targeted tests
- system message dispatcher direct test
- docs truth / roadmap link contract test
- 关键 4 文件无显式 `any` 的 guard test
