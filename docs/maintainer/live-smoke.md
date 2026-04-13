# Maintainer Live Smoke

这里是 maintainer assisted live smoke 的稳定结果入口。

它只记录真实 WeChat / shared-session 环境下的 recorded run。
`check` / `verify` 的仓内自动化证明仍留在代码与测试层，不在这里冒充 live 环境结论。

## 当前状态

尚无 recorded live smoke 证据。
这表示仓内自动化和真实环境证明还没有在同一入口上持续收口；当前不能据此宣称真实 WeChat / shared-session 现场稳定。

补证方式：

- `npm run smoke:shared:real:attach -- --record`
- `npm run smoke:shared:real:reply -- --mode stream|settled|both --record`
- `npm run smoke:shared:real:approval -- --record`

历史归档目录见：[archive README](./live-smoke/archive/README.md)
