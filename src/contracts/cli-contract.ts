export type CliAudience = "operator" | "public";
export type CliAuthRequirement = "context_token" | "none" | "runtime_bootstrap" | "weixin_account";
export type CliFormat = "json" | "text";
export type CliMutability = "bootstrap" | "long_running" | "read" | "write";
export type CliOkStatus = true | "partial";
export type CliSafetyTier = "open" | "operator" | "warned";

export interface CommandErrorShape {
  code: string;
  message: string;
  retryable: boolean;
  hint?: string | undefined;
  context?: Record<string, unknown> | undefined;
}

export interface CommandEnvelope<T = unknown, TMeta extends Record<string, unknown> = Record<string, unknown>> {
  ok: CliOkStatus | false;
  data?: T | undefined;
  error?: CommandErrorShape | undefined;
  meta?: TMeta | undefined;
  next?: string[] | undefined;
}

export interface CommandExecutionResult<T = unknown, TMeta extends Record<string, unknown> = Record<string, unknown>> {
  ok?: CliOkStatus | undefined;
  data?: T | undefined;
  text?: string | undefined;
  meta?: TMeta | undefined;
  next?: string[] | undefined;
}

export interface GlobalCliOptions {
  debug: boolean;
  format: CliFormat;
  locale: string;
  stdinIsTty: boolean;
  stdoutIsTty: boolean;
  verbose: boolean;
  workspaceRoot: string;
}

export interface ParsedGlobalCliOptions {
  argv: string[];
  format?: CliFormat | undefined;
  locale?: string | undefined;
  verbose: boolean;
  workspaceRoot: string;
}
