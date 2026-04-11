# Release Guide

这页是维护者收口用的。

目标很简单：稳稳发布，不把临时状态、个人配置或仓促判断带进公共版本里。

`Codeksei` 的仓库发布与 npm 发包约定统一收口在这里。README 只保留入口说明，本页只保留维护者真正需要的流程与边界。

## Canonical Names

对外名字要稳定，对内兼容可以继续保留。

- GitHub 仓库：`https://github.com/Sapientropic/codeksei`
- npm 包名：`codeksei`
- 旧仓库 slug `Sapientropic/cyberboss` 只应视为 GitHub redirect，不再作为正式地址继续写回文档、badge、workflow 或包元数据

## Workflows

发布链路尽量少分叉，这样更不容易在真正发包时出意外。

当前仓库内置三条 GitHub Actions workflow：

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`
- `.github/workflows/secret-scan.yml`

`ci.yml` 在 `push` 和 `pull_request` 时执行：

- `npm ci`
- `npm run check`
- `node --test tests/*.test.js`
- `npm pack --dry-run`

`publish.yml` 支持两种入口：

- `workflow_dispatch`
- GitHub Release `published`

约定如下：

- `workflow_dispatch` 只做 dry-run 预检，不会真的发包
- GitHub Release `published` 才会真正执行 publish
- 发布工作流会先跑安装、语法检查和测试，再进入发包阶段
- workflow 当前直接使用 GitHub Actions 上的 Node 24 运行

`secret-scan.yml` 在 `push`、`pull_request` 和手动触发时执行：

- 使用 `actions/checkout@v6` 且 `fetch-depth: 0`
- 用 Gitleaks 扫描当前仓库与 git 历史里的硬编码 secret
- 默认关闭 PR 自动评论，只保留 workflow summary 与失败信号
- 当前仓库 owner 是 GitHub 用户账号，不需要额外配置 `GITLEAKS_LICENSE`；如果未来迁到 organization，再按 Gitleaks 官方要求补 license secret

## Trusted Publishing

这里的核心原则是：尽量不依赖长期存在的 publish secret。

当前仓库使用 npm trusted publishing 主链路，不依赖长期存在的 `NPM_TOKEN`。

npm 侧需要的 GitHub Actions trusted publisher 配置：

- Organization or user: `Sapientropic`
- Repository: `codeksei`
- Workflow filename: `publish.yml`
- Environment name: 留空

说明：

- 这里只填 workflow 文件名，不填 `.github/workflows/` 全路径
- 当前仓库是 public repo，满足 npm trusted publishing 的 GitHub Actions 前提
- trusted publishing 下，npm 会自动生成 provenance，不需要额外加 `--provenance`

官方入口见：

- https://docs.npmjs.com/trusted-publishers/

## Release Steps

常规发布时，先确认“真实状态已经收住”，再让 workflow 接手。

常规版本发布流程：

1. 本地确认改动、测试和 packlist 都通过
2. 更新 `package.json` 版本号
3. push 到 `public`
4. 可选：手动触发一次 `publish.yml` 的 `workflow_dispatch` 做 dry-run 预检
5. 创建 GitHub Release，tag 形如 `v0.1.1`
6. 等 `publish.yml` 自动发包

补充约束：

- 本地 `main` 只作为维护者收口分支保留，默认不要推远端
- 对外发布、文档更新、版本推进统一只推 `public`
- GitHub Release 触发时，workflow 会校验 `package.json` 版本和 tag 去掉前缀 `v` 后一致
- `workflow_dispatch` 固定只做 dry-run，避免误发
- 兼容入口 `cyberboss` 不会再单独发布 npm 包
- workflow 已带“版本已存在则跳过真实发包”的保护，避免重复发布同版本时把 CI 打红

## Hardening

当主链稳定之后，再继续收紧权限边界。

在 trusted publishing 验证稳定后，建议继续把 npm 包设置里的 `Publishing access` 设为：

- `Require two-factor authentication and disallow tokens`

这样可以把传统 publish token 彻底降为不可用，只保留 OIDC trusted publishing。

## Migration Checklist

迁移检查的重点是确认旧仓地址和旧入口不会继续写回新的公共出口。

这轮迁移之后，所有外部入口都应优先引用新 slug：

- clone URL
- README / 文档链接
- `package.json` 的 `repository / homepage / bugs`
- GitHub Actions badge 和 workflow 页面
- 任何外部脚本、CI、自动化里写死的仓库地址

如果旧 slug 还能访问，那是 GitHub redirect 的兼容结果，不应再把它当作正式配置继续写回仓库。
