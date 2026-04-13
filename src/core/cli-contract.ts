import type {
  CommandEnvelope,
  CommandErrorShape,
  CommandExecutionResult,
  CliFormat,
  GlobalCliOptions,
  ParsedGlobalCliOptions,
} from "../contracts/cli-contract";
import { normalizeText } from "./text-normalization";
import { resolveCrossPlatformPath } from "./path-utils";

interface CliErrorOptions {
  code: string;
  context?: Record<string, unknown>;
  exitCode?: number;
  hint?: string;
  message: string;
  retryable?: boolean;
}

interface EmitCliErrorOptions {
  defaultCode?: string;
}

const GLOBAL_FLAG_HELP = [
  {
    description: "显式指定输出格式；非 TTY 默认 json，TTY 默认 text",
    keys: ["--format"],
    placeholder: "json|text",
  },
  {
    description: "输出更详细的 stderr 诊断",
    keys: ["--verbose"],
    placeholder: "",
  },
  {
    description: "覆盖当前 workspace root，并据此重算相关 schema/config 入口",
    keys: ["--workspace-root"],
    placeholder: "/absolute/path",
  },
] as const;

export class CliError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;
  readonly exitCode: number;
  readonly hint: string;
  readonly retryable: boolean;

  constructor({
    code,
    context = {},
    exitCode = 1,
    hint = "",
    message,
    retryable = false,
  }: CliErrorOptions) {
    super(message);
    this.code = normalizeText(code) || "internal_error";
    this.context = context;
    this.exitCode = Number.isFinite(exitCode) ? exitCode : 1;
    this.hint = normalizeText(hint);
    this.retryable = Boolean(retryable);
    this.name = "CliError";
  }
}

export function buildAuthRequiredError(message: string, hint: string = ""): CliError {
  return new CliError({
    code: "auth_required",
    exitCode: 2,
    hint,
    message,
    retryable: false,
  });
}

export function buildDependencyMissingError(message: string, hint: string = ""): CliError {
  return new CliError({
    code: "dependency_missing",
    exitCode: 1,
    hint,
    message,
    retryable: false,
  });
}

export function buildTargetResolutionRequiredError(
  message: string,
  context: Record<string, unknown> = {},
  hint: string = "",
): CliError {
  return new CliError({
    code: "target_resolution_required",
    context,
    exitCode: 4,
    hint,
    message,
    retryable: false,
  });
}

export function buildValidationError(
  message: string,
  context: Record<string, unknown> = {},
  hint: string = "",
): CliError {
  return new CliError({
    code: "validation_error",
    context,
    exitCode: 3,
    hint,
    message,
    retryable: false,
  });
}

export function buildCommandEnvelope<T = unknown>(
  result: CommandExecutionResult<T>,
): CommandEnvelope<T> {
  return {
    ok: result.ok || true,
    data: result.data,
    meta: isNonEmptyRecord(result.meta) ? result.meta : undefined,
    next: Array.isArray(result.next) && result.next.length ? [...result.next] : undefined,
  };
}

export function classifyCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  const message = formatCliErrorMessage(error);
  const normalized = message.toLowerCase();
  if (!normalized) {
    return new CliError({ code: "internal_error", exitCode: 1, message: "unknown error" });
  }
  if (normalized.includes("未知命令") || normalized.includes("unknown command")) {
    return new CliError({
      code: "unknown_command",
      exitCode: 3,
      message,
      retryable: false,
    });
  }
  if (
    normalized.includes("未知参数")
    || normalized.includes("参数缺少值")
    || normalized.includes("缺少有效")
    || normalized.includes("不能为空")
    || normalized.includes("不支持的")
  ) {
    return buildValidationError(message);
  }
  if (
    normalized.includes("请先执行")
    || normalized.includes("context_token")
    || normalized.includes("token")
    || normalized.includes("微信账号")
    || normalized.includes("login")
  ) {
    return buildAuthRequiredError(message);
  }
  if (normalized.includes("workspace 不存在") || normalized.includes("workspace 不是目录")) {
    return buildValidationError(message);
  }
  if (
    normalized.includes("chrome")
    || normalized.includes("chromium")
    || normalized.includes("cannot find module")
  ) {
    return buildDependencyMissingError(message);
  }
  if (
    normalized.includes("fetch failed")
    || normalized.includes("二维码")
    || normalized.includes("baseurl")
    || normalized.includes("weixin")
    || normalized.includes("codex")
  ) {
    return new CliError({
      code: "upstream_error",
      exitCode: 1,
      message,
      retryable: false,
    });
  }
  return new CliError({
    code: "internal_error",
    exitCode: 1,
    message,
    retryable: false,
  });
}

export function emitCliError(
  error: unknown,
  options: GlobalCliOptions,
  { defaultCode = "" }: EmitCliErrorOptions = {},
): number {
  const classified = classifyCliError(error);
  const errorShape: CommandErrorShape = {
    code: defaultCode || classified.code,
    message: classified.message,
    retryable: classified.retryable,
  };
  if (classified.hint) {
    errorShape.hint = classified.hint;
  }
  if (isNonEmptyRecord(classified.context)) {
    errorShape.context = classified.context;
  }

  if (options.format === "json") {
    const envelope: CommandEnvelope = {
      ok: false,
      error: errorShape,
    };
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    const lines = [classified.message];
    if (classified.hint) {
      lines.push(`hint: ${classified.hint}`);
    }
    process.stderr.write(`${lines.join("\n")}\n`);
  }

  if (options.verbose || options.debug) {
    const stack = extractCliErrorStack(error);
    if (stack) {
      process.stderr.write(`${stack}\n`);
    }
  }

  return classified.exitCode;
}

export function emitCliResult<T = unknown>(
  result: CommandExecutionResult<T>,
  options: GlobalCliOptions,
): void {
  const envelope = buildCommandEnvelope(result);
  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }

  const text = normalizeText(result.text);
  if (text) {
    process.stdout.write(`${text}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function formatCliErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return normalizeText(error.message) || normalizeText(error.stack) || "unknown error";
  }
  return normalizeText(String(error ?? "")) || "unknown error";
}

export function listGlobalCliFlags() {
  return GLOBAL_FLAG_HELP.map((flag) => ({
    description: flag.description,
    keys: [...flag.keys],
    placeholder: flag.placeholder,
  }));
}

export function parseGlobalCliOptions(argv: string[]): ParsedGlobalCliOptions {
  const cleaned: string[] = [];
  let format: CliFormat | undefined;
  let verbose = false;
  let workspaceRoot = "";

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "").trim();
    if (!token) {
      continue;
    }
    if (token === "--verbose") {
      verbose = true;
      continue;
    }
    if (token === "--format") {
      const value = String(argv[index + 1] || "").trim();
      if (!value || value.startsWith("--")) {
        throw buildValidationError("--format 需要显式值：json 或 text");
      }
      format = normalizeCliFormat(value);
      if (!format) {
        throw buildValidationError(`不支持的 --format: ${value}`);
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--format=")) {
      const value = token.slice("--format=".length);
      format = normalizeCliFormat(value);
      if (!format) {
        throw buildValidationError(`不支持的 --format: ${value}`);
      }
      continue;
    }
    if (token === "--workspace-root") {
      const value = String(argv[index + 1] || "").trim();
      if (!value || value.startsWith("--")) {
        throw buildValidationError("--workspace-root 需要绝对路径");
      }
      workspaceRoot = resolveCrossPlatformPath(value);
      index += 1;
      continue;
    }
    if (token.startsWith("--workspace-root=")) {
      workspaceRoot = resolveCrossPlatformPath(token.slice("--workspace-root=".length));
      continue;
    }
    cleaned.push(token);
  }

  return {
    argv: cleaned,
    format,
    verbose,
    workspaceRoot,
  };
}

export function resolveGlobalCliOptions(parsed: ParsedGlobalCliOptions): GlobalCliOptions {
  return {
    debug: process.env.CODEKSEI_DEBUG === "1",
    format: parsed.format || (process.stdout.isTTY ? "text" : "json"),
    stdinIsTty: Boolean(process.stdin.isTTY),
    stdoutIsTty: Boolean(process.stdout.isTTY),
    verbose: parsed.verbose,
    workspaceRoot: normalizeText(parsed.workspaceRoot),
  };
}

function extractCliErrorStack(error: unknown): string {
  if (!(error instanceof Error)) {
    return "";
  }
  return normalizeText(error.stack) || "";
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length > 0;
}

function normalizeCliFormat(value: unknown): CliFormat | undefined {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "json" || normalized === "text") {
    return normalized;
  }
  return undefined;
}
