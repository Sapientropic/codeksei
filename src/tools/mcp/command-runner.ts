import { spawn } from "node:child_process";
import { resolveRuntimeEntrypointAbsolute } from "../../contracts/runtime-entrypoints";
import { resolvePackageRoot } from "../../core/path-utils";
import {
  buildPageArtifactUri,
  formatMcpPageSummary,
  type PageArtifactStore,
} from "../../state/page-artifacts";
import { resolveCodekseiMcpTool } from "./tool-catalog";
import type { CodekseiMcpToolset } from "./tool-catalog";

type UnknownRecord = Record<string, unknown>;

export interface CodekseiMcpToolInvocationOptions {
  cliEntrypoint?: string;
  nodeCommand?: string;
  packageRoot?: string;
  toolset?: CodekseiMcpToolset;
  workspaceRoot?: string;
}

export interface CodekseiMcpToolInvocation {
  command: string;
  argv: string[];
  stdin: string;
}

export interface CodekseiMcpProcessResult {
  stdout: string;
  stderr: string;
  status: number;
}

export interface CodekseiMcpFormattedToolResult {
  [key: string]: unknown;
  content: CodekseiMcpContentBlock[];
  isError: boolean;
  text: string;
  truncated: boolean;
}

interface FormatCodekseiMcpToolResultOptions {
  maxChars?: number;
  pageArtifactStore?: PageArtifactStore | null;
  runtimeId?: string;
  toolName?: string;
  workspaceRoot?: string;
}

type CodekseiMcpContentBlock =
  | { type: "text"; text: string }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      description: string;
      mimeType: "text/plain";
      size: number;
      _meta: Record<string, unknown>;
    };

const DEFAULT_MAX_RESULT_CHARS = 12000;

function buildCodekseiMcpToolInvocation(
  toolName: string,
  args: UnknownRecord = {},
  options: CodekseiMcpToolInvocationOptions = {},
): CodekseiMcpToolInvocation {
  const tool = resolveCodekseiMcpTool(toolName, { toolset: options.toolset || "delivery" });
  if (!tool) {
    throw new Error(`Unknown Codeksei MCP tool: ${toolName}`);
  }

  const packageRoot = normalizeString(options.packageRoot) || resolvePackageRoot(__dirname);
  const cliEntrypoint = normalizeString(options.cliEntrypoint)
    || resolveRuntimeEntrypointAbsolute(packageRoot, "cli");
  const command = normalizeString(options.nodeCommand) || process.execPath;
  const argv = [cliEntrypoint, "--format", "json"];
  const workspaceRoot = normalizeString(options.workspaceRoot);
  if (workspaceRoot) {
    argv.push("--workspace-root", workspaceRoot);
  }
  argv.push(...tool.commandTokens);

  const builder = TOOL_ARGUMENT_BUILDERS[tool.name];
  if (!builder) {
    throw new Error(`Codeksei MCP tool has no command mapping: ${tool.name}`);
  }
  const built = builder(args);
  argv.push(...built.argv);
  return {
    command,
    argv,
    stdin: built.stdin,
  };
}

async function invokeCodekseiMcpTool(
  toolName: string,
  args: UnknownRecord = {},
  options: CodekseiMcpToolInvocationOptions & FormatCodekseiMcpToolResultOptions = {},
): Promise<CodekseiMcpFormattedToolResult> {
  const invocation = buildCodekseiMcpToolInvocation(toolName, args, options);
  const result = await runProcess(invocation);
  return formatCodekseiMcpToolResult(result, {
    ...options,
    toolName,
  });
}

function formatCodekseiMcpToolResult(
  result: CodekseiMcpProcessResult,
  {
    maxChars = DEFAULT_MAX_RESULT_CHARS,
    pageArtifactStore = null,
    runtimeId = "claudecode",
    toolName = "codeksei_tool",
    workspaceRoot = "",
  }: FormatCodekseiMcpToolResultOptions = {},
): CodekseiMcpFormattedToolResult {
  const parsedEnvelope = parseJsonObject(result.stdout);
  const isEnvelopeError = parsedEnvelope ? parsedEnvelope.ok === false : false;
  const isError = result.status !== 0 || isEnvelopeError;
  const textParts: string[] = [];

  if (parsedEnvelope) {
    textParts.push(JSON.stringify(parsedEnvelope, null, 2));
  } else if (normalizeString(result.stdout)) {
    textParts.push(normalizeString(result.stdout));
  }
  if (normalizeString(result.stderr)) {
    textParts.push(`stderr:\n${normalizeString(result.stderr)}`);
  }
  if (!textParts.length) {
    textParts.push(isError ? `Codeksei command failed with status ${result.status}` : "Codeksei command completed.");
  }

  const fullText = textParts.join("\n\n");
  const formatted = formatToolText(fullText, {
    maxChars,
    pageArtifactStore,
    runtimeId,
    toolName,
    workspaceRoot,
  });
  return {
    content: formatted.content,
    isError,
    text: formatted.text,
    truncated: formatted.truncated,
  };
}

interface BuiltToolArgs {
  argv: string[];
  stdin: string;
}

type ToolArgumentBuilder = (args: UnknownRecord) => BuiltToolArgs;

const TOOL_ARGUMENT_BUILDERS: Readonly<Record<string, ToolArgumentBuilder>> = Object.freeze({
  codeksei_capabilities_status: (args) => buildArgs(args, {
    strings: [
      ["provider", "--provider"],
      ["user", "--user"],
      ["workspace", "--workspace"],
    ],
  }),
  codeksei_context_briefing: (args) => buildArgs(args, {
    strings: [
      ["user", "--user"],
      ["workspace", "--workspace"],
      ["mode", "--mode"],
    ],
  }),
  codeksei_context_inspect: (args) => buildArgs(args, {
    strings: [
      ["user", "--user"],
      ["workspace", "--workspace"],
      ["mode", "--mode"],
      ["text", "--text"],
    ],
  }),
  codeksei_project_radar: (args) => buildArgs(args, {
    booleans: [
      ["list", "--list"],
      ["json", "--json"],
    ],
    strings: [
      ["project", "--project"],
      ["commits", "--commits"],
      ["changes", "--changes"],
    ],
  }),
  codeksei_timeline_categories: () => ({ argv: [], stdin: "" }),
  codeksei_timeline_read: (args) => buildArgs(args, {
    strings: [["date", "--date"]],
  }),
  codeksei_timeline_proposals: (args) => buildArgs(args, {
    strings: [["date", "--date"]],
  }),
  codeksei_diary_write: (args) => buildStdinTextArgs(args, "text", {
    booleans: [["dryRun", "--dry-run"]],
    strings: [
      ["idempotencyKey", "--idempotency-key"],
      ["title", "--title"],
      ["date", "--date"],
      ["time", "--time"],
      ["section", "--section"],
      ["state", "--state"],
      ["timelineText", "--timeline-text"],
    ],
  }),
  codeksei_note_auto: (args) => buildStdinTextArgs(args, "text", {
    booleans: [
      ["dryRun", "--dry-run"],
      ["json", "--json"],
    ],
    strings: [
      ["idempotencyKey", "--idempotency-key"],
      ["project", "--project"],
      ["scope", "--scope"],
      ["kind", "--kind"],
    ],
  }),
  codeksei_reminder_write: (args) => buildStdinTextArgs(args, "text", {
    booleans: [["dryRun", "--dry-run"]],
    strings: [
      ["idempotencyKey", "--idempotency-key"],
      ["delay", "--delay"],
      ["at", "--at"],
      ["user", "--user"],
    ],
  }),
  codeksei_timeline_event: (args) => buildStdinTextArgs(args, "note", {
    booleans: [
      ["dryRun", "--dry-run"],
      ["finalize", "--finalize"],
    ],
    strings: [
      ["idempotencyKey", "--idempotency-key"],
      ["date", "--date"],
      ["start", "--start"],
      ["end", "--end"],
      ["title", "--title"],
      ["categoryId", "--category"],
      ["subcategoryId", "--subcategory"],
      ["eventNodeId", "--event-node"],
      ["mode", "--mode"],
      ["eventId", "--id"],
    ],
    arrays: [["tags", "--tag"]],
  }),
  codeksei_timeline_write: (args) => buildTimelineWriteArgs(args),
  codeksei_timeline_screenshot: (args) => buildArgs(args, {
    booleans: [["dryRun", "--dry-run"]],
    strings: [
      ["idempotencyKey", "--idempotency-key"],
      ["outputFile", "--output"],
    ],
  }),
  codeksei_channel_send_file: (args) => buildArgs(args, {
    booleans: [["dryRun", "--dry-run"]],
    strings: [
      ["idempotencyKey", "--idempotency-key"],
      ["path", "--path"],
      ["user", "--user"],
    ],
  }),
});

interface BuildArgsSpec {
  arrays?: Array<[string, string]>;
  booleans?: Array<[string, string]>;
  strings?: Array<[string, string]>;
}

function buildArgs(args: UnknownRecord, spec: BuildArgsSpec): BuiltToolArgs {
  const argv: string[] = [];
  for (const [key, flag] of spec.booleans || []) {
    if (args[key] === true) {
      argv.push(flag);
    }
  }
  for (const [key, flag] of spec.strings || []) {
    const value = normalizeString(args[key]);
    if (value) {
      argv.push(flag, value);
    }
  }
  for (const [key, flag] of spec.arrays || []) {
    const values = normalizeStringArray(args[key]);
    for (const value of values) {
      argv.push(flag, value);
    }
  }
  return { argv, stdin: "" };
}

function buildStdinTextArgs(args: UnknownRecord, textKey: string, spec: BuildArgsSpec): BuiltToolArgs {
  const built = buildArgs(args, spec);
  const stdin = normalizeString(args[textKey]);
  if (stdin) {
    built.argv.push("--stdin");
  }
  return {
    argv: built.argv,
    stdin,
  };
}

function buildTimelineWriteArgs(args: UnknownRecord): BuiltToolArgs {
  const built = buildArgs(args, {
    booleans: [
      ["dryRun", "--dry-run"],
      ["finalize", "--finalize"],
    ],
    strings: [
      ["idempotencyKey", "--idempotency-key"],
      ["date", "--date"],
      ["mode", "--mode"],
    ],
  });
  const explicitJson = normalizeString(args.json);
  const stdin = explicitJson || JSON.stringify({
    events: Array.isArray(args.events) ? args.events : [],
  });
  if (stdin) {
    built.argv.push("--stdin");
  }
  return {
    argv: built.argv,
    stdin,
  };
}

function runProcess(invocation: CodekseiMcpToolInvocation): Promise<CodekseiMcpProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.argv, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      stderr += `${stderr ? "\n" : ""}${error.message}`;
      resolve({ stdout, stderr, status: 1 });
    });
    child.on("close", (code: number | null) => {
      resolve({ stdout, stderr, status: code ?? 1 });
    });
    if (invocation.stdin) {
      child.stdin.write(invocation.stdin);
    }
    child.stdin.end();
  });
}

function parseJsonObject(value: unknown): UnknownRecord | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(normalized);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatToolText(
  value: string,
  {
    maxChars,
    pageArtifactStore,
    runtimeId,
    toolName,
    workspaceRoot,
  }: Required<Pick<FormatCodekseiMcpToolResultOptions, "maxChars">>
    & Pick<FormatCodekseiMcpToolResultOptions, "pageArtifactStore" | "runtimeId" | "toolName" | "workspaceRoot">,
): { content: CodekseiMcpContentBlock[]; text: string; truncated: boolean } {
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : DEFAULT_MAX_RESULT_CHARS;
  if (value.length <= limit) {
    return {
      content: [{ type: "text", text: value }],
      text: value,
      truncated: false,
    };
  }
  if (pageArtifactStore) {
    const artifact = pageArtifactStore.createTextArtifact({
      sourceKind: "mcp_tool_result",
      sourceName: normalizeString(toolName) || "codeksei_tool",
      runtimeId: normalizeString(runtimeId) || "claudecode",
      workspaceRoot: normalizeString(workspaceRoot),
      pageChars: limit,
      text: value,
      metadata: {
        originalLength: value.length,
      },
    });
    const firstPage = pageArtifactStore.readTextResourcePage(buildPageArtifactUri(artifact.id, 1));
    if (firstPage) {
      const text = formatMcpPageSummary(firstPage);
      return {
        content: [
          { type: "text", text },
          {
            type: "resource_link",
            uri: firstPage.uri,
            name: `${artifact.sourceName} result`,
            description: `Paged Codeksei tool result page 1/${artifact.totalPages}`,
            mimeType: "text/plain",
            size: artifact.totalChars,
            _meta: {
              artifactId: artifact.id,
              page: 1,
              totalPages: artifact.totalPages,
              nextUri: firstPage.nextUri,
            },
          },
        ],
        text,
        truncated: true,
      };
    }
  }
  return {
    content: [{ type: "text", text: `${value.slice(0, Math.max(0, limit))}\n\n[truncated: true, originalLength=${value.length}]` }],
    text: `${value.slice(0, Math.max(0, limit))}\n\n[truncated: true, originalLength=${value.length}]`,
    truncated: true,
  };
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeString).filter(Boolean);
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export {
  buildCodekseiMcpToolInvocation,
  formatCodekseiMcpToolResult,
  invokeCodekseiMcpTool,
};
