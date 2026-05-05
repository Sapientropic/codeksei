import { spawnSync } from "node:child_process";
import type { CommandExecutionResult } from "../../contracts/cli-contract";
import { getCommandArgsSchema } from "../../contracts/command-args";
import { resolveRuntimeEntrypointAbsolute } from "../../contracts/runtime-entrypoints";
import { parseCliArgs } from "../../core/cli-args";
import { resolvePackageRoot } from "../../core/path-utils";
import { listCodekseiMcpToolsets, normalizeCodekseiMcpToolset } from "./tool-catalog";
import type { CodekseiMcpToolset } from "./tool-catalog";

type CodekseiMcpBootstrapScope = "local" | "user" | "project";

export interface CodekseiMcpBootstrapOptions {
  allowProjectConfig?: boolean;
  claudeCommand?: string;
  install?: boolean;
  nodeCommand?: string;
  packageRoot?: string;
  scope?: unknown;
  toolset?: unknown;
  workspaceRoot?: string;
}

export interface CodekseiMcpBootstrapPlan {
  commandArgv: string[];
  install: boolean;
  mcpServerConfig: {
    mcpServers: {
      codeksei_tools: {
        command: string;
        args: string[];
      };
    };
  };
  scope: CodekseiMcpBootstrapScope;
  serverArgv: string[];
  text: string;
  toolset: CodekseiMcpToolset;
  writesProjectConfig: boolean;
}

interface CodekseiMcpBootstrapCliOptions {
  allowProjectConfig: boolean;
  claudeCommand: string;
  help: boolean;
  install: boolean;
  nodeCommand: string;
  scope: string;
  toolset: string;
  workspaceRoot: string;
}

function buildCodekseiMcpBootstrapPlan(options: CodekseiMcpBootstrapOptions = {}): CodekseiMcpBootstrapPlan {
  const scope = normalizeBootstrapScope(options.scope);
  const install = Boolean(options.install);
  if (scope === "project" && install && !options.allowProjectConfig) {
    throw new Error("--scope project --install 会写入 workspace .mcp.json；必须额外传 --allow-project-config。");
  }

  const packageRoot = normalizeString(options.packageRoot) || resolvePackageRoot(__dirname);
  const workspaceRoot = normalizeString(options.workspaceRoot) || process.cwd();
  const toolset = normalizeCodekseiMcpToolset(options.toolset);
  const nodeCommand = normalizeString(options.nodeCommand) || process.execPath;
  const claudeCommand = normalizeString(options.claudeCommand) || "claude";
  const cliEntrypoint = resolveRuntimeEntrypointAbsolute(packageRoot, "cli");
  const serverArgv = [
    cliEntrypoint,
    "tool",
    "mcp-server",
    "--runtime-id",
    "claudecode",
    "--workspace-root",
    workspaceRoot,
    "--toolset",
    toolset,
  ];
  const commandArgv = [
    claudeCommand,
    "mcp",
    "add",
    "--scope",
    scope,
    "codeksei_tools",
    "--",
    nodeCommand,
    ...serverArgv,
  ];
  const mcpServerConfig = {
    mcpServers: {
      codeksei_tools: {
        command: nodeCommand,
        args: serverArgv,
      },
    },
  };
  const writesProjectConfig = scope === "project" && install;
  return {
    commandArgv,
    install,
    mcpServerConfig,
    scope,
    serverArgv,
    text: renderBootstrapText({
      commandArgv,
      install,
      mcpServerConfig,
      scope,
      toolset,
      workspaceRoot,
      writesProjectConfig,
    }),
    toolset,
    writesProjectConfig,
  };
}

function runCodekseiMcpBootstrapCommand(args: readonly string[] = []): CommandExecutionResult<CodekseiMcpBootstrapPlan> {
  const options = parseCliArgs<CodekseiMcpBootstrapCliOptions>(args, getCommandArgsSchema("toolMcpBootstrap"));
  if (options.help) {
    return {
      data: buildCodekseiMcpBootstrapPlan(),
      text: [
        "用法: codeksei tool mcp-bootstrap [--scope local|user|project] [--toolset read|companion|delivery] [--install]",
        "默认只打印 claude mcp add 命令和 JSON 配置，不修改 Claude 或 workspace 配置。",
      ].join("\n"),
    };
  }
  const plan = buildCodekseiMcpBootstrapPlan({
    allowProjectConfig: options.allowProjectConfig,
    claudeCommand: options.claudeCommand,
    install: options.install,
    nodeCommand: options.nodeCommand,
    scope: options.scope,
    toolset: options.toolset,
    workspaceRoot: options.workspaceRoot,
  });
  if (!plan.install) {
    return {
      data: plan,
      text: plan.text,
    };
  }
  const executable = plan.commandArgv[0];
  if (!executable) {
    throw new Error("claude mcp add 命令为空");
  }
  const result = spawnSync(executable, plan.commandArgv.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error([
      "claude mcp add 执行失败。",
      normalizeString(result.stderr),
      normalizeString(result.stdout),
    ].filter(Boolean).join("\n"));
  }
  return {
    data: plan,
    text: [
      "Codeksei Tools MCP installed.",
      plan.text,
      normalizeString(result.stdout),
    ].filter(Boolean).join("\n\n"),
  };
}

function renderBootstrapText({
  commandArgv,
  install,
  mcpServerConfig,
  scope,
  toolset,
  workspaceRoot,
  writesProjectConfig,
}: {
  commandArgv: string[];
  install: boolean;
  mcpServerConfig: CodekseiMcpBootstrapPlan["mcpServerConfig"];
  scope: CodekseiMcpBootstrapScope;
  toolset: CodekseiMcpToolset;
  workspaceRoot: string;
  writesProjectConfig: boolean;
}): string {
  const lines = [
    "Codeksei Tools MCP bootstrap",
    "",
    `scope: ${scope}`,
    `toolset: ${toolset}`,
    `workspace: ${workspaceRoot}`,
    install ? "mode: install" : "mode: preview only",
    writesProjectConfig
      ? "注意：project scope install 会写 workspace .mcp.json。"
      : "默认不会写 workspace .mcp.json；local scope 由 Claude Code 写入 ~/.claude.json。",
    "",
    "Claude CLI command:",
    `  ${quoteCommand(commandArgv)}`,
    "",
    "Equivalent JSON config:",
    JSON.stringify(mcpServerConfig, null, 2),
    "",
    `Available toolsets: ${listCodekseiMcpToolsets().join(", ")}`,
  ];
  return lines.join("\n");
}

function normalizeBootstrapScope(value: unknown): CodekseiMcpBootstrapScope {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "user" || normalized === "project") {
    return normalized;
  }
  return "local";
}

function quoteCommand(argv: readonly string[]): string {
  return argv.map(quoteArg).join(" ");
}

function quoteArg(value: string): string {
  if (!/[ \t"'`]/u.test(value)) {
    return value;
  }
  return process.platform === "win32"
    ? `"${value.replace(/"/gu, '\\"')}"`
    : `'${value.replace(/'/gu, "'\\''")}'`;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  buildCodekseiMcpBootstrapPlan,
  normalizeBootstrapScope,
  quoteCommand,
  runCodekseiMcpBootstrapCommand,
};
