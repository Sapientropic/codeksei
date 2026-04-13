# Codeksei 四热点类型收口与 Live Smoke 证据面计划

## 这份文档负责什么

这是 `codeksei` 当前唯一的 active engineering roadmap。

当前阶段只收口三件事：

- 4 个高杠杆热点文件的类型债
- maintainer live smoke 的 recorded 结果入口
- `docs/tasks/` 的 active / archive / local notes 分层

上一阶段 runtime/state hardening 的历史记录已归档到：
[`archive/runtime-and-state-hardening-plan.md`](./archive/runtime-and-state-hardening-plan.md)

目录入口统一看：
[`README.md`](./README.md)

## 当前目标（2026-04-13）

- `src/contracts/runtime-events.ts`
- `src/contracts/config-files.ts`
- `src/app/reminder-write-cli.ts`
- `src/adapters/runtime/codex/model-catalog.ts`

这些文件都属于 runtime / config / reminder / codex model catalog 的高杠杆边界。
本轮目标是把它们的显式 `any` 收到 `0`，并把相关 consumer 改成复用同一份 contract 类型。

同时补一条稳定文档入口：

- `docs/maintainer/live-smoke.md`

它只负责 recorded maintainer live smoke 结果，不把仓内 fake-harness proof 写成 live 现场证明。

## 活跃主线

### 1. Boundary Typing Follow-up

范围：

- `src/contracts/runtime-events.ts`
- `src/contracts/config-files.ts`
- `src/app/reminder-write-cli.ts`
- `src/adapters/runtime/codex/model-catalog.ts`

完成定义：

- 上述 4 个文件显式 `any = 0`
- 相关 consumer 改用导出的类型真相层，不再各自复制平行 shape
- persisted JSON shape、public CLI / script / env name 不变
- targeted tests 通过

### 2. Live Smoke Evidence Surface

目标：

- maintainer assisted live smoke 有一个 repo-tracked、持续更新、可审计的稳定入口

稳定口径：

- `npm run check`：默认快速质量门
- `npm run verify`：built `dist` + fake Codex / fake Weixin 的仓内 integration proof
- `npm run smoke:shared:real:*`：maintainer-only assisted live smoke
- `docs/maintainer/live-smoke.md`：最近一次 recorded live smoke 结果入口

完成定义：

- `src/maintainer/shared-real-smoke.ts` 支持 `--record`
- archive 落到 `docs/maintainer/live-smoke/archive/`
- `docs/commands.md` 与 `docs/release.md` 都指向这个入口
- 没有 recorded run 时，文档明确写“尚无 recorded live smoke 证据”

### 3. Tasks Truth Surface Repair

目标：

- `docs/tasks/` 只保留一个 active roadmap 入口
- 历史计划进入 archive
- `*.local.md` 继续视为本地维护材料，不进入公开索引

完成定义：

- `docs/tasks/README.md` 成为目录入口
- `runtime-and-state-hardening-plan.md` 迁到 `docs/tasks/archive/`
- docs truth tests 能断言 active roadmap、archive snapshot、live smoke 入口都可达

## 本轮不做

- 不把 real smoke 自动化进 `verify` 或 CI
- 不扩大成 repo-wide `any` budget / inventory / 评分层
- 不改 public CLI 名称、script 名称、env 名称
- 不改 persisted JSON schema

## 验收

- `npm run check`
- `npm run verify`

[⚠️ 需确认]

- 真实 `smoke:shared:real:*` 不在本轮自动执行；仍需 maintainer 在可用环境里至少补一次 recorded run，才能把 live 现场证明补齐。
