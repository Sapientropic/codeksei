import type { CommandActionDefinition } from "./command-surface-definition-types";

export const TOOLS_COMMAND_ACTION_DEFINITIONS = [
  {
    action: "tool.mcp_bootstrap",
    groupId: "tools",
    summary: "生成或显式安装 Claude Code 使用的 Codeksei Tools MCP 配置",
    terminal: ["tool mcp-bootstrap"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    command: "tool",
    subcommand: "mcp-bootstrap",
    runner: "tool.mcp-bootstrap",
    argsSchemaKey: "toolMcpBootstrap",
    help: { topic: "tool", leafKey: "tool.mcp_bootstrap", detail: "leaf" },
    sideEffects: [
      {
        kind: "claude_mcp_add",
        target: "~/.claude.json or workspace .mcp.json",
        when: "仅当显式传 --install；project scope 还必须传 --allow-project-config",
      },
    ],
  },
  {
    action: "tool.mcp_server",
    groupId: "tools",
    summary: "Codeksei Tools MCP stdio server 入口",
    terminal: ["tool mcp-server"],
    weixin: [],
    status: "active",
    entrypointType: "cli",
    command: "tool",
    subcommand: "mcp-server",
    runner: "tool.mcp-server",
    argsSchemaKey: "toolMcpServer",
    help: { topic: "tool", leafKey: "tool.mcp_server", detail: "leaf" },
  },
] as const satisfies readonly CommandActionDefinition[];
