# Release

`Codeksei` 的仓库发布与 npm 发包约定统一收口在这里。README 只保留入口说明，不再重复完整流程。

## Canonical Slug

- GitHub 仓库主地址：`https://github.com/Sapientropic/codeksei`
- npm 包主名：`codeksei`
- 旧 slug `Sapientropic/cyberboss` 只应视为 GitHub redirect，不再作为文档、badge、workflow 或包元数据里的正式地址

如果你本地同时保留上游原仓和个人远端，当前约定可以继续是：

- `origin` = `WenXiaoWendy/cyberboss`
- `fork` = `Sapientropic/codeksei`

## GitHub Actions

当前仓库内置两条工作流：

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

`ci.yml` 会在 `push` 和 `pull_request` 时执行：

- `npm ci`
- `npm run check`
- `node --test tests/*.test.js`
- `npm pack --dry-run`

`publish.yml` 支持两种入口：

- `workflow_dispatch`
- GitHub Release `published`

其中：

- `workflow_dispatch` 只做 dry-run 预检，不会真的发包
- GitHub Release `published` 才会真正执行 `npm publish --access public`

发布工作流会先跑安装、语法检查和测试，再进入 publish 阶段。  
当前 workflow 直接使用 GitHub Actions 上的 Node 24 运行，以满足 npm trusted publishing 对运行时版本的要求。

## Trusted Publishing Setup

当前仓库已经切到 npm trusted publishing 主链路，不再依赖 `NPM_TOKEN` 这类长期写权限 secret。

你需要在 npm 的包设置里做一次性配置：

1. 打开 npm 的 trusted publishing 文档：
   https://docs.npmjs.com/trusted-publishers/
2. 在 npmjs.com 为 `codeksei` 配置 GitHub Actions trusted publisher
3. 按下面这组字段填写：

- Organization or user: `Sapientropic`
- Repository: `codeksei`
- Workflow filename: `publish.yml`
- Environment name: 留空

说明：

- 这里只填 workflow 文件名，不填 `.github/workflows/` 全路径
- 当前仓库是 public repo，满足 npm trusted publishing 的 GitHub Actions 前提
- trusted publishing 下，npm 会自动生成 provenance；不需要再手动加 `--provenance`

## First Release Checklist

首发前建议按这条顺序做：

1. 在 npm 侧完成 trusted publisher 配置
2. 手动触发一次 `publish.yml` 的 `workflow_dispatch`，确认 dry-run 预检通过
3. 本地确认版本号、README 和 packlist 都准备好
4. 创建 GitHub Release，tag 形如 `v0.1.0`
5. 等 `publish.yml` 在 `release.published` 事件上真正发包

[⚠️ 需确认] npm 官网当前文档明确要求在包设置里添加 trusted publisher，但对“尚未首发的新包”在 UI 里的具体入口层级可能会随 npm 页面调整而变化；如果你打开后入口名字略有不同，以 npm 官方文档与实际控制台为准。

## First Release Bootstrap

如果 `codeksei` 还没有在 npm 上存在：

1. 先在维护者本机完成一次手动首发：`npm publish --access public`
2. 等 npm 上出现包页面后，再去 package settings 里配置 trusted publisher
3. 之后再把 GitHub 的 `v0.1.0` draft release 正式发布

当前 `publish.yml` 已经带有“版本已存在则跳过真实发包”的保护，所以首发 bootstrap 之后再发布同版本 GitHub Release，不会因为重复发 `0.1.0` 而把 workflow 打红。

## Release Steps

常规后续版本发布流程：

1. 本地确认改动、测试和 packlist 都通过
2. 更新 `package.json` 版本号
3. push 到 `fork/main`
4. 可选：先手动触发一次 `publish.yml` 的 `workflow_dispatch` 做 dry-run 预检
5. 创建 GitHub Release，tag 形如 `v0.1.0`
6. 等 `publish.yml` 自动发包

补充约束：

- GitHub Release 触发时，workflow 会校验 `package.json` 版本和 tag 去掉前缀 `v` 后一致
- `workflow_dispatch` 现在固定只做 dry-run，避免误发
- 兼容入口 `cyberboss` 不会再单独发布 npm 包

## Post-First-Release Hardening

在 trusted publishing 首次验证成功后，建议继续做这一步：

1. 打开 npm 包设置里的 Publishing access
2. 选择 `Require two-factor authentication and disallow tokens`
3. 保存设置

这样可以把传统 publish token 彻底降为不可用，只保留 OIDC trusted publishing。

## Migration Checklist

这轮迁移之后，所有外部入口都应优先引用新 slug：

- clone URL
- README / 文档链接
- `package.json` 的 `repository / homepage / bugs`
- GitHub Actions badge 和 workflow 页面
- 任何外部脚本、CI、自动化里写死的仓库地址

如果旧 slug 还能访问，那是 GitHub redirect 的兼容结果，不应再把它当作正式配置继续写回仓库。
