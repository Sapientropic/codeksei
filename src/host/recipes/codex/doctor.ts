import * as fs from "node:fs";
import * as path from "node:path";

import type { AppRuntimeConfig } from "../../../core/app-service-contract";
import { resolvePackageRoot } from "../../../core/path-utils";
import { normalizeText } from "../../../contracts/text-normalization";

interface CodexRecipeDiagnosticsConfigInput
  extends Partial<Pick<
    AppRuntimeConfig,
    | "accountId"
    | "accountsDir"
    | "runtimeCommand"
    | "runtimeEndpoint"
    | "stateDir"
    | "weixinInstructionsFile"
    | "weixinOperationsFile"
    | "workspaceRoot"
  >> {}

interface CodexRecipeCheck {
  ok: boolean;
  path?: string;
  required: boolean;
  status: "ok" | "missing" | "optional" | "configured" | "unconfigured";
}

export interface CodexRecipeDoctorReport {
  ok: boolean;
  provider: "codex";
  checks: Record<
    "stateDir"
    | "workspaceRoot"
    | "instructionsTemplate"
    | "operationsTemplate"
    | "weixinAccount"
    | "codexRuntime"
    | "sharedScripts",
    CodexRecipeCheck
  >;
}

export interface CodexRecipeSmokeReport {
  ok: boolean;
  provider: "codex";
  checks: Pick<CodexRecipeDoctorReport["checks"],
    "stateDir" | "workspaceRoot" | "instructionsTemplate" | "operationsTemplate" | "sharedScripts"
  >;
  next: string[];
}

export function collectCodexRecipeDoctorReport(
  config: CodexRecipeDiagnosticsConfigInput = {},
): CodexRecipeDoctorReport {
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
  const runtimeEndpoint = normalizeText(config.runtimeEndpoint);
  const runtimeCommand = normalizeText(config.runtimeCommand);

  const checks: CodexRecipeDoctorReport["checks"] = {
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
    codexRuntime: {
      ok: Boolean(runtimeEndpoint || runtimeCommand) || true,
      required: false,
      status: runtimeEndpoint || runtimeCommand ? "configured" : "optional",
    },
    sharedScripts: checkRequiredPath(sharedScriptsDir),
  };

  return {
    ok: Object.values(checks).every((check) => check.ok || !check.required),
    provider: "codex",
    checks,
  };
}

export function runCodexRecipeSmoke(
  config: CodexRecipeDiagnosticsConfigInput = {},
): CodexRecipeSmokeReport {
  const doctor = collectCodexRecipeDoctorReport(config);
  const checks: CodexRecipeSmokeReport["checks"] = {
    stateDir: doctor.checks.stateDir,
    workspaceRoot: doctor.checks.workspaceRoot,
    instructionsTemplate: doctor.checks.instructionsTemplate,
    operationsTemplate: doctor.checks.operationsTemplate,
    sharedScripts: doctor.checks.sharedScripts,
  };
  const ok = Object.values(checks).every((check) => check.ok);
  return {
    ok,
    provider: "codex",
    checks,
    next: ok ? [] : ["codeksei host doctor --provider codex"],
  };
}

function checkRequiredPath(filePath: string): CodexRecipeCheck {
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

function withOptionalPath(check: CodexRecipeCheck & { path: string }): CodexRecipeCheck {
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
