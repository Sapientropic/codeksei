# Codeksei Architecture And Quality Upgrade Plan

## 这份文档负责什么

这份文档仍是 `codeksei` 当前唯一的 active roadmap 入口，但 2026-04-13 这一轮“剩余技术债清零”已经完成。

它现在负责：

- 记录本轮完成后的真实基线
- 说明哪些旧批次已经彻底关账
- 明确后续若再发现新债，应该从哪里重新开新计划，而不是继续复用过期数字

style/type 例外的唯一真相源仍是 [`src/release/style-type-exception-inventory.json`](../../src/release/style-type-exception-inventory.json)。

## 当前状态

截至 2026-04-13，本轮剩余技术债清零与 shared/weixin continuity follow-up 已完成，当前基线是：

- `npm run check` 通过
- `npm run verify` 通过
- 当前测试文件是 `33` 个 `.test.js` 对 `36` 个 `.test.ts`
- `style-type-exception-inventory.json` 中：
  - `commonJsSourceAllowlist = []`
  - `tsNoCheckAllowlist = []`
- 仓库源码与测试中已无残留 `@ts-nocheck`
- `src/core/config-loader.ts` 的 `isNodeError` 守卫已补强，不再是 active debt
- Weixin 文本发送共语义已拆到 `delivery-text.ts` / `delivery-trace.ts`
- shared process/store/watchdog owner 已拆到独立 helper 与显式 shared types
- `RuntimeWatchdogLifecycle` 与 `SessionStore` 的高风险内部规则已拆到 approval/timer 与 lock/binding/approval helpers
- `tests/shared-mode-long-chain.test.ts` 已覆盖 built `dist` 下的 shared/open/status、approval continuity restart、以及 `stream / settled` reply mode smoke

这意味着旧文档里的以下说法都已过期，不应继续当成待办：

- “`34` 个 `.test.js` 对 `32` 个 `.test.ts`”
- “还剩 `33` 个 CommonJS source allowlist”
- “还剩 `5` 个 `@ts-nocheck` allowlist”
- “`config-loader` 弱守卫仍待补强”

## 本轮完成了什么

### 1. 类型与模块系统债已清零到当前目标

- 剩余 TS 源码里的 CommonJS 过渡写法已经从 active allowlist 中清空
- `src/notes/**`、`src/review/**`、`src/state/**`、`src/integrations/timeline/**`、`src/core/project-radar.ts`、Weixin 相关剩余边界文件都已收回到标准 `import / export` 形态
- 本轮保留 CommonJS 的只有构建产物和运行时确实要求 JS 的薄壳入口；它们不再计入 source allowlist
- `@ts-nocheck` 已从仓库测试层清空

### 2. 高误导 helper 语义已收口

- `src/contracts/command-surface.ts` 里原本会 `trim().toLowerCase()` 的 `normalizeText` 已改成 `normalizeCommandLookupKey`
- `src/core/approval-command-policy.ts` 的 trim-only helper 已改成 `normalizeTrimmedText`
- `src/adapters/channel/weixin/index.ts` 的配置裁剪 helper 已改成 `normalizeWeixinConfigText`

收口原则是：

- 只改“同名异义”的那些
- trim-only helper 可以继续局部存在
- lower-case / key matching / config trim 不再继续共用一个泛名 `normalizeText`

### 3. 非显而易见的 catch / fallback / guard 已补代码旁上下文

这轮明确补回代码旁说明的重点包括：

- `src/core/app.ts` 的 `runtimeEventChain.catch(() => {})`
- `src/runtime/backstage-task-lifecycle.ts` 的 screenshot failure best-effort cleanup
- `src/core/channel-command-workspace-handlers.ts` 的 reread failure notice best-effort send
- `src/runtime/stream-delivery/flush-scheduler.ts` 保留并继续依赖已有的串行化注释

对应保护也已补上：

- 新增回归测试，确保前一条 runtime event handler 失败后，后一条 event 仍会继续处理
- 命令 manifest lookup 继续有测试保护大小写和空白归一化，不会把 lower-case 语义误扩散到用户文本层

### 4. 三条真实 bucket 已按当前目标收口

- Weixin adapter：
  - `index.ts` 继续做 facade
  - `legacy.ts` 与 `delivery.ts` 不再各自维护一套文本 chunk / retry / trace 规则
  - `delivery-text.ts` / `delivery-trace.ts` 成为文本发送共语义 owner
  - login / protocol / account-store / context-token-store / message-utils 的 owner 边界已清楚到当前阶段目标
- Codex runtime adapter：
  - 第二轮 owner 收口继续保持在 `session-store / rpc-client / diagnostics / facade` 这条线上
  - `session-store` 内部 lock / binding / approval 规则已拆到独立 helper
  - 当前已不再依赖 style/type allowlist 兜底
- Shared / approval continuity：
  - `shared-process` 已拆成 context / state / control 三层
  - `runtime-watchdog-lifecycle` 已拆成 approval owner 与 timer owner
  - built `dist` smoke 会保护 restart 后 approval continuity 与 shared open/status 现场链路
- Note / Review / Timeline / State：
  - `note-sync`、`durable-note-schema`、review source/document/semantic 边界、timeline state sync、queue store 这一束已经从“兼容中间态”收成可维护的 typed boundary

## 完成定义校验

本轮原计划里的完成定义，当前状态如下：

- `commonJsSourceAllowlist` 清零：已完成
- `tsNoCheckAllowlist` 清零：已完成
- 高风险 `any` 从边界模块清掉或缩到明确低风险声明位：已完成到本轮目标
- `normalizeText` 只在“同语义”前提下保留同名：已完成
- 非显而易见 catch / fallback / guard 都有代码旁注释和测试：已完成到本轮目标
- Weixin / Codex / Note-Review-Timeline 三条 bucket 收口完成：已完成
- `docs/architecture.md` 与最终结构同步：已完成
- maintainer 级真实账号 smoke 仍建议额外手跑一次，但仓库内自动化长链路 smoke 已补齐：已完成到当前目标

说明：

- `.test.ts` 是否“超过” `.test.js` 不再是这份计划的核心完成定义，因为它只能当阶段信号，不能当真实债务真相
- 当前 `.test.ts = 36`、`.test.js = 33`，这个事实会保留，但不再用它代替真实 owner / 边界收口验收

## 历史批次映射

### 上一轮已完成并继续作为基线

- Batch A：Canonical Plan 收口
- Batch D：`src/core` 第一轮减重
- Batch E：Persisted State Ownership 收口
- Batch F：Shared Mode / Adapter Lifecycle 第一轮可维护性收口
- Batch G：架构边界保护测试
- Batch H：文档与真相层同步
- Batch I：`src/core` 第二轮 runtime orchestration 收口

### 在本轮完成关账

- Batch B：类型安全与模块系统收口
- Batch C：测试层类型化与测试运行时收口
- Batch J：精准收口剩余 `any` / CJS / 弱守卫
- Batch K：文本归一化语义收口
- Batch L：非显而易见 promise / fallback / guard 的注释与补强
- Batch M：Weixin Adapter 第二轮收口
- Batch N：Codex Runtime Adapter 第二轮收口
- Batch O：测试层继续类型化

## 当前稳定约束

这轮清债没有改变这些公开合同：

- public CLI 行为与命令名没有做破坏性改动
- 已存在的 JSON state shape 没有做无迁移翻转
- 运行时构建产物仍输出 CommonJS，没有切到运行时 ESM
- `src/core/app.ts` 与 `src/core/app-runtime-factory.ts` 仍承担 composition root / wiring 角色
- `graphify` 继续只作为 bucket 信号，不作为验收门

## 后续如果再发现新债，怎么开

当前不再保留 J-O 这类“还没做完”的 active batch。

如果后续又出现新的结构债，默认按下面规则新开，而不是复用这份文档里的旧数字：

- 先写真实 owner、真实文件、真实消费方
- 明确它是 correctness debt、boundary debt，还是单纯 style/type debt
- 只有当它会影响 `check` / `verify`、公开行为、持久化合同或维护判断时，才重新开 active batch
- style/type 数字统一只看 `style-type-exception-inventory.json`

这份文档到当前为止的作用，是把“这一轮已经清到哪里”说清楚，而不是继续制造下一轮的过期待办。
