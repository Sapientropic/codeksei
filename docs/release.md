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

发布工作流会先跑安装、语法检查和测试，再执行 `npm publish --provenance --access public`。

## Required Secret

真正发包前，需要在 GitHub 仓库 `Sapientropic/codeksei` 里配置：

- `NPM_TOKEN`：npm automation token

当前工作流使用 `NPM_TOKEN` 发包，并开启 provenance；还没有切成 npm trusted publishing-only 路线。

## Release Steps

推荐流程：

1. 本地确认改动、测试和 packlist 都通过
2. 更新 `package.json` 版本号
3. push 到 `fork/main`
4. 创建 GitHub Release，tag 形如 `v0.1.0`
5. 等 `publish.yml` 自动发包，或手动 `workflow_dispatch` 且把 `dry_run` 设为 `false`

补充约束：

- GitHub Release 触发时，workflow 会校验 `package.json` 版本和 tag 去掉前缀 `v` 后一致
- `workflow_dispatch` 默认是 dry run，避免误发
- 兼容入口 `cyberboss` 不会再单独发布 npm 包

## Migration Checklist

这轮迁移之后，所有外部入口都应优先引用新 slug：

- clone URL
- README / 文档链接
- `package.json` 的 `repository / homepage / bugs`
- GitHub Actions badge 和 workflow 页面
- 任何外部脚本、CI、自动化里写死的仓库地址

如果旧 slug 还能访问，那是 GitHub redirect 的兼容结果，不应再把它当作正式配置继续写回仓库。
