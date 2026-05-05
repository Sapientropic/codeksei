import * as fs from "node:fs";
import * as path from "node:path";

import type { AppRuntimeConfig } from "../../../core/app-service-contract";
import { resolvePackageRoot } from "../../../core/path-utils";
import { normalizeText } from "../../../contracts/text-normalization";

interface ClaudeCodeRecipeDiagnosticsConfigInput
  extends Partial<Pick<
    AppRuntimeConfig,
    | "accountId"
    | "accountsDir"
    | "claudeCommand"
    | "runtimeCommand"
    | "stateDir"
    | "weixinInstructionsFile"
    | "weixinOperationsFile"
    | "workspaceRoot"
  >> {}

interface ClaudeCodeRecipeCheck {
  ok: boolean;
  path?: string;
  required: boolean;
  status: "ok" | "missing" | "optional" | "configured" | "unconfigured";
}

export interface ClaudeCodeRecipeDoctorReport {
  ok: boolean;
  provider: "claudecode";
  checks: Record<
    "stateDir"
    | "workspaceRoot"
    | "instructionsTemplate"
    | "operationsTemplate"
    | "weixinAccount"
    | "claudeRuntime"
    | "sharedScripts",
    ClaudeCodeRecipeCheck
  >;
}

export interface ClaudeCodeRecipeSmokeReport {
  ok: boolean;
  provider: "claudecode";
  checks: Pick<ClaudeCodeRecipeDoctorReport["checks"],
    "stateDir" | "workspaceRoot" | "instructionsTemplate" | "operationsTemplate" | "sharedScripts"
  >;
  next: string[];
}

export function collectClaudeCodeRecipeDoctorReport(
  config: ClaudeCodeRecipeDiagnosticsConfigInput = {},
): ClaudeCodeRecipeDoctorReport {
  const packageRoot = resolvePackageRoot(__dirname);
  const stateDir = normalizeText(config.stateDir);
  const workspaceRoot = normalizeText(config.workspaceRoot) || process.cwd();
  const instructionsTemplate = normalizeText(config.weixinInstructionsFile)
    || path.join(packageRoot, "templates", "weixin-instructions.md");
  const operationsTemplate = normalizeText(config.weixinOperationsFile)
    || path.join(packageRoot, "templates", "weixin-operations.md");
  const sharedScriptsDir = path.join(packageRoot, "scripts");
  const accountId = normalizeText(config.accountId);
  const accountsDir = normalizeText(config.accountsDir);
  const claudeCommand = normalizeText(config.claudeCommand) || normalizeText(config.runtimeCommand) || "claude";

  const checks: ClaudeCodeRecipeDoctorReport["checks"] = {
    stateDir: checkRequiredPath(stateDir),
    workspaceRoot: checkRequiredPath(workspaceRoot),
    instructionsTemplate: checkRequiredPath(instructionsTemplate),
    operationsTemplate: checkRequiredPath(operationsTemplate),
    weixinAccount: withOptionalPath({
      ok: Boolean(accountId) || Boolean(accountsDir && pathExists(accountsDir)),
      path: accountsDir,
      required: false,
      status: accountId || (accountsDir && pathExists(accountsDir)) ? "configured" : "optional",
    }),
    // Static doctor deliberately does not execute `claude --help`; live CLI
    // behavior and login state can vary by installed Claude Code version.
    claudeRuntime: {
      ok: Boolean(claudeCommand),
      required: false,
      status: claudeCommand ? "configured" : "optional",
    },
    sharedScripts: checkRequiredPath(sharedScriptsDir),
  };

  return {
    ok: Object.values(checks).every((check) => check.ok || !check.required),
    provider: "claudecode",
    checks,
  };
}

export function runClaudeCodeRecipeSmoke(
  config: ClaudeCodeRecipeDiagnosticsConfigInput = {},
): ClaudeCodeRecipeSmokeReport {
  const doctor = collectClaudeCodeRecipeDoctorReport(config);
  const checks: ClaudeCodeRecipeSmokeReport["checks"] = {
    stateDir: doctor.checks.stateDir,
    workspaceRoot: doctor.checks.workspaceRoot,
    instructionsTemplate: doctor.checks.instructionsTemplate,
    operationsTemplate: doctor.checks.operationsTemplate,
    sharedScripts: doctor.checks.sharedScripts,
  };
  const ok = Object.values(checks).every((check) => check.ok);
  return {
    ok,
    provider: "claudecode",
    checks,
    next: ok ? [] : ["codeksei host doctor --provider claudecode"],
  };
}

function checkRequiredPath(filePath: string): ClaudeCodeRecipeCheck {
  return withOptionalPath({
    ok: Boolean(filePath && pathExists(filePath)),
    path: filePath,
    required: true,
    status: filePath && pathExists(filePath) ? "ok" : "missing",
  });
}

function pathExists(filePath: string): boolean {
  return Boolean(filePath && fs.existsSync(filePath));
}

function withOptionalPath(check: ClaudeCodeRecipeCheck & { path: string }): ClaudeCodeRecipeCheck {
  const normalizedPath = normalizeText(check.path);
  if (!normalizedPath) {
    const { path: _path, ...rest } = check;
    void _path;
    return rest;
  }
  return {
    ...check,
    path: normalizedPath,
  };
}
