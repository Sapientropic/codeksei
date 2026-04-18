# Timeline Integration

这份文档是 `Codeksei` timeline 接入的单一权威入口。

它只回答三类问题：

- timeline CLI 在什么环境里可用
- agent / 自动化 / 未来 MCP 应按什么顺序调用
- 截图与本地预览应优先走哪些高层动作

对外命令面仍以 [commands.md](./commands.md) 为入口地图；这里不重复列整页命令清单。

## Support Matrix

- 系统：Windows、macOS、Linux 都可跑 timeline CLI
- Node：要求 `Node.js >= 22`
- `timeline build` / `timeline serve` / `timeline dev`：不要求 Chromium / Chrome / Edge
- `timeline screenshot`：需要本机存在可用的 Chromium / Chrome / Edge，或可被 `playwright-core` 发现的浏览器
- `timeline dev`：优先走 native `fs.watch`；如果命中 watcher 配额，或平台不支持递归 watch，会自动退到 polling，而不是直接失去热更新

## Locale

- `CODEKSEI_TIMELINE_LOCALE=zh-CN|en`
- 当前只作用于 timeline dashboard：文案、日期格式、HTML `lang` 与 demo data 语言
- 英文 demo data 由独立资产 `src/timeline/examples/demo-facts.en.json` 提供，不再依赖运行时临时翻译
- 不会改变 timeline 写入 JSON 的 schema，也不会改动真实用户已经写入的事件内容

## CLI-First Path

默认顺序：

1. 分类不确定时，先 `codeksei timeline categories`
2. 修改已有某一天前，先 `codeksei timeline read --date YYYY-MM-DD`
3. 单条明确时间块优先 `codeksei timeline event`
4. 只有批量写入、整批替换或需要原始 JSON 时，才用 `codeksei timeline write`
5. 写完后按需要选择：
   - 刷新静态产物：`codeksei timeline build`
   - 稳定查看本地页面：`codeksei timeline serve`
   - 一边改一边看：`codeksei timeline dev`
   - 导出本地图片：`codeksei timeline screenshot`
   - 需要回传当前聊天时，再单独运行：`codeksei channel send-file --path /absolute/path/to/screenshot.png`

约束：

- `timeline write --stdin` 要传完整 JSON 对象 `{"events":[...]}`
- 修改已有日期时，不要跳过 `read` 直接盲写
- 写入事件必须落在目标日期当天内；跨天事件需要拆开

## Screenshot Contract

截图优先走结构化参数，不要让 agent 自己编 Playwright 点击流。

优先级：

1. 先用 `range/date/week/month/category/detail`
2. 再用受控 `selector`
3. 只有受控区域不够时，才传自定义 CSS selector

当前受控 selector：

- `main`：整页主视图
- `timeline`：时间轴区域
- `analytics`：类别分布、明细和趋势区
- `events`：事件明细区

自然语言到参数的默认映射：

- “截主视图” / “截整页” -> `--selector main`
- “截时间轴” -> `--selector timeline`
- “截分析区” / “截类别明细趋势” -> `--selector analytics`
- “截事件列表” -> `--selector events`

决策规则：

- 只要用户想看某个分类 / 明细的时间分布，优先 `analytics`
- 只有明确要看事件卡片或事件列表时，才用 `events`
- `timeline screenshot` 只生成本地文件；发送回聊天属于后置 delivery，不是 timeline 本体语义

## Agent And MCP Boundary

agent 默认先走 CLI / application 层，不先读实现细节。

适用原则：

- 能通过现有 timeline 命令完成的事，先直接调用命令
- 只有命令报错且信息不足、用户明确要改实现、或要扩展新能力时，才读源码
- 读取源码时，只看当前失败点直接相关的最小文件集合

未来 MCP 若要补 timeline tools，直接复用 `src/timeline/runtime/application/timeline/*` 这一层，不复制 CLI 逻辑，不重写第二套业务语义。
