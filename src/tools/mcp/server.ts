import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ListResourcesResult,
  type ListResourceTemplatesResult,
  type ListToolsResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { parseCliArgs } from "../../core/cli-args";
import { getCommandArgsSchema } from "../../contracts/command-args";
import { PageArtifactStore } from "../../state/page-artifacts";
import { resolveCodekseiMcpTool, listCodekseiMcpTools, normalizeCodekseiMcpToolset } from "./tool-catalog";
import type { CodekseiMcpToolset } from "./tool-catalog";
import { invokeCodekseiMcpTool } from "./command-runner";
import type { CodekseiMcpToolInvocationOptions } from "./command-runner";

type UnknownRecord = Record<string, unknown>;
type InvokeCodekseiMcpTool = (toolName: string, args: UnknownRecord) => Promise<CallToolResult>;

export interface CodekseiMcpRequestHandlersOptions extends CodekseiMcpToolInvocationOptions {
  invokeTool?: InvokeCodekseiMcpTool;
  maxResultChars?: number;
  pageArtifactStore?: PageArtifactStore;
  pageArtifactsDir?: string;
  runtimeId?: string;
  toolset?: CodekseiMcpToolset;
}

export interface CodekseiMcpRequestHandlers {
  initialize(params?: UnknownRecord): Promise<{
    protocolVersion: string;
    capabilities: { tools: { listChanged: false }; resources: { listChanged: false } };
    serverInfo: { name: string; version: string };
  }>;
  listResources(params?: { cursor?: string; limit?: number }): Promise<ListResourcesResult>;
  listResourceTemplates(params?: { cursor?: string }): Promise<ListResourceTemplatesResult>;
  readResource(uri: string): Promise<ReadResourceResult>;
  listTools(): Promise<ListToolsResult>;
  callTool(name: string, args?: UnknownRecord): Promise<CallToolResult>;
}

interface CodekseiMcpServerCliOptions {
  cliEntrypoint: string;
  help: boolean;
  maxResultChars: string;
  nodeCommand: string;
  runtimeId: string;
  toolset: string;
  workspaceRoot: string;
}

const MCP_SERVER_NAME = "codeksei-tools";
const MCP_SERVER_VERSION = "0.5.0";

function createCodekseiMcpRequestHandlers({
  cliEntrypoint = "",
  invokeTool,
  maxResultChars = 0,
  nodeCommand = "",
  packageRoot = "",
  pageArtifactStore = undefined,
  pageArtifactsDir = "",
  runtimeId = "claudecode",
  toolset = "read",
  workspaceRoot = "",
}: CodekseiMcpRequestHandlersOptions = {}): CodekseiMcpRequestHandlers {
  const normalizedToolset = normalizeCodekseiMcpToolset(toolset);
  const runtimeLabel = normalizeString(runtimeId) || "claudecode";
  const artifacts = pageArtifactStore || new PageArtifactStore({
    rootDir: pageArtifactsDir || resolveDefaultPageArtifactsDir(),
  });
  const resolvedInvokeTool: InvokeCodekseiMcpTool = invokeTool || (async (toolName, args) => invokeCodekseiMcpTool(toolName, args, {
    cliEntrypoint,
    maxChars: maxResultChars,
    nodeCommand,
    packageRoot,
    pageArtifactStore: artifacts,
    runtimeId: runtimeLabel,
    toolset: normalizedToolset,
    workspaceRoot,
  }));

  return {
    async initialize(params: UnknownRecord = {}) {
      return {
        protocolVersion: normalizeString(params.protocolVersion) || "2024-11-05",
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      };
    },
    async listResources(params: { cursor?: string; limit?: number } = {}) {
      try {
        const listArgs: {
          runtimeId: string;
          workspaceRoot: string;
          limit?: number;
          cursor?: string;
        } = {
          runtimeId: runtimeLabel,
          workspaceRoot,
          cursor: params.cursor || "",
        };
        if (typeof params.limit === "number") {
          listArgs.limit = params.limit;
        }
        const listed = artifacts.listResources({
          ...listArgs,
        });
        return listed.nextCursor
          ? { resources: listed.resources, nextCursor: listed.nextCursor }
          : { resources: listed.resources };
      } catch (error) {
        throw mapPageArtifactError(error, ErrorCode.InvalidParams);
      }
    },
    async listResourceTemplates() {
      return {
        resourceTemplates: [{
          name: "codeksei_tool_result_page",
          uriTemplate: "codeksei://mcp/tool-result/{artifactId}?page={page}",
          description: "Read one page from a transient Codeksei tool result.",
          mimeType: "text/plain",
        }],
      };
    },
    async readResource(uri: string) {
      const page = artifacts.readTextResourcePage(uri);
      if (!page) {
        throw new McpError(-32002, "Unknown Codeksei MCP resource");
      }
      return {
        contents: [{
          uri: page.uri,
          mimeType: "text/plain",
          text: page.text,
        }],
        _meta: {
          artifactId: page.artifact.id,
          page: page.page,
          totalPages: page.artifact.totalPages,
          nextUri: page.nextUri,
          previousUri: page.previousUri,
        },
      };
    },
    async listTools() {
      return {
        tools: listCodekseiMcpTools({ toolset: normalizedToolset }).map((tool) => ({
          name: tool.name,
          description: `${tool.description} runtime=${runtimeLabel}`,
          inputSchema: tool.inputSchema,
          annotations: {
            readOnlyHint: tool.mutability === "read",
            destructiveHint: false,
            idempotentHint: tool.mutability === "read",
            openWorldHint: false,
          },
        })),
      };
    },
    async callTool(name: string, args: UnknownRecord = {}) {
      const tool = resolveCodekseiMcpTool(name, { toolset: normalizedToolset });
      if (!tool) {
        throw new Error(`Unknown Codeksei MCP tool: ${name}`);
      }
      return resolvedInvokeTool(tool.name, args);
    },
  };
}

async function runCodekseiMcpServerCli(args: readonly string[] = []): Promise<void> {
  const options = parseCliArgs<CodekseiMcpServerCliOptions>(args, getCommandArgsSchema("toolMcpServer"));
  if (options.help) {
    process.stderr.write("codeksei tool mcp-server is an MCP stdio endpoint; use codeksei tool mcp-bootstrap for setup.\n");
    return;
  }
  const handlers = createCodekseiMcpRequestHandlers({
    cliEntrypoint: options.cliEntrypoint,
    maxResultChars: parsePositiveInt(options.maxResultChars),
    nodeCommand: options.nodeCommand,
    runtimeId: options.runtimeId,
    toolset: normalizeCodekseiMcpToolset(options.toolset),
    workspaceRoot: options.workspaceRoot,
  });
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: { listChanged: false }, resources: { listChanged: false } } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => handlers.listTools());
  server.setRequestHandler(ListResourcesRequestSchema, async (request) => handlers.listResources({
    cursor: normalizeString(request.params?.cursor),
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => handlers.listResourceTemplates({
    cursor: normalizeString(request.params?.cursor),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => handlers.readResource(request.params.uri));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const params = request.params;
    return handlers.callTool(params.name, asRecord(params.arguments));
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function resolveDefaultPageArtifactsDir(): string {
  const stateDir = process.env.CODEKSEI_STATE_DIR || "";
  return stateDir ? `${stateDir.replace(/[\\/]$/u, "")}/page-artifacts` : ".codeksei-page-artifacts";
}

function mapPageArtifactError(error: unknown, code: ErrorCode): McpError {
  if (error instanceof McpError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error || "Unknown Codeksei MCP resource error");
  return new McpError(code, message);
}

function asRecord(value: unknown): UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function parsePositiveInt(value: unknown): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  createCodekseiMcpRequestHandlers,
  runCodekseiMcpServerCli,
};
