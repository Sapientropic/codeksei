# Hermes Cron Env Patch

这份文档是 `Hermes Hosted Mode` 下 cron `env` 兼容补丁的唯一详细入口。

补丁资产在：

- [`tools/hermes_repo_local/patches/hermes-cron-env.patch`](../tools/hermes_repo_local/patches/hermes-cron-env.patch)

## 结论

- 从 `2026-04-16` 起，`Codeksei` 的 hosted check-in 主链已经**不再依赖** Hermes upstream 先支持 cron `env` 才能继续工作。
- 可选补丁仍然保留在 `Codeksei` 仓内，给 Hermes 用户自己决定要不要把原生 cron `env` 能力一起补上。

也就是说：

- 不打补丁：`Codeksei` hosted check-in 仍应继续可用。
- 打补丁：Hermes 自己的 cron job schema / API / tool / scheduler 也会原生理解并执行 per-job `env`。

## Codeksei 现在自己兜住了什么

当前主链靠两层保证避免“sync-checkin 一失败整条链断掉”：

1. hosted check-in 相关 CLI 现在会从 `codeksei.config.json` 回填关键 `CODEKSEI_*` 变量。

这意味着 Hermes cron run 就算是干净环境，只要：

- 命令带了 `--workspace-root`
- workspace 下有 canonical `codeksei.config.json`

`system checkin-tick` / `system checkin-complete` / `operator hermes sync-checkin` 仍能自举到正确的 hosted mode。

2. repo-local `sync_checkin_cron` 现在按“先确保新 job 成功，再删旧 job”执行。

以前的危险点是：

- 先删 recovery / wake job
- 再创建新的 desired wake
- 中途一旦失败，未来 job 变成 `0`

现在即使 create/update 失败，旧的 recovery wake 也会先保住，避免 check-in 链直接断掉。

## 什么时候还值得打这个补丁

当你希望 Hermes 自己也原生支持以下能力时，再考虑打补丁：

- cron job schema 能保存 `env`
- cron scheduler 运行 job 时真正注入 per-job `env`
- API / web server / cron tool 能把 `env` 透传到 job store

适用场景：

- 你不只跑 Codeksei hosted check-in，还想让 Hermes 其他 hosted cron workflow 也吃到 per-job `env`
- 你希望 `CODEKSEI_RUNTIME=hermes`、`CODEKSEI_STATE_DIR` 这类运行时上下文作为 Hermes job 的第一等字段持久化
- 你想让 Hermes API / cronjob tool 自己暴露 `env`

不适用场景：

- 你只是想让 Codeksei hosted check-in 不断链
- 你当前只依赖 Codeksei 的 repo-local hosted check-in 主链

## 怎么应用

在 Hermes checkout 根目录执行：

```bash
git apply /absolute/path/to/codeksei/tools/hermes_repo_local/patches/hermes-cron-env.patch
```

如果你的 `Codeksei` 和 `hermes-agent` 是 sibling checkout，示例：

```bash
git -C ../hermes-agent apply ../codeksei/tools/hermes_repo_local/patches/hermes-cron-env.patch
```

建议先检查是否能 clean apply：

```bash
git -C ../hermes-agent apply --check ../codeksei/tools/hermes_repo_local/patches/hermes-cron-env.patch
```

## 怎么回滚

```bash
git -C ../hermes-agent apply -R ../codeksei/tools/hermes_repo_local/patches/hermes-cron-env.patch
```

## 补丁覆盖范围

当前 patch 只覆盖运行时面，不镜像测试文件：

- `cron/jobs.py`
- `cron/scheduler.py`
- `gateway/platforms/api_server.py`
- `hermes_cli/web_server.py`
- `tools/cronjob_tools.py`

## 验收口径

打补丁后，至少应满足：

1. 创建 cron job 时能存下 `env`
2. scheduler 运行 job 时，进程内能看到这些 `env`
3. job 结束后，临时覆盖的环境变量会恢复
4. API / tool / web server 都不会把 `env` 字段吞掉

如果只验证 `jobs.json` 里多了 `env`，但 scheduler 不注入，这不算修完。
