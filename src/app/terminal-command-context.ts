import * as fs from "node:fs";
import * as path from "node:path";
import { ensureCodekseiHomeEnv, ensureStateDirectory } from "../core/branding";
import { loadEnvStack } from "../core/env-loader";
import { readConfig } from "../core/config";
import { createTerminalAppFacade, type TerminalAppFacade } from "../core/app-terminal-facade";
import { renderInstructionTemplate } from "../core/instructions-template";
import { createTimelineIntegration } from "../integrations/timeline";
import { writeForeignTextDocument } from "../state/json-state";
import { resolvePackageRoot } from "../core/path-utils";
import { resolveConfiguredPersonName } from "../core/person-reference";
import type { GlobalCliOptions } from "../contracts/cli-contract";
import type { TerminalCommandManifestEntry } from "../contracts/command-surface";


export interface TerminalRuntimeConfig extends Record<string, unknown> {
  cliIdempotencyLedgerFile?: string;
  sessionsFile: string;
  stateDir: string;
  checkinConfigFile?: string;
  systemMessageQueueFile: string;
  systemMessageDeadLetterFile: string;
  timelineScreenshotQueueFile: string;
  workspaceId: string;
  workspaceRoot: string;
  startWithCheckin?: boolean;
  weixinInstructionsFile?: string;
}

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
  const filePath = typeof config.weixinInstructionsFile === "string"
    ? config.weixinInstructionsFile.trim()
    : "";
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
