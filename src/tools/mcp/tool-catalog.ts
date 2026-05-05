type CodekseiMcpToolset = "read" | "companion" | "delivery";
type CodekseiMcpToolMutability = "read" | "write";
type JsonSchemaProperty = Record<string, unknown>;
type JsonObjectSchema = {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: false;
};

export interface CodekseiMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObjectSchema;
  minimumToolset: CodekseiMcpToolset;
  mutability: CodekseiMcpToolMutability;
  commandTokens: readonly string[];
}

interface ListCodekseiMcpToolsOptions {
  toolset?: unknown;
}

const TOOLSET_RANK: Readonly<Record<CodekseiMcpToolset, number>> = Object.freeze({
  read: 0,
  companion: 1,
  delivery: 2,
});

const USER_WORKSPACE_PROPERTIES = {
  user: stringProperty("可选；显式 sender id。无法从 sessions.json 唯一解析目标时必须提供。"),
  workspace: stringProperty("可选；显式 workspace 路径。默认使用 MCP bootstrap 绑定的 workspace root。"),
} satisfies Record<string, JsonSchemaProperty>;

const DRY_RUN_PROPERTIES = {
  dryRun: booleanProperty("只预览目标与副作用，不执行真实写入/发送。"),
  idempotencyKey: stringProperty("为可重试写入提供稳定幂等键。"),
} satisfies Record<string, JsonSchemaProperty>;

const CODEKSEI_MCP_TOOL_DEFINITIONS = [
  defineTool({
    name: "codeksei_capabilities_status",
    description: "解释当前 Codeksei 能力配置、宿主可用性和不可用原因。",
    minimumToolset: "read",
    mutability: "read",
    commandTokens: ["capabilities", "status"],
    inputSchema: objectSchema({
      provider: stringProperty("可选；显式 provider 视角，如 codex、claudecode 或 hermes。"),
      ...USER_WORKSPACE_PROPERTIES,
    }),
  }),
  defineTool({
    name: "codeksei_context_briefing",
    description: "生成 prompt-ready 的 Codeksei context board handoff。",
    minimumToolset: "read",
    mutability: "read",
    commandTokens: ["context", "briefing"],
    inputSchema: objectSchema({
      ...USER_WORKSPACE_PROPERTIES,
      mode: enumProperty(["proactive", "review"], "context board 视角。"),
    }),
  }),
  defineTool({
    name: "codeksei_context_inspect",
    description: "解释本轮 context board 装配来源、排除项和 context packs。",
    minimumToolset: "read",
    mutability: "read",
    commandTokens: ["context", "inspect"],
    inputSchema: objectSchema({
      ...USER_WORKSPACE_PROPERTIES,
      mode: enumProperty(["proactive", "review"], "context board 视角。"),
      text: stringProperty("可选；用于 context packs 触发评估的本轮文本。"),
    }),
  }),
  defineTool({
    name: "codeksei_project_radar",
    description: "读取已跟踪代码项目的稳定入口与轻量 git 近况。",
    minimumToolset: "read",
    mutability: "read",
    commandTokens: ["project", "radar"],
    inputSchema: objectSchema({
      list: booleanProperty("仅列出 tracked projects。"),
      json: booleanProperty("要求底层 CLI 输出 JSON 文本。"),
      project: stringProperty("目标 project slug。"),
      commits: stringProperty("最近 commit 数量。"),
      changes: stringProperty("展示的状态变更数量。"),
    }),
  }),
  defineTool({
    name: "codeksei_timeline_categories",
    description: "查看 Codeksei timeline 可用 category、subcategory 和 event node。",
    minimumToolset: "read",
    mutability: "read",
    commandTokens: ["timeline", "categories"],
    inputSchema: objectSchema({}),
  }),
  defineTool({
    name: "codeksei_timeline_read",
    description: "读取某一天的 Codeksei timeline 草稿或已发布内容。",
    minimumToolset: "read",
    mutability: "read",
    commandTokens: ["timeline", "read"],
    inputSchema: objectSchema({
      date: stringProperty("目标日期，格式 YYYY-MM-DD。"),
    }, ["date"]),
  }),
  defineTool({
    name: "codeksei_timeline_proposals",
    description: "查看 timeline 写入过程中累计出来的 event node proposals。",
    minimumToolset: "read",
    mutability: "read",
    commandTokens: ["timeline", "proposals"],
    inputSchema: objectSchema({
      date: stringProperty("可选；只看某一天的 proposals，格式 YYYY-MM-DD。"),
    }),
  }),
  defineTool({
    name: "codeksei_diary_write",
    description: "追加一条 Codeksei diary 记录。需要 companion 或更高 toolset。",
    minimumToolset: "companion",
    mutability: "write",
    commandTokens: ["diary", "write"],
    inputSchema: objectSchema({
      text: stringProperty("要写入的正文内容。"),
      title: stringProperty("补充记录标题。"),
      date: stringProperty("目标日记日期，格式 YYYY-MM-DD。"),
      time: stringProperty("显式覆盖条目时间，如 HH:mm。"),
      section: enumProperty(["todo", "timeline", "fragment", "supplement", "summary"], "写入 section。"),
      state: enumProperty(["open", "done"], "todo 条目状态。"),
      timelineText: stringProperty("todo done 时同步写入时间线事实。"),
      ...DRY_RUN_PROPERTIES,
    }, ["text"]),
  }),
  defineTool({
    name: "codeksei_note_auto",
    description: "按 workspace durable note schema 自动选择 note 与 section 并落盘。需要 companion 或更高 toolset。",
    minimumToolset: "companion",
    mutability: "write",
    commandTokens: ["note", "auto"],
    inputSchema: objectSchema({
      text: stringProperty("要写入的内容。"),
      project: stringProperty("tracked project slug。"),
      scope: stringProperty("durable note scope。"),
      kind: stringProperty("schema 中声明的 kind。"),
      json: booleanProperty("要求底层 CLI 输出 JSON 文本。"),
      ...DRY_RUN_PROPERTIES,
    }, ["text"]),
  }),
  defineTool({
    name: "codeksei_reminder_write",
    description: "创建提醒并交给 Codeksei 调度层处理。需要 companion 或更高 toolset。",
    minimumToolset: "companion",
    mutability: "write",
    commandTokens: ["reminder", "write"],
    inputSchema: objectSchema({
      text: stringProperty("提醒正文。"),
      delay: stringProperty("相对延迟，如 30m、2h、1d。"),
      at: stringProperty("绝对时间，按当前 timezone 解释本地时间。"),
      user: stringProperty("显式 sender id。"),
      ...DRY_RUN_PROPERTIES,
    }, ["text"]),
  }),
  defineTool({
    name: "codeksei_timeline_event",
    description: "按单个时间块写入 Codeksei timeline，不必手写 JSON。需要 companion 或更高 toolset。",
    minimumToolset: "companion",
    mutability: "write",
    commandTokens: ["timeline", "event"],
    inputSchema: objectSchema({
      date: stringProperty("目标日期，格式 YYYY-MM-DD。"),
      start: stringProperty("开始时间 HH:mm 或完整时间戳。"),
      end: stringProperty("结束时间 HH:mm 或完整时间戳。"),
      title: stringProperty("事件标题。"),
      note: stringProperty("附加说明。"),
      categoryId: stringProperty("category id。"),
      subcategoryId: stringProperty("subcategory id。"),
      eventNodeId: stringProperty("event node id。"),
      mode: enumProperty(["merge", "replace"], "写入模式。"),
      eventId: stringProperty("显式 event id。"),
      tags: arrayProperty("标签列表。"),
      finalize: booleanProperty("写入后把目标日期标记为 final。"),
      ...DRY_RUN_PROPERTIES,
    }, ["date", "start", "end", "title"]),
  }),
  defineTool({
    name: "codeksei_timeline_write",
    description: "按批量或原始 JSON 写入 Codeksei timeline 事件。需要 companion 或更高 toolset。",
    minimumToolset: "companion",
    mutability: "write",
    commandTokens: ["timeline", "write"],
    inputSchema: objectSchema({
      json: stringProperty("完整 JSON 对象载荷；优先使用。"),
      date: stringProperty("目标日期，也可在 JSON 里提供。"),
      mode: enumProperty(["merge", "replace"], "写入模式。"),
      finalize: booleanProperty("写入后把目标日期标记为 final。"),
      events: arrayProperty("事件数组；未传 json 时会包装为 { events }。"),
      ...DRY_RUN_PROPERTIES,
    }),
  }),
  defineTool({
    name: "codeksei_timeline_screenshot",
    description: "截图 Codeksei timeline 页面并保存到本地文件。需要 delivery toolset。",
    minimumToolset: "delivery",
    mutability: "write",
    commandTokens: ["timeline", "screenshot"],
    inputSchema: objectSchema({
      outputFile: stringProperty("截图输出绝对路径。"),
      ...DRY_RUN_PROPERTIES,
    }),
  }),
  defineTool({
    name: "codeksei_channel_send_file",
    description: "将本地文件作为附件发送回当前聊天。需要 delivery toolset。",
    minimumToolset: "delivery",
    mutability: "write",
    commandTokens: ["channel", "send-file"],
    inputSchema: objectSchema({
      path: stringProperty("要发回当前微信聊天的本地文件。"),
      user: stringProperty("可选；覆盖默认接收用户。"),
      ...DRY_RUN_PROPERTIES,
    }, ["path"]),
  }),
] as const satisfies readonly CodekseiMcpToolDefinition[];

function listCodekseiMcpTools({ toolset = "read" }: ListCodekseiMcpToolsOptions = {}): CodekseiMcpToolDefinition[] {
  const normalizedToolset = normalizeCodekseiMcpToolset(toolset);
  return CODEKSEI_MCP_TOOL_DEFINITIONS
    .filter((tool) => toolsetAllows(normalizedToolset, tool.minimumToolset))
    .map(cloneToolDefinition);
}

function resolveCodekseiMcpTool(
  name: unknown,
  { toolset = "read" }: ListCodekseiMcpToolsOptions = {},
): CodekseiMcpToolDefinition | null {
  const normalizedName = normalizeToolName(name);
  if (!normalizedName) {
    return null;
  }
  const tool = CODEKSEI_MCP_TOOL_DEFINITIONS.find((entry) => entry.name === normalizedName);
  if (!tool || !toolsetAllows(normalizeCodekseiMcpToolset(toolset), tool.minimumToolset)) {
    return null;
  }
  return cloneToolDefinition(tool);
}

function normalizeCodekseiMcpToolset(value: unknown): CodekseiMcpToolset {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "companion" || normalized === "delivery" ? normalized : "read";
}

function listCodekseiMcpToolsets(): CodekseiMcpToolset[] {
  return ["read", "companion", "delivery"];
}

function toolsetAllows(active: CodekseiMcpToolset, minimum: CodekseiMcpToolset): boolean {
  return TOOLSET_RANK[active] >= TOOLSET_RANK[minimum];
}

function cloneToolDefinition(tool: CodekseiMcpToolDefinition): CodekseiMcpToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: cloneInputSchema(tool.inputSchema),
    minimumToolset: tool.minimumToolset,
    mutability: tool.mutability,
    commandTokens: [...tool.commandTokens],
  };
}

function cloneInputSchema(schema: JsonObjectSchema): JsonObjectSchema {
  const cloned: JsonObjectSchema = {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, { ...value }]),
    ),
    additionalProperties: false,
  };
  if (Array.isArray(schema.required)) {
    cloned.required = [...schema.required];
  }
  return cloned;
}

function defineTool(tool: CodekseiMcpToolDefinition): CodekseiMcpToolDefinition {
  return tool;
}

function objectSchema(properties: Record<string, JsonSchemaProperty>, required: string[] = []): JsonObjectSchema {
  const schema: JsonObjectSchema = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length) {
    schema.required = required;
  }
  return schema;
}

function stringProperty(description: string): JsonSchemaProperty {
  return { type: "string", description };
}

function booleanProperty(description: string): JsonSchemaProperty {
  return { type: "boolean", description };
}

function arrayProperty(description: string): JsonSchemaProperty {
  return {
    type: "array",
    description,
    items: { type: "string" },
  };
}

function enumProperty(values: readonly string[], description: string): JsonSchemaProperty {
  return {
    type: "string",
    enum: [...values],
    description,
  };
}

function normalizeToolName(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export {
  listCodekseiMcpTools,
  listCodekseiMcpToolsets,
  normalizeCodekseiMcpToolset,
  resolveCodekseiMcpTool,
};
export type { CodekseiMcpToolset, CodekseiMcpToolMutability, JsonObjectSchema };
