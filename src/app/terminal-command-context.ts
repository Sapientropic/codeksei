import * as fs from "node:fs";
import * as path from "node:path";
import { ensureCodekseiHomeEnv, ensureStateDirectory } from "../core/branding";
import { loadEnvStack } from "../core/env-loader";
import { applyHostConfigEnvFallback } from "../host/attach/config";
import { readConfig } from "../core/config";
import { createTerminalAppFacade, type TerminalAppFacade } from "../core/app-terminal-facade";
import { renderInstructionTemplate } from "../core/instructions-template";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { createTimelineIntegration } from "../integrations/timeline";
import { writeForeignTextDocument } from "../state/json-state";
import { resolvePackageRoot } from "../core/path-utils";
import { resolveConfiguredPersonName } from "../contracts/person-reference";
import type { GlobalCliOptions } from "../contracts/cli-contract";
import type { TerminalCommandManifestEntry } from "../contracts/command-surface";

export type TerminalRuntimeConfig = AppRuntimeConfig;

export interface TerminalTimelineIntegrationLike {
  runSubcommand(command: string, args: string[]): Promise<unknown>;
}

export interface TerminalCommandContext {
  argv: string[];
  cli: GlobalCliOptions;
  config: TerminalRuntimeConfig;
  leafArgs: string[];
  getApp(): TerminalAppFacade;
  getTimelineIntegration(): TerminalTimelineIntegrationLike;
}

export function createTerminalCommandContext(
  argv: string[],
  cli: GlobalCliOptions,
  manifest: TerminalCommandManifestEntry | null = null,
): TerminalCommandContext {
  const bootstrapCwd = cli.workspaceRoot || process.cwd();
  loadEnvStack();
  // Hosted proactive/check-in commands can be launched by Hermes cron from a
  // clean environment. Rehydrate their CODEKSEI_* defaults from the canonical
  // workspace config before the second env pass so state-dir .env and hosted
  // runtime flags come back without leaking hosted user defaults into unrelated
  // bridge-only commands.
  if (shouldApplyHostedConfigFallback(manifest)) {
    applyHostConfigEnvFallback(process.env, bootstrapCwd);
  }
  loadEnvStack();
  ensureStateDirectory();
  ensureCodekseiHomeEnv({ fallbackRoot: resolvePackageRoot(__dirname) });

  const consumedArgCount = manifest?.tokenCount || 1;
  const leafArgs = Array.isArray(argv) ? argv.slice(consumedArgCount) : [];
  const baseConfig = readConfig({ workspaceRoot: cli.workspaceRoot });
  const config: TerminalRuntimeConfig = {
    ...baseConfig,
    startWithCheckin: Boolean(baseConfig.startWithCheckin || hasArgFlag(argv, "--checkin")),
  };
  ensureBootstrapFiles(config);

  let app: TerminalAppFacade | null = null;
  let timelineIntegration: TerminalTimelineIntegrationLike | null = null;
  return {
    argv,
    cli,
    config,
    leafArgs,
    getApp(): TerminalAppFacade {
      if (!app) {
        app = createTerminalAppFacade(config);
      }
      return app;
    },
    getTimelineIntegration(): TerminalTimelineIntegrationLike {
      if (!timelineIntegration) {
        timelineIntegration = createTimelineIntegration(config);
      }
      return timelineIntegration;
    },
  };
}

function ensureBootstrapFiles(config: TerminalRuntimeConfig): void {
  ensureInstructionsTemplate(config);
}

function ensureInstructionsTemplate(config: TerminalRuntimeConfig): void {
  const filePath = config.weixinInstructionsFile.trim();
  if (!filePath || fs.existsSync(filePath)) {
    return;
  }

  const templatePath = path.join(resolvePackageRoot(__dirname), "templates", "weixin-instructions.md");
  let template = "";
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch {
    return;
  }

  const userName = resolveConfiguredPersonName(config);
  const content = `${renderInstructionTemplate(template, {
    ...config,
    userName,
  }).trimEnd()}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeForeignTextDocument(filePath, content, { encoding: "utf8" });
}

function hasArgFlag(argv: string[], flag: string): boolean {
  return Array.isArray(argv) && argv.some((item) => String(item || "").trim() === flag);
}

function shouldApplyHostedConfigFallback(manifest: TerminalCommandManifestEntry | null): boolean {
  const action = manifest?.action || "";
  return HOSTED_CONFIG_FALLBACK_ACTIONS.has(action);
}

const HOSTED_CONFIG_FALLBACK_ACTIONS = new Set<string>([
  "host.seed_proactive",
  "host.claim_checkin",
  "host.settle_checkin",
  "system.checkin_config",
  "system.checkin_trigger",
  "system.checkin_tick",
  "system.checkin_complete",
]);
