# Changelog

本文件按 Keep a Changelog 风格维护，但更偏向 Codeksei 的安装、attach 和升级真实路径。

- 面向安装者、宿主维护者，以及需要快速判断“最近到底更新到哪了”的人。
- 重点是发布节奏、升级影响和需要执行的动作，不直接镜像 `git log`。
- `0.4.0` / `0.4.1` 当前以 release commit 为锚点；repo 里的 Git tag 目前停在 `v0.3.0`。
- 从 `0.3.0` 开始补详版 changelog；更早历史先以 Git tag 和 commit 为准。

## [Unreleased]

当前 `package.json` 仍是 `0.4.1`。下面这些变更都发生在 `0.4.1` 之后、下一次正式发版之前。

### Added

- 语义化 onboarding persona 提取主链，支持“小模型优先、规则兜底”的六域 backstage 抽取，并继续把长期真相只写回 companion note，而不是新建第二套 profile store。`adb6b90`
- `codeksei onboarding start|step|status|reset` 公共 CLI 面，以及无 workspace schema / 无 Obsidian 时自动回退到 `CODEKSEI_STATE_DIR/companions/<userKey>/profile.md` 的 companion profile。`adb6b90`
- 统一的 semantic JSON runtime 抽取基础件，供 onboarding 和 review semantic host 复用，减少重复的 Codex/Hermes JSON 提取逻辑。`adb6b90`
- 通用的 `codeksei companion remember` 公共 CLI 和 `src/companion-memory/*` shared owner：所有宿主都可以把会影响未来陪伴判断的新事实或纠正送进同一条 ongoing companion memory 主链，而不是只把记忆更新绑在 onboarding 会话里。
- `CODEKSEI_STATE_DIR/companion-memory/<userKey>.json` 运行态记忆状态：只存 dedupe、freshness、recent writes 和 pending pattern candidates，不引入第二套长期 profile store。
- host 升级感知合同：`host manifest` 现在带 machine-readable 的推荐工作流与升级要求；`host bootstrap` 会写入 bootstrap 快照；`host doctor` 会显式判断是否需要重新 bootstrap 或重装 companion skill。`c650278`

### Changed

- 主上下文策略切到 `context board first / raw vault injection second`。宿主默认应先读受控的 context board handoff，而不是把原始 vault/note 直接塞进 prompt。`9b8012f`
- Hermes companion skill 与 host manifest 不再只是命令清单，而是带默认 routing/workflow 提示，明确何时先看 onboarding、何时先看 context briefing、以及 hosted proactive 必须走 `seed-proactive / claim-checkin / settle-checkin`。`678b3eb`
- onboarding 的 durable memory 写入逻辑已退回 shared companion-memory 内核；`onboarding step` 继续负责首访状态机和自然追问，但长期真相更新、去重、纠错和 runtime freshness 现在与后续 ongoing memory 共用同一条 host-neutral 管线。
- `host manifest` / Hermes companion skill 的默认工作流新增 `ongoing_companion_memory`，并把 `user_correction_persistence` 明确成“onboarding 未完成走 onboarding step，ready 后统一走 companion remember”，不再暗示不同宿主要维护各自专用的长期记忆语义。
- `context briefing` 现在会暴露 companion memory freshness / source status，帮助宿主判断当前 handoff 只是在消费旧 onboarding 画像，还是已经接上了持续更新的 companion memory。
- Hosted proactive wake、reminder delivery 和 Hermes wake-forwarder 进一步收口，修正了一次性 wake job、delivery origin 和 recovery ownership 的行为。`f5aaeec`
- Weixin 默认值与腾讯官方插件对齐，包括协议 client version、登录相关默认行为，以及 repo-local bridge 对应的兼容更新。`35c784a`
- Weixin 路由和 Hermes hosted checkin 路径先做了一轮收口式简化，并补上 Hermes cron `env` passthrough patch 文档与资产。`f67f383`

### Upgrade Notes

- 这条发布线的核心变化不是“多了几个命令”，而是宿主默认接法已经从“拿命令列表自己拼”升级为“由 `host manifest`、skill 和 `host doctor` 共同驱动默认工作流”。
- onboarding 现在是正式的一等入口，新用户或薄画像用户不应再假设已有 durable profile；长期真相也不应旁路写入，而应继续回到 companion note。
- onboarding 之上的记忆更新能力已经进一步泛化成 host-neutral 的 ongoing companion memory。对已完成 onboarding 的用户，后续纠正、支持偏好变化、节奏变化和近线任务更新，默认应走 `codeksei companion remember`，不要继续把 `onboarding step` 当作长期记忆的总入口。
- 主动判断上下文现在应优先依赖 `context briefing` / context board，而不是直接注入 raw vault。
- 没有数据库迁移，也没有新的公开 profile store；升级影响主要集中在 host routing、bootstrap 快照和 skill 安装物。

### Host / Installer Checklist

- [ ] 先跑一次 `codeksei host doctor --provider hermes`，确认当前安装是否需要重新 bootstrap 或重装 skill。
- [ ] 如果 `host doctor` 返回 `bootstrap_required: yes`，执行 `codeksei host bootstrap --provider hermes --ensure-daemon`。
- [ ] 如果 `host doctor` 返回 `skill_reinstall_required: yes`，执行 `codeksei operator hermes install-skill`。
- [ ] 如果宿主之前只缓存了命令清单，改为读取 `codeksei host manifest --format json`，并消费其中的 `recommendedWorkflows` 与 `entrypoints`。
- [ ] 把“新用户 / 薄画像”默认链路改成 `onboarding status -> onboarding start|step`，不要再假设已有 companion profile。
- [ ] 把“onboarding 已完成后的持续记忆更新”默认链路改成 `codeksei companion remember --user <id> --workspace <path> --source host_user_turn --stdin`，不要再复用 `onboarding step` 承担全部长期纠正。
- [ ] 把“主动判断 / 当前状态 handoff”默认链路改成 `codeksei context briefing --user <id> --workspace <path> --mode proactive`，不要再直接注入原始 vault。

### Commit Trace

- `c650278` Add host upgrade awareness contract
- `678b3eb` Teach hosts the default companion workflow
- `adb6b90` Add semantic onboarding persona extraction
- `9b8012f` Switch to "whiteboard/context board first, raw vault injection second"
- `35c784a` Align Weixin defaults with Tencent plugin
- `f5aaeec` Fix hosted proactive wake jobs and reminder delivery
- `f67f383` Simplify Weixin routing and harden Hermes hosted checkins

## [0.4.1] - 2026-04-15

### Fixed

- 统一 host template 在 Windows 上的换行行为，避免 bootstrap 产物、模板和安装物因为 CRLF 漂移而出现不必要的差异和异常。`7e638de`

### Upgrade Notes

- 这是一个小版本修正发布，核心是 Windows host template / 资产换行一致性，不引入新的命令面或数据迁移。
- 如果你只在 macOS / Linux 使用，通常可以直接替换；如果你在 Windows 上已经生成过 host 模板或安装物，建议做一次轻量复核。

### Host / Installer Checklist

- [ ] Windows 宿主如果已经在 `0.4.0` 上生成过模板、skill 或 attach 资产，建议重新跑一次 `codeksei host bootstrap --provider hermes --ensure-daemon`。
- [ ] 跑一次 `codeksei host doctor --provider hermes`，确认 bootstrap 快照与当前 repo 合同一致。
- [ ] 如果之前看到的是纯换行噪音或模板 diff 异常，升级后优先确认这些症状是否已经消失，再继续追更深层问题。

### Commit Trace

- `7e638de` fix: normalize host template line endings on Windows
- `2b712b5` chore: release v0.4.1

## [0.4.0] - 2026-04-15

### Added

- host attachment contract v1，公开了 `host manifest / bootstrap / doctor / smoke` 这一组机器入口。`20cdb37`
- host-neutral core、Hermes hosted mode、repo-local hosted workflows、host-neutral checkins 和 radar fallback。`643529e` `27a83d6` `82b27ff` `05ccfda`
- Hermes hosted operator 与 review parity，为 hosted 模式补齐更完整的 companion workflow surface。`0f15252` `93e342d` `7e34e0b`

### Changed

- command surface 的真相层重新收口，README 中英文入口与 host contract 对齐。`46db928` `5e88c24`
- 架构与质量门做了一轮较大收口，包括 docs truth contract、release hardening、architecture/quality upgrade plan 和相关验证覆盖。`376f8b1` `05bda0c` `cae05b5` `ead0e30` `725bc0d` `a0d376c`

### Fixed

- host bootstrap 的 workspace config targeting。`e236214`
- cross-platform runtime turn file 测试和 Windows workspace bind canonicalization。`3fc54df` `94382f1`
- Hermes repo-local bridge 的 env loading，以及 hosted one-shot checkin scheduling 路径。`cb8018e` `de406f8`

### Upgrade Notes

- 这是 Codeksei 从“仓库脚本 + 兼容 operator”向“公开 host attachment contract”切换的关键版本。默认推荐链路从这里开始稳定成 `host manifest -> host bootstrap -> host doctor -> host smoke`。
- `operator hermes *` 从这一版开始更适合作为兼容入口，而不是新宿主的主入口。
- 没有强制数据迁移，但已有宿主如果是按旧 README prose、repo-local helper 或手写 glue code 接入，建议把接入逻辑切到 `host manifest` 和公共 CLI 合同上。

### Host / Installer Checklist

- [ ] 把默认接法切到 `codeksei host manifest`，不要再从 README prose 或仓库内部脚本反推接入流程。
- [ ] 至少顺序跑一遍 `codeksei host bootstrap --provider hermes --ensure-daemon`、`codeksei host doctor --provider hermes`、`codeksei host smoke --provider hermes`。
- [ ] 如果宿主自己维护 workspace/bootstrap 路径拼接，确认已经跟 `host bootstrap` 的 targeting 行为对齐。
- [ ] 如果你依赖 repo-local Hermes bridge 或 hosted one-shot checkin，升级后重新 smoke 这些路径，不要假设旧 env loading 或调度脚本仍然完全兼容。

### Commit Trace

- `5e88c24` docs: align bilingual README with host contract
- `e236214` Fix host bootstrap workspace config targeting
- `20cdb37` Add host attachment contract v1
- `3fc54df` Fix cross-platform runtime turn file test
- `cae05b5` Implement architecture and quality upgrade plan
- `725bc0d` Skip local-only release docs in docs truth contract
- `a0d376c` Link Weixin media gap diagnostic to public issue
- `ead0e30` Add docs truth and path resolver test coverage
- `376f8b1` Implement P0-P5 architecture and quality upgrade
- `de406f8` Implement Hermes hosted one-shot checkin scheduling (#3)
- `94382f1` Fix Windows workspace bind canonicalization test
- `05bda0c` Implement P0-P3 architecture and release hardening
- `cb8018e` Harden Hermes repo-local bridge env loading (#2)
- `9fe7d9d` chore: release v0.4.0

## [0.3.0] - 2026-04-14

### Added

- host-neutral core、Hermes hosted mode 和 hosted operator baseline，给后续的 host attachment contract 打下基础。`643529e` `0f15252` `93e342d`
- radar fallback、host-neutral checkins、repo-local hosted workflows，以及 command surface truth layers 的第一轮收口。`82b27ff` `05ccfda` `46db928`

### Changed

- 这是当前公开 host-facing 方向的第一个 npm 发布锚点，后续 `0.4.x` 的 contract、bootstrap 和 upgrade 逻辑都建立在这条线之上。`29080b7`

### Upgrade Notes

- 如果你是从 `0.2.x` 或更早版本过来，不建议假设旧的 helper、旧 runtime seam 或旧 README 路径还能无缝对上这一代 hosted/host-neutral contract。
- 从 changelog 维护角度，这一版是当前详版历史的起点；更早版本先以 Git tag / commit 追溯。

### Host / Installer Checklist

- [ ] 新安装优先从 `codeksei help`、`codeksei schema`、`codeksei host manifest` 开始确认公共命令面。
- [ ] 如果是从更早版本迁移过来，至少重新验证一遍 host attach、checkin 和 repo-local workflow，不要把旧 helper 当成当前公开合同。
- [ ] 如果你维护的是文档或安装脚本，把这一版视为现代 host-facing 路径的最早可靠基线。

### Commit Trace

- `46db928` Refactor command surface truth layers
- `7e34e0b` Implement P0-P3 host and config seam upgrades
- `05ccfda` Implement Hermes repo-local hosted workflows
- `82b27ff` Add radar fallback and host-neutral checkins
- `27a83d6` Merge host-neutral Hermes hosted mode
- `93e342d` Refine Hermes operator command surface
- `0f15252` Add Hermes hosted operator and review parity
- `643529e` add host-neutral core and Hermes hosted mode
- `29080b7` Bump release version to 0.3.0

[Unreleased]: https://github.com/Sapientropic/codeksei/compare/2b712b5...HEAD
[0.4.1]: https://github.com/Sapientropic/codeksei/compare/9fe7d9d...2b712b5
[0.4.0]: https://github.com/Sapientropic/codeksei/compare/v0.3.0...9fe7d9d
[0.3.0]: https://github.com/Sapientropic/codeksei/releases/tag/v0.3.0
