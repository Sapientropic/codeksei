import * as fs from "node:fs";
import * as path from "node:path";
import { CodekseiApp } from "../core/app";
import * as brandingModule from "../core/branding";
import * as envLoaderModule from "../core/env-loader";
import * as configModule from "../core/config";
import * as instructionsTemplateModule from "../core/instructions-template";
import * as timelineIntegrationModule from "../integrations/timeline";
import * as cliArgsModule from "../core/cli-args";
import * as jsonStateModule from "../state/json-state";
import * as pathUtilsModule from "../core/path-utils";
import * as personReferenceModule from "../core/person-reference";

const {
  ensureCodekseiHomeEnv,
  ensureStateDirectory,
} = brandingModule as {
  ensureCodekseiHomeEnv: (args: { fallbackRoot: string }) => void;
  ensureStateDirectory: () => void;
};
const { loadEnvStack } = envLoaderModule as {
  loadEnvStack: () => void;
};
const { readConfig } = configModule as {
  readConfig: () => TerminalRuntimeConfig;
};
const { renderInstructionTemplate } = instructionsTemplateModule as {
  renderInstructionTemplate: (template: string, values: Record<string, unknown>) => string;
};
const { createTimelineIntegration } = timelineIntegrationModule as {
  createTimelineIntegration: (config: TerminalRuntimeConfig) => TerminalTimelineIntegrationLike;
};
const { sliceLeafCommandArgs } = cliArgsModule as {
  sliceLeafCommandArgs: (argv: string[], maxDepth: number) => string[];
};
const { writeForeignTextDocument } = jsonStateModule as {
  writeForeignTextDocument: (filePath: string, text: string, options: { encoding: BufferEncoding }) => void;
};
const { resolvePackageRoot } = pathUtilsModule as {
  resolvePackageRoot: (baseDir: string) => string;
};
const { resolveConfiguredPersonName } = personReferenceModule as {
  resolveConfiguredPersonName: (config: TerminalRuntimeConfig) => string;
};

export interface TerminalRuntimeConfig extends Record<string, unknown> {
  sessionsFile: string;
  stateDir: string;
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
  config: TerminalRuntimeConfig;
  leafArgs: string[];
  getApp(): CodekseiApp;
  getTimelineIntegration(): TerminalTimelineIntegrationLike;
}

export function createTerminalCommandContext(argv: string[]): TerminalCommandContext {
  loadEnvStack();
  ensureStateDirectory();
  ensureCodekseiHomeEnv({ fallbackRoot: resolvePackageRoot(__dirname) });

  const leafArgs = sliceLeafCommandArgs(process.argv, 4);
  const baseConfig = readConfig();
  const config: TerminalRuntimeConfig = {
    ...baseConfig,
    startWithCheckin: Boolean(baseConfig.startWithCheckin || hasArgFlag(argv, "--checkin")),
  };
  ensureBootstrapFiles(config);

  let app: CodekseiApp | null = null;
  let timelineIntegration: TerminalTimelineIntegrationLike | null = null;
  return {
    argv,
    config,
    leafArgs,
    getApp(): CodekseiApp {
      if (!app) {
        app = new CodekseiApp(config);
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
