# Changelog

这份文件是 Codeksei 唯一的人类可读变更日志入口。

- 面向安装者、宿主维护者和需要快速判断“最近到底更新到哪了”的人。
- 按发布/升级视角总结，不直接镜像 `git log`。
- 需要更细的证据时，再回到具体 commit、测试和文档。

## Unreleased

当前 `package.json` 仍是 `0.4.1`。下面这些变更都发生在 `v0.4.1` 之后、下一次正式发版之前。

### Added

- 语义化 onboarding persona 提取主链，支持“小模型优先、规则兜底”的六域 backstage 抽取，并继续把长期真相只写回 companion note，而不是新建第二套 profile store。提交：`adb6b90`
- `codeksei onboarding start|step|status|reset` 公共 CLI 面，以及无 workspace schema / 无 Obsidian 时自动回退到 `CODEKSEI_STATE_DIR/companions/<userKey>/profile.md` 的 companion profile。提交：`adb6b90`
- 统一的 semantic JSON runtime 抽取基础件，供 onboarding 和 review semantic host 复用，减少重复的 Codex/Hermes JSON 提取逻辑。提交：`adb6b90`
- host 升级感知合同：`host manifest` 现在带 machine-readable 的推荐工作流与升级要求；`host bootstrap` 会写入 bootstrap 快照；`host doctor` 会显式判断是否需要重新 bootstrap 或重装 companion skill。提交：`c650278`

### Changed

- 主上下文策略切到 `context board first / raw vault injection second`。宿主默认应先读受控的 context board handoff，而不是把原始 vault/note 直接塞进 prompt。提交：`9b8012f`
- Hermes companion skill 与 host manifest 不再只是命令清单，而是带默认 routing/workflow 提示，明确何时先看 onboarding、何时先看 context briefing、以及 hosted proactive 必须走 `seed-proactive / claim-checkin / settle-checkin`。提交：`678b3eb`
- Hosted proactive wake、reminder delivery 和 Hermes wake-forwarder 进一步收口，修正了一次性 wake job、delivery origin 和 recovery ownership 的行为。提交：`f5aaeec`
- Weixin 默认值与腾讯官方插件对齐，包括协议 client version、登录相关默认行为，以及 repo-local bridge 对应的兼容更新。提交：`35c784a`
- Weixin 路由和 Hermes hosted checkin 路径先做了一轮收口式简化，并补上 Hermes cron `env` passthrough patch 文档与资产。提交：`f67f383`

### Host / Installer Notes

- 如果你的 Hermes/host 集成是在 `c650278` 之前接入的，建议现在至少跑一次：
  `codeksei host doctor --provider hermes`
- 如果 `host doctor` 显示 `bootstrap_required: yes`，重新执行：
  `codeksei host bootstrap --provider hermes --ensure-daemon`
- 如果 `host doctor` 显示 `skill_reinstall_required: yes`，先执行：
  `codeksei operator hermes install-skill`
- 如果你的宿主之前只是“拿到命令列表就自己拼逻辑”，现在应该改成优先读取：
  `codeksei host manifest --format json`
  然后按其中的 `recommendedWorkflows` 和 `entrypoints` 驱动默认链路。
- 对“新用户/薄画像”场景，宿主现在不应假设已有 profile，应该先看：
  `onboarding status -> onboarding start|step`
- 对“当前状态 handoff / 主动判断”场景，宿主现在不应直接注入原始 vault，而应先读：
  `codeksei context briefing --user <id> --workspace <path> --mode proactive`

### Commit Trace

- `c650278` Add host upgrade awareness contract
- `678b3eb` Teach hosts the default companion workflow
- `adb6b90` Add semantic onboarding persona extraction
- `9b8012f` Switch to "whiteboard/context board first, raw vault injection second"
- `35c784a` Align Weixin defaults with Tencent plugin
- `f5aaeec` Fix hosted proactive wake jobs and reminder delivery
- `f67f383` Simplify Weixin routing and harden Hermes hosted checkins

## v0.4.1

- Release commit: `2b712b5`
- 这是当前 `package.json` 对应的最近正式版本锚点。
- 更早历史暂时以 Git tag / commit 为准；从这一版开始，后续变更统一收口到本文件。
